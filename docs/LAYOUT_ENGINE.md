# Layout engine (first slice of Phase 5)

Geometry is derived from your confirmed A4 specs; no panel size is hardcoded.

| | page | usable | slot | spiral |
|---|---|---|---|---|
| side_by_side | 297x210 landscape | 267 x 186 | 129.5 x 186 (x2, gap 8) | left short edge, inner 18 / outer 12 / top+bottom 12 |
| full_page | 210x297 portrait | 180 x 273 | 180 x 273 | left long edge, same margins |

Slot x-positions (side_by_side): left 18-147.5 mm, right 155.5-285 mm. Fill order is right slot first (reading order as stated).

## How the artwork area is computed
1. Guide footprint from the number of colours (swatch 6 mm, entry 36 x 7 mm, 2 mm column gap), tried **below** and **beside** the artwork.
2. Artwork area = slot minus guide minus 4 mm spacing.
3. cell = min(area_w / cols, area_h / rows); the drawn grid is exactly cols x cell by rows x cell (square cells), centred.
4. Classification uses cell size only: side_by_side if cell >= 3 mm, else full_page if >= 3 mm, else REJECTED.
5. While searching, the guide is sized for the FULL palette (worst case); the final layout uses the colours actually used, so the real cell can only be equal or larger.

## What the real geometry changed (vs my earlier 130 x 180 mm assumption)
With a 21-colour guide a 2:3 image reaches 3 mm at about 28 columns side-by-side (earlier assumption: 40) and about 48 columns full page.
Decimal check: 28x42 side-by-side = 3.20 mm with the full-palette guide, 3.33 mm with the 17 colours the parrot really uses.

## Parrot result (examples/parrot/*)
| book | grid | colours used | cell | artwork | guide | engine / confidence |
|---|---|---|---|---|---|---|
| side_by_side | 28 x 42 | 17 | 3.333 mm | 93.3 x 140.0 mm | 112 x 42 mm, below, 3 cols | B / high |
| full_page | 46 x 69 | 19 | 3.391 mm | 156.0 x 234.0 mm | 150 x 35 mm, below, 4 cols | B / high |

Each folder has `layout_report.md/.json`, `optimization_report.md/.json`, a numbered vector PDF and a coloured answer-key PDF.

## Limits
- One real image so far. "High" confidence means B clearly beat the other candidates on this image, not that the metric weights are calibrated.
- The guide design (entry size, placement rule) is my choice; change `GuideSpec` if you want another look.
- PDFs are RGB and Helvetica only (no Persian text, no covers, no reports, no PDF/X). Single image per run, so the left slot of side_by_side is blank in the demo.
- Black numbers on dark colours are hard to read in the coloured answer key; the numbered sheet is on white and unaffected.
- Not built: web UI (3), library/database (4), book assembly with covers and RTL text (5, rest), cloud deployment (6), acceptance run (7).
