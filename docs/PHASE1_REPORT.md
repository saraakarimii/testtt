# Phase 1 report

## Delivered (all executed, not mocked)
Image normalisation; crop / content zoom / padding / square-cell snap; preprocessing incl. brightness/contrast;
edge map; four engines; colour preview + numbered grid from one label matrix; quality metrics; +/-1 L* stability;
staged cache; asset export; CLI; 24 automated tests (3 deliberate-defect mutations were each caught).

## Not in Phase 1 (do not assume it exists)
Automatic crop, automatic content-zoom search, diagnostics report, candidate generation / ranking / confidence,
grid-resolution search, batch/ZIP import, palette import UI, revisions/database, PDF/vector output, web UI.
ICM and Engine D's region costs are still per-cell Python loops (no numba in this environment).

## Measured on the four sample images (main-21 palette, 36 columns, engines A-D)
Per-pixel dE00 against the source (note: includes within-cell detail that no grid can keep):

| image | grid | dE00 mean A / B / C / D | singleton % A / B / C / D | transition % A / B / C / D |
|---|---|---|---|---|
| tulips  | 36x54 | 15.7 / 15.1 / 15.1 / 15.0 | 13.7 / 13.3 / 7.9 / 9.2  | 50.7 / 49.7 / 43.2 / 44.5 |
| unicorn | 36x54 | 14.9 / 14.3 / 14.3 / 14.2 | 15.1 / 10.0 / 4.4 / 5.9  | 48.4 / 42.6 / 36.9 / 38.9 |
| cat*    | 36x51 | 13.5 / 13.1 / 13.1 / 13.1 | 8.8 / 9.4 / 6.3 / 7.1    | 38.2 / 40.2 / 35.2 / 36.1 |
| mermaid | 36x54 | 12.9 / 12.8 / 12.8 / 12.8 | 15.4 / 15.3 / 11.6 / 12.8 | 48.4 / 46.9 / 42.7 / 44.2 |
(*cat uses a manual crop that removes the "cutie cat" text.)  Full numbers: `examples/summary.json`.

What this says: on these images the engines are within ~1 dE00 of each other; C and D mainly reduce isolated cells
and transitions. On unicorn, C/D raise the P95 dE00 slightly (33.5 -> 34.7 for C), i.e. the smoothing has a cost.
Mean stability under +/-1 L* is 95.7-97.5 % for every engine. Engine run time: A/B/C < 0.15 s, D ~1.6-2.3 s per image;
the whole four-engine run incl. cost volume and SLIC is ~5 s per image on this sandbox.

## Findings that change later phases
1. **Working resolution matters.** Mapping at 900 px vs the full original gave 92.3-95.7 % identical labels (engine B).
   So the 900 px notebook default is not a harmless detail: Phase 2 will screen at low resolution and re-run
   finalists at full resolution before recommending.
2. **The palette is the dominant limit.** Pale sky blues map to Light Gray (04) with scattered Cyan (17); reds/oranges of
   small flowers fall to Brown (07). Engines cannot fix this. Adding a pale blue, pale yellow and light pink would help more
   than any tuning (your decision).
3. Absolute SSIM (0.26-0.54) and Edge F1 (~0.2-0.27) are low for every engine because pixel-art cells cannot reproduce
   fine pencil texture; they are only meaningful as relative comparisons within one image. Phase 2 scoring will not use them alone.
4. Notebook quirk reproduced on purpose: "tiny component" ratio counts components of size <= 2, which includes singletons.

## Phase 2 inputs I will use
Real images (more than four, incl. harder ones), your answer on extending the palette, and confirmation of the 3 mm
constraint integration (cell size as a hard filter in the candidate search).
