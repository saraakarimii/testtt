# Recommendation (confidence: high, 93/100)

- Framing: **full**   Preprocess: **minimal**   Engine: **B**
- Grid: **28 x 42**, cell **3.196 mm**
- dE00 mean 14.52, p95 36.6998, singletons 9.6939 %, cell-structure F1 0.7682

## Why
- hard constraint: cell 3.196 mm >= 3.0 mm
- grid: smallest grid whose next step gains < 0.35 dE00 (diminishing returns; larger cells are easier to colour)
- best of 2 finalists on normalised metrics
- score margin to runner-up 20.0 pts
- 4/5 metrics favour the winner
- +/-1 L* stability 96.4 %

## Resolution curve (best recipe)
| cols | rows | cell mm | dE00 mean | singleton % |
|---|---|---|---|---|
| 16 | 24 | 5.594 | 16.449 | 19.01 |
| 22 | 33 | 4.068 | 15.262 | 14.33 |
| 28 | 42 | 3.196 | 14.306 | 9.44 |

## Framing proposals
- `full` (0.0, 0.0, 1.0, 1.0) - whole image (default)

## Diagnostics flags
- none

_Metrics rank candidates against each other; they do not certify the printed result. Visual QA by the owner is still required._