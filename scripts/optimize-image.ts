// Finds the fewest columns (and preset/engine) with the best fidelity per colouring effort,
// then renders the result. No database or web server needed.
// Usage: npm run optimize:image -- <image> [--out out] [--effort 1] [--presets balanced,cartoon] [--bg off|simple|ai]
import fs from 'node:fs';
import path from 'node:path';
import { optimizeGrid } from '../server/optimize.js';
import { runImageAndSave } from '../server/mapping.js';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};
const image = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));
if (!image || !fs.existsSync(image)) {
  console.error('Usage: npm run optimize:image -- <image> [--out dir] [--effort 1] [--presets a,b] [--bg off|simple|ai]');
  console.error('effort: higher = fewer columns, lower = more detail (default 0.5)');
  process.exit(1);
}
const outDir = path.resolve(opt('out') ?? 'out');
fs.mkdirSync(outDir, { recursive: true });

const overrides: Record<string, unknown> = {};
if (opt('bg')) overrides.bg_mode = opt('bg');

console.log('Searching for the smallest grid with the best fidelity per effort...');
const result = await optimizeGrid(path.resolve(image), {
  effort: opt('effort') ? Number(opt('effort')) : undefined,
  presets: opt('presets')?.split(',').map((s) => s.trim()),
  overrides,
});
console.log(result.reason);
console.table(result.curve.map((p) => ({ cols: p.cols, score: p.score, smoothed: p.smoothed, utility: p.utility, ssim: p.ssim, edge_f1: p.edge_f1, dE00: p.delta_e00, recall: p.detail_recall })));
console.log('Effort levels (higher = fewer columns):', result.effort_options.map((o) => `${o.effort} -> ${o.grid_cols}`).join(', '));
console.log('Presets (mean score):', result.presets_tested.map((p) => `${p.preset} ${p.mean_score}`).join(', '));
console.log('Engines at chosen width:', result.engines_at_choice.map((e) => `${e.engine} ${e.score}`).join(', '));

const run = await runImageAndSave(path.resolve(image), outDir, result.params as unknown as Record<string, unknown>, result.engine, false);
fs.writeFileSync(path.join(outDir, 'grid_optimization.json'), JSON.stringify(result, null, 2));
console.log(`Rendered ${result.grid_cols}x${result.rows} with engine ${run.engine} in ${outDir} (search ${result.runtime_seconds}s)`);
