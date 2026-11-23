import {
  DEFAULT_PARAMS,
  analyzeImage,
  engineQualityScore,
  makeEngineRunner,
  prepareImage,
  recommendPresetFromAnalysis,
  rgbBufferToLab,
  validateParams,
  type MappingParams,
  type PreparedImage,
  type RgbImage,
} from './mapping.js';
import { maxColsForLayout } from './book.js';
import { PRESETS } from './presets.js';

export interface GridSearchOptions {
  /** Presets to try. Default: the auto-recommended preset plus balanced, cartoon and detailed. */
  presets?: string[];
  /** Engines compared at the chosen width. Default B, C, D. */
  engines?: string[];
  /** Smallest grid width considered. Default 16. */
  minCols?: number;
  /** Distance between tested widths. Default 2. */
  step?: number;
  /**
   * How much effort (number of cells to colour) is charged against fidelity. Default 0.5.
   * Higher values favour fewer columns, lower values favour more detail.
   */
  effort?: number;
  /** Cap analysis resolution during the search only. Default 600. */
  searchMaxSide?: number;
  /** User overrides applied on top of every preset (e.g. bg_mode). */
  overrides?: Record<string, unknown>;
}

export interface CurvePoint {
  cols: number;
  /** Raw quality score (SSIM, edge F1, ΔE00, compactness) of the best tested engine. */
  score: number;
  /** Score after monotone (isotonic) smoothing. */
  smoothed: number;
  /** smoothed quality gain minus effort cost, both normalised to 0..1. */
  utility: number;
  ssim: number;
  edge_f1: number;
  delta_e00: number;
  singleton_ratio_pct: number;
  /** Share of salient small-feature contrast kept (eyes, berries, highlights). */
  detail_recall: number;
}

export interface GridSearchResult {
  preset: string;
  engine: string;
  grid_cols: number;
  rows: number;
  layout: 'side_by_side' | 'full_page';
  effort: number;
  min_cols_tested: number;
  max_cols_allowed: number;
  side_by_side_max_cols: number;
  presets_tested: Array<{ preset: string; mean_score: number }>;
  engines_at_choice: Array<{ engine: string; score: number }>;
  curve: CurvePoint[];
  /** Where each effort level would land, from the same measured curve. */
  effort_options: Array<{ effort: number; grid_cols: number }>;
  params: MappingParams;
  reason: string;
  runtime_seconds: number;
}

const DEFAULT_ENGINES = ['B', 'C', 'D'];
export const DEFAULT_EFFORT = 0.5;
const PROBE_ENGINE = 'C';
const UTILITY_TOLERANCE = 0.03;

function buildParams(name: string, overrides: Record<string, unknown>, searchMaxSide: number | null) {
  const def = PRESETS[name];
  if (!def) throw new Error(`Unknown preset "${name}".`);
  const raw: Record<string, unknown> = { ...DEFAULT_PARAMS, ...def.params, ...overrides };
  if (searchMaxSide) {
    // Search-only speedups; the final run uses the preset's full max_side and max_samples.
    raw.max_side = Math.min(Number(raw.max_side), searchMaxSide);
    raw.max_samples = Math.min(Number(raw.max_samples), 32);
  }
  return validateParams(raw);
}

/** Pool-adjacent-violators: closest non-decreasing sequence (removes search noise). */
export function isotonicIncreasing(y: number[]): number[] {
  const blocks: Array<{ sum: number; n: number }> = [];
  for (const v of y) {
    blocks.push({ sum: v, n: 1 });
    while (blocks.length > 1) {
      const a = blocks[blocks.length - 2];
      const b = blocks[blocks.length - 1];
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, n: a.n + b.n });
    }
  }
  return blocks.flatMap((b) => Array<number>(b.n).fill(b.sum / b.n));
}


// ---- Small-feature retention ------------------------------------------------------------
// Whole-image fidelity metrics barely notice a lost eye or berry. This measures how much of the
// local colour contrast of the source's most salient small features survives in the mapped result.
const SALIENT_FRACTION = 0.08;
const DETAIL_WEIGHT = 0.3;

interface DetailRef {
  cols: number;
  rows: number;
  salient: number[]; // indices of salient reference cells
  contrast: Float32Array; // source contrast per reference cell
}

function cellMeansLab(lab: Float32Array, w: number, h: number, cols: number, rows: number): Float32Array {
  const sum = new Float64Array(cols * rows * 3);
  const cnt = new Uint32Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const cy = Math.min(rows - 1, Math.floor((y * rows) / h));
    for (let x = 0; x < w; x++) {
      const ci = cy * cols + Math.min(cols - 1, Math.floor((x * cols) / w));
      const i = (y * w + x) * 3;
      sum[ci * 3] += lab[i];
      sum[ci * 3 + 1] += lab[i + 1];
      sum[ci * 3 + 2] += lab[i + 2];
      cnt[ci]++;
    }
  }
  const out = new Float32Array(cols * rows * 3);
  for (let c = 0; c < cols * rows; c++) {
    const k = Math.max(1, cnt[c]);
    out[c * 3] = sum[c * 3] / k;
    out[c * 3 + 1] = sum[c * 3 + 1] / k;
    out[c * 3 + 2] = sum[c * 3 + 2] / k;
  }
  return out;
}

function neighbourContrast(means: Float32Array, cols: number, rows: number): Float32Array {
  const out = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let l = 0, a = 0, b = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = (ny * cols + nx) * 3;
          l += means[j]; a += means[j + 1]; b += means[j + 2]; k++;
        }
      }
      const i = (y * cols + x) * 3;
      out[y * cols + x] = k
        ? Math.hypot(means[i] - l / k, means[i + 1] - a / k, means[i + 2] - b / k)
        : 0;
    }
  }
  return out;
}

function buildDetailRef(prep: PreparedImage, refCols: number): DetailRef {
  const { reference } = prep;
  const rows = Math.max(4, Math.round(refCols / (reference.width / reference.height)));
  const lab = rgbBufferToLab(reference.data, reference.width * reference.height);
  const means = cellMeansLab(lab, reference.width, reference.height, refCols, rows);
  const contrast = neighbourContrast(means, refCols, rows);
  const order = [...contrast.keys()].sort((i, j) => contrast[j] - contrast[i]);
  const salient = order.slice(0, Math.max(8, Math.round(order.length * SALIENT_FRACTION)));
  return { cols: refCols, rows, salient, contrast };
}

/** 0..1: share of the salient features' local contrast that the mapped image keeps. */
function detailRecall(ref: DetailRef, mapped: RgbImage): number {
  const lab = rgbBufferToLab(mapped.data, mapped.width * mapped.height);
  const means = cellMeansLab(lab, mapped.width, mapped.height, ref.cols, ref.rows);
  const contrast = neighbourContrast(means, ref.cols, ref.rows);
  let sum = 0;
  for (const i of ref.salient) sum += Math.min(1, contrast[i] / Math.max(1e-6, ref.contrast[i]));
  return sum / ref.salient.length;
}

async function scoreAt(prep: PreparedImage, cols: number, engines: string[], ref: DetailRef) {
  const { unary, runEngine } = makeEngineRunner(prep, cols, false);
  const out: Array<{ engine: string; score: number; m: Record<string, number>; recall: number }> = [];
  for (const engine of engines) {
    const r = await runEngine(engine, prep.processedLab, unary);
    const recall = detailRecall(ref, r.pixel);
    out.push({
      engine,
      score: (1 - DETAIL_WEIGHT) * engineQualityScore(r.metrics) + DETAIL_WEIGHT * recall,
      m: r.metrics,
      recall,
    });
  }
  return out;
}

/**
 * Picks the fewest columns that give the best fidelity per unit of colouring effort.
 *
 * Fidelity against the source image always improves with more columns, so the width is the
 * maximiser of  gain(N) - effort * cost(N)  where gain is the smoothed quality score and
 * cost is the number of cells (about N^2), both normalised over the tested range. Images
 * whose quality saturates early therefore get fewer columns than detailed ones.
 * The 3 mm minimum cell size caps N for the A4 layouts.
 */
export async function optimizeGrid(
  imagePath: string,
  options: GridSearchOptions = {},
): Promise<GridSearchResult> {
  const t0 = performance.now();
  const engines = (options.engines?.length ? options.engines : DEFAULT_ENGINES).map((e) => e.toUpperCase());
  const effort = Math.max(0.05, options.effort ?? DEFAULT_EFFORT);
  const step = Math.max(1, Math.floor(options.step ?? 2));
  const overrides = options.overrides ?? {};
  const searchMaxSide = options.searchMaxSide ?? 600;

  let presetNames = options.presets?.length ? [...options.presets] : [];
  if (presetNames.length === 0) {
    const rec = recommendPresetFromAnalysis(await analyzeImage(imagePath));
    presetNames = [rec.preset, 'balanced', 'cartoon', 'detailed'];
  }
  presetNames = [...new Set(presetNames)].filter((n) => PRESETS[n]);
  if (presetNames.length === 0) throw new Error('No valid presets to optimise.');

  // ---- Stage 1: choose the preset by mean score at three widths (cheap probe engine)
  const preps = new Map<string, PreparedImage>();
  const detailRefs = new Map<string, DetailRef>();
  let aspect = 1;
  let capFull = 50;
  let capSide = 29;
  let minCols = options.minCols ?? 16;
  const presetScores: Array<{ preset: string; mean_score: number }> = [];

  for (const name of presetNames) {
    const prep = await prepareImage(imagePath, buildParams(name, overrides, searchMaxSide));
    preps.set(name, prep);
    if (presetScores.length === 0) {
      aspect = prep.reference.width / prep.reference.height;
      capFull = maxColsForLayout(aspect, 'full_page', 21);
      capSide = maxColsForLayout(aspect, 'side_by_side', 21);
      minCols = Math.min(Math.max(8, minCols), capFull);
    }
    const probes = [...new Set([minCols, Math.round((minCols + capFull) / 2), capFull])];
    const dref = buildDetailRef(prep, Math.round(capFull * 1.5)); // finer than every candidate grid
    detailRefs.set(name, dref);
    let sum = 0;
    for (const c of probes) sum += (await scoreAt(prep, c, [PROBE_ENGINE], dref))[0].score;
    presetScores.push({ preset: name, mean_score: Number((sum / probes.length).toFixed(4)) });
  }
  presetScores.sort((a, b) => b.mean_score - a.mean_score);
  const preset = presetScores[0].preset;
  const prep = preps.get(preset)!;

  // ---- Stage 2: quality curve for the chosen preset, then effort-adjusted optimum
  const widths: number[] = [];
  for (let c = minCols; c < capFull; c += step) widths.push(c);
  widths.push(capFull);
  const dref = detailRefs.get(preset)!;
  const raw: Array<{ cols: number; score: number; m: Record<string, number>; recall: number }> = [];
  for (const c of widths) {
    const r = (await scoreAt(prep, c, [PROBE_ENGINE], dref))[0];
    raw.push({ cols: c, score: r.score, m: r.m, recall: r.recall });
  }
  const smoothed = isotonicIncreasing(raw.map((r) => r.score));
  const s0 = smoothed[0];
  const sN = smoothed[smoothed.length - 1];
  const range = sN - s0;
  const n0 = widths[0];
  const nN = widths[widths.length - 1];

  const gains = smoothed.map((v) => (range > 0 ? (v - s0) / range : 0));
  const costs = widths.map((c) => (nN > n0 ? (c * c - n0 * n0) / (nN * nN - n0 * n0) : 0));
  const pickIndex = (e: number): number => {
    if (range < 0.02) return 0; // flat curve: extra columns add nothing
    const u = gains.map((g, i) => g - e * costs[i]);
    const top = Math.max(...u);
    const idx = u.findIndex((v) => v >= top - UTILITY_TOLERANCE);
    return idx < 0 ? 0 : idx;
  };

  const curve: CurvePoint[] = raw.map((r, i) => {
    return {
      cols: r.cols,
      score: Number(r.score.toFixed(4)),
      smoothed: Number(smoothed[i].toFixed(4)),
      utility: Number((gains[i] - effort * costs[i]).toFixed(4)),
      ssim: Number((r.m.SSIM_vs_source ?? 0).toFixed(4)),
      edge_f1: Number((r.m.Edge_F1_1px ?? 0).toFixed(4)),
      delta_e00: Number((r.m.DeltaE00_mean_vs_source ?? 0).toFixed(2)),
      singleton_ratio_pct: Number((r.m.singleton_ratio_pct ?? 0).toFixed(1)),
      detail_recall: Number(r.recall.toFixed(3)),
    };
  });

  // Smallest width within UTILITY_TOLERANCE of the best utility; the optimum is flat, so this
  // keeps the choice stable against small measurement noise.
  const best = curve[pickIndex(effort)];
  const effort_options = [0.25, 0.5, 1, 2, 4].map((e) => ({ effort: e, grid_cols: widths[pickIndex(e)] }));

  // ---- Stage 3: pick the engine at the chosen width
  const atChoice = await scoreAt(prep, best.cols, engines, dref);
  atChoice.sort((a, b) => b.score - a.score);
  const engine = atChoice[0].engine;

  const grid_cols = best.cols;
  const rows = Math.max(1, Math.round(grid_cols / aspect));
  const layout: 'side_by_side' | 'full_page' = grid_cols <= capSide ? 'side_by_side' : 'full_page';
  const params = buildParams(preset, { ...overrides, grid_cols }, null);

  return {
    preset,
    engine,
    grid_cols,
    rows,
    layout,
    effort,
    min_cols_tested: minCols,
    max_cols_allowed: capFull,
    side_by_side_max_cols: capSide,
    presets_tested: presetScores,
    engines_at_choice: atChoice.map((e) => ({ engine: e.engine, score: Number(e.score.toFixed(4)) })),
    curve,
    effort_options,
    params,
    reason:
      `${grid_cols}×${rows} cells, preset "${preset}", engine ${engine}: best fidelity per colouring effort between ` +
      `${minCols} and ${capFull} columns (3 mm limit); ` +
      `${layout === 'side_by_side' ? 'fits two per landscape page' : 'needs a full portrait page'}` +
      `${range < 0.02 ? '; quality is flat across widths so the smallest grid was used' : ''}.`,
    runtime_seconds: Number(((performance.now() - t0) / 1000).toFixed(1)),
  };
}
