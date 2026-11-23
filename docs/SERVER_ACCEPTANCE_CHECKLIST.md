# ChromaBook Studio — Server Acceptance Checklist

Use this after deployment on the target server. Record the server OS, Docker version, date and test operator before signing off.

## A. Deployment and health
- [ ] `docker compose up -d --build` completes without errors.
- [ ] `db`, `web` and `worker` containers remain healthy/running.
- [ ] `GET /health` returns HTTP 200.
- [ ] Alembic reports the expected current revision (`0001_initial`).
- [ ] The dashboard loads over SSH tunnel or HTTPS reverse proxy.
- [ ] Requests to protected `/api/*` endpoints fail without the admin token and succeed with it.
- [ ] The app is not directly exposed over public plain HTTP.

## B. Project and library
- [ ] Create a project.
- [ ] Upload one valid JPG and one valid PNG.
- [ ] Invalid file extensions and malformed image bytes are rejected.
- [ ] Upload-size limit is enforced.
- [ ] Upload the same logical artwork name again; version increments and old source remains.
- [ ] Verify SHA-256 values and project ownership.
- [ ] Verify project and asset records remain after restarting `web` and `worker`.

## C. Processing and review
- [ ] Queue processing for one test image.
- [ ] Worker claims the job and the state progresses to `processing`.
- [ ] Processing finishes with preview, numbered preview, labels and reports.
- [ ] Confidence and selected engine are visible in the library.
- [ ] Approve an image; reject another.
- [ ] Verify an image cannot be approved before a completed processing run.
- [ ] Verify a rejected/unapproved image cannot be added to a book.
- [ ] Upload a revision and confirm previous version remains accessible.
- [ ] Stop/restart the worker during a test job and verify queued recovery behaviour.

## D. Book production
- [ ] Select at least one approved image and build a book.
- [ ] Verify the separate cover page.
- [ ] Verify right-hand slot is filled first for side-by-side layout.
- [ ] Verify unused final slot remains blank.
- [ ] Verify folios, cell size, margins and palette-ID checks in the preflight report.
- [ ] Verify answer key is a separate PDF.
- [ ] Verify answer-key numbers remain legible on dark and light cells.
- [ ] Verify generated PDFs open in at least two independent PDF readers.
- [ ] Confirm exactly 21 palette colours and unchanged palette IDs.

## E. Hybrid mapping controls (Notebook v2)
- [ ] Automatic processing uses the Notebook v2 defaults.
- [ ] UI shows only parameters defined by Notebook v2 `get_params()` and its widget bounds.
- [ ] Crop, illumination, CLAHE, denoise and sharpening controls persist per run.
- [ ] Auto Canny / manual thresholds and edge-close controls work.
- [ ] Grid, sampling, trim, ICM, SLIC, region-balance and numbered-grid controls work.
- [ ] A/B/C/D previews and metric comparison are available.
- [ ] Manual reprocessing always starts from the untouched original upload.
- [ ] Previous runs and their config JSON remain accessible.
- [ ] Optional ±1 L* stability results are recorded for B/C/D.
- [ ] Palette is exactly 21 colours and there is no palette editor in the UI.

## E. Persistence, security and operations
- [ ] Restart all containers; verify projects, assets, runs, books and outputs persist.
- [ ] Verify uploaded files and generated PDFs remain on the persistent data volume.
- [ ] Create a PostgreSQL dump and a file-volume archive.
- [ ] Restore both backups to a test instance.
- [ ] Verify the admin token is not committed to source control or exposed in logs.
- [ ] Verify TLS certificate and reverse-proxy upload limit.
- [ ] Observe memory, CPU, disk usage and processing time with a representative batch.

## Release decision
- [ ] PASS — suitable for the next controlled pilot.
- [ ] FAIL — defects recorded below and retest required.

Defects / notes:
