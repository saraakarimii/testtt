# Deploying to Google Cloud Run

`deploy/cloudrun.sh` creates and wires up: Cloud SQL (Postgres 16), a Secret Manager secret for the DB password, a Cloud Storage bucket mounted at `/data`, and the Cloud Run service built from the `Dockerfile`.

```bash
gcloud auth login
PROJECT_ID=your-project-id REGION=europe-west1 ./deploy/cloudrun.sh
gcloud run services proxy chromabook --region europe-west1 --port 8080   # then open http://localhost:8080
```

Optional AI background removal: store a key and add it to the service:
```bash
printf '%s' "YOUR_KEY" | gcloud secrets create gemini-api-key --data-file=-
gcloud run services update chromabook --region europe-west1 --update-secrets=GEMINI_API_KEY=gemini-api-key:latest
```

Notes
- **No login in the app**, so the service is deployed private. Grant access with `gcloud run services add-iam-policy-binding chromabook --region REGION --member=user:you@example.com --role=roles/run.invoker`. Do not use `--allow-unauthenticated`.
- **One instance only** (`--max-instances=1`, CPU always allocated): processing runs in the web process and the app keeps in-memory state.
- **Migrations** run on every container start.
- Cloud SQL `db-f1-micro` and the 2 vCPU / 2 GiB service cost money; delete them when done (`gcloud run services delete`, `gcloud sql instances delete`).
- Cloud Storage FUSE mounts are slower than local disk; fine for uploads and PDFs, not tuned for heavy concurrent writes.
