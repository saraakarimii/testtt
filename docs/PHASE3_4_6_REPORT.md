# Phase 3, Phase 4 and Phase 6 — Implementation Report

Release: ChromaBook Studio 0.7.0

## Phase 3 — Management UI: implemented

Delivered:
- Responsive browser dashboard.
- Project creation and project selection.
- Image upload and processing status.
- Color preview and numbered preview access.
- Approval/rejection workflow.
- Revision upload with previous source retained.
- Approved-asset selection and book build.
- Book, answer-key and report downloads.
- Recent activity/audit panel.

## Phase 4 — Database & Library: implemented

Delivered:
- SQLAlchemy models: Project, Asset, ProcessingRun, Book, AuditEvent.
- PostgreSQL deployment database; SQLite for local development.
- Immutable source file storage.
- Version numbers, parent revision links and SHA-256 source hashes.
- Persistent processing/build job states.
- Audit events.
- Initial Alembic migration.

## Phase 6 — Deployment: implemented as a self-hosted baseline

Delivered:
- Dockerfile.
- Docker Compose services: PostgreSQL, web/API/UI and worker.
- Persistent database and file-storage volumes.
- Bearer admin-token protection for API routes.
- Health endpoint and container health checks.
- Worker restart recovery for jobs interrupted in running/building states.
- Nginx HTTPS reverse-proxy example.
- Backup instructions and server acceptance checklist.

## Validation performed in the development environment

- Python compile check: passed.
- UI JavaScript syntax check: passed.
- Docker Compose YAML structure parsed: passed (three services present).
- Alembic initial migration applied to a fresh SQLite database and current revision verified: passed.
- Focused regression tests: 22 passed.
- Full test suite did not finish within the 300-second execution window; this is not a test failure report, but the full suite remains unverified.
- Docker Engine/Compose was not available in the development environment, so an actual container image build and live PostgreSQL deployment were not run. These must be verified on the target server.

## Locked product constraint

The production palette remains exactly 21 colours. The web UI does not provide palette editing or colour additions.

## Not included in this release

- Multi-user accounts, roles and SSO.
- Public signup, billing or customer-facing storefront.
- Cloud object storage or multi-region replication.
- High-availability database/worker topology.
- Distributed broker such as Redis/Celery.
- Persian/RTL typesetting in generated book PDFs.
- Automatic image licensing/provenance verification.

This is ready for controlled self-hosted server testing, not yet a claim of production acceptance.


Phase 5.1 Hybrid Mapping Controls were added in release 0.7.0; see `HYBRID_MAPPING.md`.
