# Phase 5.1 — Interactive Hybrid Image Optimization

This implementation is based on the actual controls and algorithms in `ChromaBook_Advanced_Mapping_Lab_v2.ipynb`.

## Workflow

1. Upload an image.
2. Run Automatic using the Notebook v2 default parameter set.
3. Compare the four independent engines A/B/C/D using their previews and metrics.
4. Select the asset in Hybrid Mapping Controls.
5. Change any Notebook v2 parameter and reprocess. The original uploaded file is always used as the input; processed previews are never fed back as source.
6. Each processing run stores its own parameter JSON, selected engine, all four engine previews, all four metric sets and output labels.
7. Approve the desired result and use that run's selected-engine labels in book assembly.

## Parameter contract

The API `GET /api/mapping/defaults` returns the exact defaults and widget bounds for the Notebook v2 controls. `POST /api/assets/{asset_id}/process` accepts:

```json
{
  "params": {
    "max_side": 900,
    "crop_enabled": false,
    "crop_x0": 0,
    "crop_y0": 0,
    "crop_x1": 100,
    "crop_y1": 100,
    "illumination_strength": 0.25,
    "illumination_sigma": 0.1,
    "clahe_clip": 1.5,
    "clahe_tiles": 8,
    "denoise_method": "bilateral",
    "denoise_strength": 18,
    "sharpen_fine": 0.15,
    "sharpen_coarse": 0.05,
    "auto_canny": true,
    "canny_low": 55,
    "canny_high": 145,
    "edge_close": 1,
    "grid_cols": 40,
    "max_samples": 96,
    "trim_fraction": 0.03,
    "smoothness_lambda": 1.8,
    "boundary_beta": 4.0,
    "icm_iterations": 5,
    "slic_segments": 320,
    "slic_compactness": 10,
    "region_balance": 0.25,
    "numbered_cell_px": 44,
    "numbered_line_width": 2
  },
  "selected_engine": "D",
  "run_stability": false
}
```

All keys above are the Notebook's `get_params()` keys. No extra image-processing sliders are introduced. The `run_stability` flag corresponds to the Notebook's separate optional “Stability Test ±1 L*” action, not a new mapping parameter.

## Notebook algorithms retained

- Alpha compositing onto white and EXIF orientation correction.
- Crop/resize and illumination correction.
- CLAHE on luminance, selectable bilateral/NLM/median denoising and multiscale sharpening.
- Scharr gradient plus Canny edge extraction and morphological closing.
- Grid-cell CIEDE2000 unary costs with deterministic pixel sampling and trimmed mean.
- Engine A: legacy mean-Lab / ΔE76.
- Engine B: cell-wise CIEDE2000.
- Engine C: boundary-aware ICM.
- Engine D: SLIC region-balanced unary costs plus boundary-aware ICM.
- Pixel preview and numbered grid rendering.
- Metrics: ΔE00 mean/median/p95, SSIM, Edge F1/precision/recall, colors used, singleton ratio, tiny-component ratio and transition rate.
- Optional ±1 L* stability test for B/C/D.

## Palette lock

The Notebook's sample palette editor is intentionally not exposed. The server always loads `data/main-21.palette.json`, checks for exactly 21 colours and retains its explicit printed IDs. No palette upload, palette editing or colour addition is possible from the Hybrid UI.

## API and persistence

- `GET /api/mapping/defaults`: parameter defaults, control ranges, engine list, and named presets (`presets`, `auto_preset`).
- `POST /api/assets/{id}/process`: accepts `{ preset?, selected_engine?, bg_removal?, run_stability?, params? }`. Parameters resolve in strict precedence `DEFAULT_PARAMS < preset < auto_adjustments < bg_removal < explicit params`, preserving full parity for `preset: "balanced"` (with `bg_mode: "off"`) and legacy `{ selected_engine: "D", params: {} }` payloads.
- `GET /api/assets`: latest run, complete run history, stored configs, warnings, `auto_selection`, `mask_url`, and metric summaries.
- `GET /api/assets/{id}/preview/engine_A/numbered_preview.png` (A/B/C/D) and `GET /api/assets/{id}/runs/{runId}/preview/mask.png`.
- Every run has a separate output folder and persisted `params_json`, so previous results are retained.

## Presets, Auto Mode, 3 mm Rule & Background Removal (v0.8.0)

- **Presets (`server/presets.ts`)**: `balanced` (General), `nature` (Nature & landscapes), `detailed` (High detail, `full_page`), `cartoon` (Flat illustration), `portrait` (Portrait, auto-selects among B/C/D), and `simple_kids` (Simple, capped at 24 columns).
- **Auto mode (`preset: "auto"`, `selected_engine: "auto"`)**: analyzes image edge density, luminance std-dev, saturation, dominant color bins, noise, and border uniformity to select an optimal preset, tune denoising/illumination, and rank engines A–D via `0.35*SSIM + 0.25*Edge_F1 + 0.25*(1 - clamp(dE/25, 0, 1)) + 0.15*compactness` with `high`/`medium`/`low` confidence.
- **3 mm printed cell guarantee (`maxColsForLayout`)**: presets and auto mode cap `grid_cols` to `maxColsForLayout(aspectRatio, targetLayout, 21)` so every printed cell stays ≥ 3.0 mm. Explicit user `grid_cols` overrides are permitted with an attached non-blocking warning surfaced in Processing Lab and Book Builder preflight.
- **Background removal (`bg_mode`: `off` | `simple` | `ai`, `bg_tolerance`, `bg_feather`)**: computed after crop/resize and before illumination/CLAHE so background pixels do not skew foreground tone statistics; background cells are mapped to palette colour id `"05"` (White) before rendering and metrics are evaluated on foreground only. `ai` mode uses Gemini segmentation when `GEMINI_API_KEY` is configured and falls back cleanly to `simple` border flood-fill otherwise.
- **Auto-process on upload**: uploads immediately enqueue `/process` with concurrency limited to 2 jobs and live row status updates (`Uploaded → Queued → Processing → Ready for review`).

## Important boundary

This path uses the Notebook v2 mapping implementation. It is not silently blended with the earlier Phase 2 optimizer. The Phase 5 book assembly consumes the selected engine's `labels.npy` from the latest approved processing run.
