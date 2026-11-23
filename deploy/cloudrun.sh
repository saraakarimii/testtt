#!/usr/bin/env bash
# Deploys ChromaBook Studio to Google Cloud Run with Cloud SQL (Postgres) and a Cloud Storage bucket.
# Usage: PROJECT_ID=my-project ./deploy/cloudrun.sh
# Requires: gcloud CLI, logged in (gcloud auth login), billing enabled on the project.
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-chromabook}"
INSTANCE="${INSTANCE:-chromabook-db}"
DB_NAME="${DB_NAME:-chromabook}"
DB_USER="${DB_USER:-chromabook}"
BUCKET="${BUCKET:-${PROJECT_ID}-chromabook-data}"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com

# Cloud SQL (skip if it already exists)
if ! gcloud sql instances describe "$INSTANCE" >/dev/null 2>&1; then
  gcloud sql instances create "$INSTANCE" --database-version=POSTGRES_16 \
    --tier=db-f1-micro --region="$REGION"
fi
gcloud sql databases create "$DB_NAME" --instance="$INSTANCE" 2>/dev/null || true

# Database password in Secret Manager
if ! gcloud secrets describe chromabook-db-password >/dev/null 2>&1; then
  DB_PASS="$(openssl rand -base64 24 | tr -d '/+=')"
  printf '%s' "$DB_PASS" | gcloud secrets create chromabook-db-password --data-file=-
  gcloud sql users create "$DB_USER" --instance="$INSTANCE" --password="$DB_PASS"
fi

# Bucket for uploads and generated PDFs (mounted at /data)
gsutil ls -b "gs://$BUCKET" >/dev/null 2>&1 || gsutil mb -l "$REGION" "gs://$BUCKET"

# Let the Cloud Run runtime service account use the secret, Cloud SQL and the bucket
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" \
  --role=roles/cloudsql.client --condition=None >/dev/null
gcloud secrets add-iam-policy-binding chromabook-db-password \
  --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
gsutil iam ch "serviceAccount:$SA:objectAdmin" "gs://$BUCKET"

CONN="${PROJECT_ID}:${REGION}:${INSTANCE}"

# The app has no login, so the service is NOT public: access needs a Google identity with run.invoker.
# max-instances=1 and no CPU throttling because image processing runs inside the web process.
gcloud run deploy "$SERVICE" --source . --region "$REGION" \
  --no-allow-unauthenticated \
  --max-instances=1 --no-cpu-throttling --cpu=2 --memory=2Gi --timeout=900 \
  --add-cloudsql-instances="$CONN" \
  --add-volume=name=data,type=cloud-storage,bucket="$BUCKET" \
  --add-volume-mount=volume=data,mount-path=/data \
  --set-env-vars="SQL_HOST=/cloudsql/${CONN},SQL_DB_NAME=${DB_NAME},SQL_USER=${DB_USER},SQL_ADMIN_USER=${DB_USER},CHROMABOOK_DATA_DIR=/data" \
  --set-secrets="SQL_PASSWORD=chromabook-db-password:latest,SQL_ADMIN_PASSWORD=chromabook-db-password:latest"

echo
echo "Deployed. Open it through an authenticated proxy:"
echo "  gcloud run services proxy $SERVICE --region $REGION --port 8080"
echo "  then visit http://localhost:8080"
