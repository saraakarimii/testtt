# Phase 1 architecture

    imaging.normalize_image  -> NormalizedImage (sRGB uint8, EXIF fixed, alpha on white, SHA256 of file bytes, read-only)
    imaging.frame_image      -> crop -> content zoom -> padding -> square-cell snap -> working-resolution resize
    preprocess.preprocess    -> brightness/contrast, illumination, CLAHE, denoise, multiscale sharpen (all stages kept)
    edges.extract_edges      -> Scharr + Canny (+closing) -> boundary-strength map
    unary.build_cell_unary   -> per-cell CIEDE2000 cost volume (stratified vectorised, or notebook-"legacy" sampling)
    slic_map.make_slic       -> low-level superpixels (NOT object detection)
    engines.run_engine       -> A / B / C / D  ->  labels (palette indices) + selected per-cell cost + cost_kind
    render.*                 -> preview (nearest-neighbour) and numbered grid, both from labels only
    metrics.*                -> dE00, SSIM, edge F1, singleton/tiny/transition, utilisation; pipeline.stability: +/-1 L*
    pipeline.Pipeline        -> staged execution with StageCache keys (frame, pre, edge, unary, slic, engine:X)
    export.export_asset      -> per-asset package: pngs, grid_indices.bin/.npy, cell_delta_e.bin, palette/metadata/metrics/config

## Cache keys
frame = sha(source, framing, grid_cols); pre = sha(frame, preprocess); edge = sha(pre, edges);
unary = sha(pre, palette sha256, cols, samples, trim, sampling); slic = sha(pre, segments, compactness);
engine = sha(engine, unary, edge, slic, only that engine's own parameters). RenderConfig is in no key.

## Stored per-cell cost (never mislabel)
A: deltaE76 of the cell's mean Lab to the chosen palette colour. B/C: mean per-pixel CIEDE2000 (trimmed) of the chosen label.
D: the blend of cell-wise and region-balanced CIEDE2000 costs. `metadata.json` records `cell_cost_kind`.

## Differences from the notebook (all deliberate)
1. No globals: palette, pipeline state and config are explicit arguments.
2. `sampling="stratified"` (default): fixed 2-D sample grid per cell, vectorised across cells. `"legacy"` reproduces the notebook exactly.
3. Cells are made exactly square by trimming <= half a cell (`snap_square_cells`); the notebook rounds rows and leaves cells slightly non-square.
4. Numbered grid draws each boundary once (uniform thickness incl. outer border); the notebook drew per-cell rectangles, which made interior lines 3 px against a 2 px border at width 2 (measured).
5. Added: brightness/contrast, Scharr weight and edge sensitivity, normalised crop, content zoom, padding, palette identity/version/hash, stage cache.

## Phase 2 additions
    optimize.constraints -> PrintSpec, hard min-cell filter, legibility check
    optimize.diagnostics -> flags driving preprocessing candidates
    optimize.autocrop    -> framing proposals (full / trim_border / subject)
    optimize.scoring     -> rank within comparable groups, dead-band ties, confidence
    optimize.optimizer   -> staged pruned search, report writer
