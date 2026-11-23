# Recommendation (confidence: high, 93/100)

- Framing: **full**   Preprocess: **minimal**   Engine: **B**
- Grid: **46 x 69**, cell **3.29 mm**
- dE00 mean 13.0978, p95 29.4749, singletons 7.9395 %, cell-structure F1 0.7504

## Why
- hard constraint: cell 3.29 mm >= 3.0 mm
- grid: smallest grid whose next step gains < 0.35 dE00 (diminishing returns; larger cells are easier to colour)
- best of 2 finalists on normalised metrics
- score margin to runner-up 13.7 pts
- 4/5 metrics favour the winner
- +/-1 L* stability 96.4 %

## Resolution curve (best recipe)
| cols | rows | cell mm | dE00 mean | singleton % |
|---|---|---|---|---|
| 16 | 24 | 9.458 | 16.449 | 19.01 |
| 22 | 33 | 6.879 | 15.262 | 14.33 |
| 28 | 42 | 5.405 | 14.306 | 9.44 |
| 34 | 51 | 4.451 | 13.754 | 8.94 |
| 40 | 60 | 3.783 | 13.27 | 8.12 |
| 46 | 69 | 3.29 | 12.855 | 8.29 |

## Framing proposals
- `full` (0.0, 0.0, 1.0, 1.0) - whole image (default)

## Diagnostics flags
- none

_Metrics rank candidates against each other; they do not certify the printed result. Visual QA by the owner is still required._