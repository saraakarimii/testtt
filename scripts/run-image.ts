// Standalone image-processing run (no database, no web server).
// Usage: npm run process:image -- <image> [--out out] [--preset balanced] [--engine D] [--cols 36] [--bg off|simple|ai] [--stability]
import fs from 'node:fs';
import path from 'node:path';
import { runImageAndSave, validateParams } from '../server/mapping.js';
import { PRESETS } from '../server/presets.js';

const args = process.argv.slice(2);
const image = args.find((a) => !a.startsWith('--') && !/^(--)/.test(args[args.indexOf(a) - 1] ?? ''));
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
if (!image || !fs.existsSync(image)) {
  console.error('Usage: npm run process:image -- <image> [--out dir] [--preset name] [--engine A|B|C|D] [--cols N] [--bg off|simple|ai] [--stability]');
  console.error('Presets:', Object.keys(PRESETS).join(', '));
  process.exit(1);
}
const presetName = opt('preset', 'balanced')!;
const preset = PRESETS[presetName as keyof typeof PRESETS];
if (!preset) throw new Error(`Unknown preset "${presetName}". Available: ${Object.keys(PRESETS).join(', ')}`);

const params: Record<string, unknown> = { ...preset.params };
if (opt('cols')) params.grid_cols = Number(opt('cols'));
if (opt('bg')) params.bg_mode = opt('bg');
validateParams(params); // fail early on bad values

const outDir = path.resolve(opt('out', 'out')!);
fs.mkdirSync(outDir, { recursive: true });
const engine = opt('engine', preset.engine)!;

const res = await runImageAndSave(path.resolve(image), outDir, params, engine, args.includes('--stability'));
console.log(JSON.stringify({ engine: res.engine, confidence: res.confidence, seconds: res.totalRuntimeSeconds, warnings: res.warnings }, null, 2));
console.log('Files written to', outDir);
for (const f of fs.readdirSync(outDir)) console.log('  ', f);
