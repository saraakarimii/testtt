# Phase 5.1 — Hybrid Mapping Implementation Report

Release: ChromaBook Studio 0.7.0

## Source of truth

The implementation is derived from the uploaded `ChromaBook_Advanced_Mapping_Lab_v2.ipynb`. The following functions were transferred from its single code cell into `src/chromabook_engine/advanced_mapping.py` with their algorithm bodies retained: preprocessing, Canny/Scharr edge extraction, grid geometry, CIEDE2000 unary mapping, trimmed means, legacy ΔE76, boundary pairwise weights, ICM, SLIC, rendering, metric evaluation, four-engine runner and ±1 L* stability test.

## Exact control contract

- The 29 API/UI parameter keys match Notebook v2 `get_params()` exactly.
- All 29 defaults and widget min/max/step declarations were compared programmatically against the Notebook and match.
- The 33 transferred core algorithm function bodies are AST-identical to the Notebook definitions.
- Default values and min/max/step metadata come from the Notebook v2 widget declarations.
- Automatic processing uses the Notebook defaults.
- Hybrid reprocessing validates only the known Notebook keys and bounds.
- The original uploaded image is reopened for every run; processed images are never used as a new source.
- Each run stores its own configuration JSON, selected engine, four-engine previews, metric comparison and labels.
- The optional stability action runs the Notebook's ±1 L* test for B/C/D.
- The UI does not expose the Notebook's sample palette upload/editor. It uses the project `main-21.palette.json` and enforces exactly 21 colours.

## User workflow

1. Upload an image and click Process. This is the automatic Notebook-default run.
2. Compare A/B/C/D previews and metric rows.
3. Click Hybrid tune on the artwork.
4. Adjust Notebook v2 controls.
5. Choose the engine whose labels should be used in the book.
6. Optionally enable ±1 L* stability.
7. Reprocess. The source and prior run remain intact.
8. Approve the preferred output and include it in a book.

## Verification

- Notebook `get_params()` keys compared programmatically: 29/29 match.
- UI control keys compared with Notebook `get_params()`: 29/29 match.
- Python source parse: passed.
- Browser JavaScript syntax check (Node `--check`): passed.
- Alembic migration to a fresh SQLite database: passed.
- Focused tests: 7 passed (Notebook engine and platform tests).
- API smoke test: automatic default run, four-engine metrics, engine-specific preview, manual reprocess with changed grid and engine, run-history persistence, old-run preview access and optional stability action passed.
- Docker image build and live PostgreSQL deployment still require verification on the target server.

## Known limitation

Notebook v2 itself does not calculate a confidence score. The app therefore records `not_computed` rather than inventing one. The Phase 2 optimizer remains a separate tool; the Hybrid UI uses the Notebook v2 mapping pipeline, and book assembly consumes the selected engine's labels.
