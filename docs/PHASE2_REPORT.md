# Phase 2 report: optimisation layer

## Delivered (executed, 35 tests pass; 11 are new)
`chromabook_engine.optimize`: diagnostics, framing proposals, 3 mm hard constraint inside the search, staged candidate
search with pruning, per-group normalised ranking with tie dead-bands, confidence, JSON/Markdown report, `optimize` CLI.

    python -m chromabook_engine.cli optimize photo.jpg --palette data/main-21.palette.json --out out \
        --panel-mm 130 180 --min-cell-mm 3.0

## Pipeline (each stage prunes; every candidate is recorded with config, metrics, score)
0. diagnostics (contrast, brightness, noise, sharpness, palette gap) + framing proposals
1. preprocessing screen: <=6 diagnostic-driven recipes, engine B, preview resolution, fixed grid -> keep 2
2. engines A-D on the kept recipes -> keep 2 (recipe, engine) combos
3. resolution sweep over grids that satisfy the cell-size constraint; pick the knee (next step gains < 0.35 dE00)
4. finalists re-run at `final_side` (Phase 1 showed 900 px != full resolution), +/-1 L* stability on the top 3
5. winning recipe applied to the other framings; shown, NOT ranked

## Decisions that differ from a naive design (and why)
- **Min cell size is a filter in candidate generation**, not a post-hoc check. Infeasible specs raise; they are never relaxed.
- **No cross-grid and no cross-framing ranking.** dE00 improves with any finer grid, and different crops show different
  content. Ranking happens inside comparable groups only; the grid is chosen by diminishing returns.
- **Framing is rule-based**: trimming empty borders is the default (loses no content); a subject crop is an owner decision.
- **Mosaic-aware structure metric** compares neighbouring-cell transitions, so cell borders do not create fake edges.
- **Tie dead-band**: gaps below half the noise floor cost nothing (a test found 0.05 dE00 costing ~6 points before this fix).
- **Confidence measures decisiveness** (margin to #2, metric agreement, stability), not beauty. A near-tie can never be "high".

## Known limits (do not assume otherwise)
- **Validated on synthetic images only.** Your four original photos were not in the upload (only their Phase 1 outputs),
  so score weights and floors (`scoring.METRICS`) are untuned defaults. Calibration needs your 15-20 real images.
- **Panel size 130x180 mm is an assumption** until Phase 5 defines layout classes. At 3 mm that caps the grid at about 40 columns.
- The resolution curve is noisy (grid changes alter rows and trimming); the knee rule is a heuristic, not a proof.
- Only two finalists are compared; a candidate pruned early at preview resolution is never revisited.
- Stability is measured on the top 3 only. Legibility check assumes number height = 0.5 x cell.
- Still absent: Phases 3-7 (web UI, library/database, Book Studio and vector PDF, cloud, acceptance).
