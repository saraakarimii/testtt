import assert from 'node:assert/strict';
import { isotonicIncreasing, optimizeGrid } from '../server/optimize.js';
import { maxColsForLayout } from '../server/book.js';

// 1. Isotonic smoothing is non-decreasing and keeps the mean
const y = [0.30, 0.36, 0.33, 0.40, 0.39, 0.45];
const z = isotonicIncreasing(y);
for (let i = 1; i < z.length; i++) assert.ok(z[i] >= z[i - 1] - 1e-12, 'isotonic output must be non-decreasing');
assert.ok(Math.abs(y.reduce((a, b) => a + b) - z.reduce((a, b) => a + b)) < 1e-9, 'isotonic keeps the total');

// 2. Optimiser on a real fixture
const image = 'inputs/birds_03_snowy_owl.jpg';
const r = await optimizeGrid(image, { presets: ['balanced', 'cartoon'] });
assert.ok(r.grid_cols >= r.min_cols_tested && r.grid_cols <= r.max_cols_allowed, 'cols within allowed range');
assert.ok(r.max_cols_allowed <= maxColsForLayout(1, 'full_page', 21) + 1, 'never exceeds the 3 mm full-page limit');
assert.equal(r.params.grid_cols, r.grid_cols, 'returned params carry the chosen width');
assert.ok(['A', 'B', 'C', 'D'].includes(r.engine));
assert.ok(r.layout === (r.grid_cols <= r.side_by_side_max_cols ? 'side_by_side' : 'full_page'));
const sm = r.curve.map((p) => p.smoothed);
for (let i = 1; i < sm.length; i++) assert.ok(sm[i] >= sm[i - 1] - 1e-9, 'smoothed curve monotone');

// 3. More effort weight never increases the column count
const opts = r.effort_options.map((o) => o.grid_cols);
for (let i = 1; i < opts.length; i++) assert.ok(opts[i] <= opts[i - 1], `effort ${r.effort_options[i].effort} must not use more columns`);

console.log('Grid optimiser tests passed:', {
  chosen: `${r.grid_cols}x${r.rows}`, preset: r.preset, engine: r.engine, layout: r.layout,
  effort_options: r.effort_options.map((o) => `${o.effort}->${o.grid_cols}`).join(' '),
  seconds: r.runtime_seconds,
});
