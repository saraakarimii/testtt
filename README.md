# ChromaBook Studio

Turns images into printable colour-by-number pages. Each image becomes a discrete grid (one palette index per cell) and both the colour preview and the numbered grid are rendered from the same label matrix. Four mapping engines (A: mean-Lab/dE76, B: CIEDE2000, C: edge-aware ICM, D: SLIC region-aware ICM) run in TypeScript (`server/mapping.ts`). Books are assembled as A4 PDFs with a separate answer key.

Stack: Node.js 22, Express 5, sharp, pdfkit, PostgreSQL via Drizzle ORM. There is no sign-in; every browser uses one shared workspace.

## Quick start (Docker)

```bash
cp .env.example .env        # set POSTGRES_PASSWORD (and optionally GEMINI_API_KEY)
docker compose up -d --build
# open http://127.0.0.1:3000
```

The web container applies database migrations on start. The port is bound to loopback; expose it through an HTTPS reverse proxy (`docs/nginx.example.conf`) or an SSH tunnel. The app has no authentication, so do not expose it publicly as-is.

## Local development

```bash
npm install
cp .env.example .env        # point SQL_* at your own Postgres
npm run db:migrate
npm run dev                 # http://localhost:3000
```

| Script | Purpose |
|---|---|
| `npm run dev` | run the server with tsx |
| `npm run build` / `npm start` | compile to `dist/` and run |
| `npm run lint` | type-check |
| `npm run db:generate` | generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | apply migrations |
| `npm run test:dual-layout` | dual-layout PDF classification test |
| `npm run test:image-profiles` | image preset/profile test |
| `npm run test:verify` | pipeline checks (presets, 3 mm rule, parity, background removal) |
| `npm run test:optimizer` | grid-size optimiser test (about 30 s) |
| `npm run optimize:image -- <image>` | find the best grid size for one image |
| `npm run process:image -- <image>` | run one image with chosen settings |

## Testing image processing on its own (no database or server)

```bash
npm run test:verify          # 6 checks: preset bounds, 3 mm rule, pipeline parity, background removal, auto preset/engine, overrides
npm run test:image-profiles  # analyses the 8 fixtures in inputs/image-processing-tests and prints the detected profile
npm run test:dual-layout     # side-by-side / full-page / rejected classification + PDFs
npm run process:image -- inputs/birds_03_snowy_owl.jpg --out out --preset balanced --cols 30
```

`process:image` options: `--preset` (balanced, nature, detailed, cartoon, portrait, simple_kids), `--engine A|B|C|D`, `--cols N`, `--bg off|simple|ai`, `--stability`. It writes `color_preview.png`, `numbered_preview.png`, `labels.json`, `config.json`, per-engine folders and metrics to the output folder.

## Automatic grid size (fewest columns, best result)

Fidelity to the source always improves with more columns, so "best result" has to be weighed against how many cells a person must colour. `server/optimize.ts` does this:

1. Tries several presets and keeps the one with the best mean score.
2. Measures a quality score (SSIM, edge F1, ΔE00, compactness, plus retention of small high-contrast details such as eyes and berries) for every grid width from 16 columns up to the 3 mm limit.
3. Smooths the curve and picks the smallest width whose gain beats its cost (number of cells grows with the square of the columns).
4. Compares engines B/C/D at that width and renders the result.

The weight is `effort` (default 0.5; higher = fewer columns, lower = more detail). The result lists where every effort level would land, e.g. `0.25 -> 60, 0.5 -> 48, 1 -> 30`.

```bash
npm run optimize:image -- inputs/birds_03_snowy_owl.jpg --out out            # default effort 0.5
npm run optimize:image -- inputs/birds_03_snowy_owl.jpg --out out --effort 1  # fewer columns
npm run test:optimizer
```

In the web app, processing with `preset: "auto"` runs the optimiser unless `grid_cols` is given explicitly; send `"auto_grid": false` to turn it off, or `"effort": 1` to change the trade-off. The decision is stored in the run config as `grid_optimization` and in `grid_optimization.json`. The search takes roughly 30 s per image.

Known limits: the score is a proxy, so check the preview. Detail-rich images land on more columns, and images that need more than the side-by-side limit are laid out one per page.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD` | | runtime DB connection |
| `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD` | | used by drizzle-kit |
| `CHROMABOOK_DATA_DIR` | `./var` (`/data` in Docker) | uploads and generated files |
| `MAX_UPLOAD_MB` | 25 | upload size cap |
| `GEMINI_API_KEY` | unset | optional, for `bg_mode=ai`; falls back to simple border removal |
| `PORT` / `HOST` | 3000 / 127.0.0.1 (0.0.0.0 in Docker) | listen address |

## Features

- Projects, versioned uploads (SHA-256 fingerprint), review/approve/reject workflow, audit log.
- Presets (`balanced`, `nature`, `detailed`, `cartoon`, `portrait`, `simple_kids`) plus `auto`; optional ±1 L* stability test; optional background segmentation mapped to colour `"05"` (White). See `docs/HYBRID_MAPPING.md`.
- Palette locked to `data/main-21.palette.json` (exactly 21 colours).
- Automatic dual-layout books: `side_by_side.pdf` (A4 landscape, two slots per page) for artwork meeting the 3 mm minimum cell size, `full_page.pdf` (A4 portrait) for the rest, and `dual_layout_report.json` listing rejected images and reasons. Each book has a matching answer-key PDF.

## Docs

`docs/CLOUD_RUN.md` (Google Cloud), `docs/SERVER_DEPLOYMENT.md`, `docs/LAYOUT_ENGINE.md`, `docs/HYBRID_MAPPING.md`, `docs/ARCHITECTURE.md`. The `PHASE*_REPORT.md` files are historical records from an earlier Python prototype and may mention tooling that is no longer included.

## Limitations

Single-host deployment; no SSO/roles, no distributed storage, and image processing runs in the web process (no separate worker).
