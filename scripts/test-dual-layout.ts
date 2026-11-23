import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assembleDualLayoutBooks } from '../server/book.js';
import { loadPalette } from '../server/mapping.js';

const palette = loadPalette(path.resolve('data/main-21.palette.json'));
const makeArt = (name: string, cols: number, rows: number) => ({
  name,
  cols,
  rows,
  labels: Uint8Array.from({ length: cols * rows }, (_, i) => i % 2),
});

const output = fs.mkdtempSync(path.join(os.tmpdir(), 'chromabook-dual-layout-'));
try {
  const result = await assembleDualLayoutBooks(
    output,
    'DUAL LAYOUT TEST',
    'Automatic A4 classification',
    [
      makeArt('side-by-side-candidate', 28, 42),
      makeArt('full-page-candidate', 44, 66),
      makeArt('too-dense-candidate', 120, 180),
    ],
    palette,
    3.0,
  );

  if (!result.preflight.passed) throw new Error('Dual-layout preflight did not pass.');
  if (!fs.existsSync(result.side_by_side) || !fs.existsSync(result.full_page)) {
    throw new Error('Both A4 PDF outputs must always be generated.');
  }
  for (const file of [result.side_by_side, result.full_page]) {
    const signature = fs.readFileSync(file).subarray(0, 5).toString('ascii');
    if (signature !== '%PDF-') throw new Error(`Invalid PDF output: ${file}`);
  }

  const report = JSON.parse(fs.readFileSync(result.report, 'utf8'));
  if (!report.totals.accounted_for) throw new Error('Not all input images were classified.');
  if (report.totals.paired_layout !== 1 ||
      report.totals.single_page_layout !== 1 ||
      report.totals.rejected !== 1) {
    throw new Error(`Unexpected classification counts: ${JSON.stringify(report.totals)}`);
  }
  console.log('Dual-layout PDF test passed:', report.totals);
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}
