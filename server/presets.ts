import sharp from 'sharp';
import {
  AUTO_ANALYSIS_THRESHOLDS,
  DEFAULT_PARAMS,
  analyzeImage,
  recommendPresetFromAnalysis,
  validateParams,
  type ImageAnalysis,
  type MappingParams,
} from './mapping.js';
import { maxColsForLayout } from './book.js';

export type TargetLayout = 'side_by_side' | 'full_page';
export type EngineChoice = 'A' | 'B' | 'C' | 'D';

export interface PresetDefinition {
  label_en: string;
  label_fa: string;
  description_en: string;
  description_fa: string;
  params: Partial<MappingParams>;
  engine: EngineChoice;
  target_layout: TargetLayout;
}

export const AUTO_PRESET_META = {
  id: 'auto',
  label_en: 'Auto (recommended)',
  label_fa: 'خودکار (پیشنهادی)',
  description_en: 'Analyzes image edges, color count, saturation, and noise to choose the optimal preset, grid limit, and engine.',
  description_fa: 'تصویر را از نظر لبه‌ها، تعداد رنگ، اشباع و نویز تحلیل کرده و بهترین پیش‌تنظیم و موتور را انتخاب می‌کند.',
  target_layout: 'side_by_side' as TargetLayout,
};

export const PRESETS: Record<string, PresetDefinition> = {
  balanced: {
    label_en: 'General',
    label_fa: 'متعادل',
    description_en: 'Notebook v2 default settings for general illustrations and photos.',
    description_fa: 'تنظیمات استاندارد دفترچه v2 برای تصاویر عمومی.',
    params: { ...DEFAULT_PARAMS },
    engine: 'D',
    target_layout: 'side_by_side',
  },
  nature: {
    label_en: 'Nature & landscapes',
    label_fa: 'طبیعت و منظره',
    description_en: 'Large calm regions for sky, water, foliage, and landscapes.',
    description_fa: 'نواحی بزرگ و یکنواخت برای آسمان، آب و مناظر طبیعی.',
    params: {
      illumination_strength: 0.20,
      clahe_clip: 1.2,
      denoise_method: 'bilateral',
      denoise_strength: 22,
      sharpen_fine: 0.10,
      smoothness_lambda: 2.4,
      boundary_beta: 3.5,
      icm_iterations: 6,
      slic_segments: 360,
      slic_compactness: 12,
      region_balance: 0.35,
    },
    engine: 'D',
    target_layout: 'side_by_side',
  },
  detailed: {
    label_en: 'High detail',
    label_fa: 'پرجزئیات',
    description_en: 'Maximum full-page grid resolution with sharp edges and fine detail preservation.',
    description_fa: 'حداکثر جزئیات با چینش تمام‌صفحه و حفظ لبه‌های ظریف.',
    params: {
      max_side: 1200,
      max_samples: 128,
      denoise_method: 'bilateral',
      denoise_strength: 10,
      sharpen_fine: 0.30,
      sharpen_coarse: 0.08,
      smoothness_lambda: 0.9,
      boundary_beta: 6.0,
      icm_iterations: 6,
      slic_segments: 600,
      slic_compactness: 8,
      region_balance: 0.15,
    },
    engine: 'C',
    target_layout: 'full_page',
  },
  cartoon: {
    label_en: 'Flat illustration',
    label_fa: 'کارتونی و تخت',
    description_en: 'Clean flat fills and crisp outlines for cartoons and vector-like art.',
    description_fa: 'سطوح تخت تمیز و خطوط مشخص برای تصاویر کارتونی.',
    params: {
      denoise_method: 'median',
      denoise_strength: 8,
      clahe_clip: 0.8,
      illumination_strength: 0.10,
      sharpen_fine: 0.05,
      smoothness_lambda: 2.0,
      boundary_beta: 5.0,
      region_balance: 0.40,
    },
    engine: 'D',
    target_layout: 'side_by_side',
  },
  portrait: {
    label_en: 'Portrait',
    label_fa: 'پرتره',
    description_en: 'Smooth skin tones with balanced facial edges; auto-selects among B, C, and D.',
    description_fa: 'بافت نرم پوست با حفظ جزئیات چهره؛ انتخاب خودکار بین موتورهای B، C و D.',
    params: {
      illumination_strength: 0.15,
      clahe_clip: 1.0,
      denoise_method: 'nlm',
      denoise_strength: 14,
      smoothness_lambda: 1.4,
      boundary_beta: 4.5,
    },
    engine: 'C',
    target_layout: 'side_by_side',
  },
  simple_kids: {
    label_en: 'Simple',
    label_fa: 'کودکانه ساده',
    description_en: 'Fewer, larger numbered cells capped at 24 columns for easy coloring.',
    description_fa: 'خانه‌های کمتر و بزرگ‌تر با سقف ۲۴ ستون برای رنگ‌آمیزی آسان.',
    params: {
      smoothness_lambda: 3.5,
      boundary_beta: 3.0,
      slic_segments: 160,
      region_balance: 0.50,
      icm_iterations: 8,
    },
    engine: 'D',
    target_layout: 'side_by_side',
  },
};

export interface ProcessRequestPayload {
  preset?: unknown;
  selected_engine?: unknown;
  bg_removal?: unknown;
  run_stability?: unknown;
  params?: unknown;
  /** true: search for the fewest columns with the best fidelity per effort. Default true for preset "auto" without explicit grid_cols. */
  auto_grid?: unknown;
  /** Optimiser effort weight (higher = fewer columns). Default 0.5. */
  effort?: unknown;
}

export interface ResolvedProcessConfig {
  schema: string;
  preset: string | null;
  resolved_preset: string | null;
  target_layout: TargetLayout;
  selected_engine: string;
  allowed_engines?: string[];
  bg_removal: string | null;
  run_stability: boolean;
  auto_grid: boolean;
  effort: number;
  explicit_params: Record<string, unknown>;
  params: MappingParams;
  analysis: (ImageAnalysis & { image_type?: string; reason?: string }) | null;
  warnings: string[];
  side_by_side_max_cols: number;
  target_max_cols: number;
}

export async function resolveProcessRequest(
  imagePath: string,
  aspectRatioHint: number | null,
  payload: ProcessRequestPayload,
): Promise<ResolvedProcessConfig> {
  const rawPreset = typeof payload.preset === 'string' ? payload.preset.trim() : '';
  const presetName = rawPreset.length > 0 ? rawPreset : null;
  if (presetName !== null && presetName !== 'auto' && !PRESETS[presetName]) {
    throw Object.assign(new Error(`Unknown preset "${presetName}".`), { status: 422 });
  }

  let selectedEngine =
    typeof payload.selected_engine === 'string' && payload.selected_engine.trim().length > 0
      ? payload.selected_engine.trim().toUpperCase()
      : presetName === 'auto' || presetName === 'portrait'
        ? 'AUTO'
        : presetName && PRESETS[presetName]
          ? PRESETS[presetName].engine
          : 'D';

  if (!['A', 'B', 'C', 'D', 'AUTO'].includes(selectedEngine)) {
    throw Object.assign(new Error('selected_engine must be A, B, C, D or auto.'), { status: 422 });
  }
  if (selectedEngine === 'AUTO') {
    selectedEngine = 'auto';
  }

  if (payload.params !== undefined && (typeof payload.params !== 'object' || payload.params === null || Array.isArray(payload.params))) {
    throw Object.assign(new Error('params must be an object.'), { status: 422 });
  }
  const explicitParams = (payload.params || {}) as Record<string, unknown>;
  // Validate explicit params immediately so unknown keys or out-of-range inputs return 422
  validateParams(explicitParams);

  let bgRemovalReq: string | null = null;
  if (typeof payload.bg_removal === 'boolean') {
    bgRemovalReq = payload.bg_removal ? 'auto' : 'off';
  } else if (typeof payload.bg_removal === 'string' && payload.bg_removal.trim().length > 0) {
    const mode = payload.bg_removal.trim().toLowerCase();
    if (!['off', 'simple', 'ai', 'auto'].includes(mode)) {
      throw Object.assign(new Error('bg_removal must be off, simple, ai, or auto.'), { status: 422 });
    }
    bgRemovalReq = mode;
  }

  let aspectRatio = aspectRatioHint && aspectRatioHint > 0 ? aspectRatioHint : 0;
  if (!aspectRatio) {
    const meta = await sharp(imagePath).metadata();
    if (meta.width && meta.height && meta.height > 0) {
      aspectRatio = meta.width / meta.height;
    } else {
      aspectRatio = 1;
    }
  }

  let analysis: (ImageAnalysis & { image_type?: string; detail_profile?: string; reason?: string }) | null = null;
  let resolvedPresetName: string | null = presetName;
  let autoAdjustments: Partial<MappingParams> = {};

  if (presetName === 'auto') {
    const rawAnalysis = await analyzeImage(imagePath);
    const rec = recommendPresetFromAnalysis(rawAnalysis);
    resolvedPresetName = rec.preset;
    autoAdjustments = rec.param_adjustments;
    analysis = {
      ...rawAnalysis,
      image_type: rec.image_type,
      detail_profile: rec.detail_profile,
      reason: rec.reason,
    };
  }

  const presetDef = resolvedPresetName && PRESETS[resolvedPresetName] ? PRESETS[resolvedPresetName] : null;
  const presetParams: Partial<MappingParams> = presetDef ? presetDef.params : {};

  // Background removal resolution (never silently enabled without user opting in)
  let bgOverride: Partial<MappingParams> = {};
  if (bgRemovalReq && !Object.prototype.hasOwnProperty.call(explicitParams, 'bg_mode')) {
    if (bgRemovalReq === 'off') {
      bgOverride = { bg_mode: 'off' };
    } else if (bgRemovalReq === 'simple' || bgRemovalReq === 'ai') {
      bgOverride = { bg_mode: bgRemovalReq };
    } else if (bgRemovalReq === 'auto') {
      if (presetName === 'auto' && analysis) {
        bgOverride = {
          bg_mode:
            analysis.border_uniform_fraction > AUTO_ANALYSIS_THRESHOLDS.UNIFORM_BORDER_MIN
              ? 'simple'
              : 'off',
        };
      } else {
        bgOverride = { bg_mode: 'simple' };
      }
    }
  }

  // Merge order: DEFAULT_PARAMS < preset < autoAdjustments < bg_removal < explicit params
  const mergedRaw: Record<string, unknown> = {
    ...DEFAULT_PARAMS,
    ...presetParams,
    ...autoAdjustments,
    ...bgOverride,
    ...explicitParams,
  };

  const targetLayout: TargetLayout =
    presetName === 'auto' ? 'side_by_side' : presetDef?.target_layout || 'side_by_side';
  const sideBySideMaxCols = maxColsForLayout(aspectRatio, 'side_by_side', 21);
  const targetMaxCols = maxColsForLayout(aspectRatio, targetLayout, 21);
  const hasExplicitGridCols = Object.prototype.hasOwnProperty.call(explicitParams, 'grid_cols');
  const warnings: string[] = [];

  if (hasExplicitGridCols) {
    const reqCols = Number(mergedRaw.grid_cols);
    if (reqCols > targetMaxCols) {
      warnings.push(`grid_cols exceeds 3 mm limit for ${targetLayout} (max ${targetMaxCols})`);
    } else if (targetLayout !== 'side_by_side' && reqCols > sideBySideMaxCols) {
      warnings.push(`grid_cols exceeds 3 mm limit for side_by_side (max ${sideBySideMaxCols})`);
    }
  } else if (presetName === 'auto') {
    mergedRaw.grid_cols = Math.min(Number(mergedRaw.grid_cols), sideBySideMaxCols);
  } else if (presetName === 'detailed') {
    const fullMax = maxColsForLayout(aspectRatio, 'full_page', 21);
    mergedRaw.grid_cols = fullMax;
    if (fullMax > sideBySideMaxCols) {
      warnings.push(
        `grid_cols (${fullMax}) exceeds 3 mm limit for side_by_side (max ${sideBySideMaxCols}); full_page layout recommended`,
      );
    }
  } else if (presetName === 'simple_kids') {
    mergedRaw.grid_cols = Math.min(sideBySideMaxCols, 24);
  } else if (presetName && presetName !== 'balanced') {
    mergedRaw.grid_cols = Math.min(Number(mergedRaw.grid_cols), targetMaxCols);
  }

  const wantsAutoGrid =
    payload.auto_grid === true || (presetName === 'auto' && payload.auto_grid !== false);
  const autoGrid = wantsAutoGrid && !hasExplicitGridCols;
  const effortRaw = Number(payload.effort);
  const effort = Number.isFinite(effortRaw) && effortRaw > 0 ? Math.min(10, effortRaw) : 0.5;

  const finalParams = validateParams(mergedRaw);
  const allowedEngines =
    selectedEngine === 'auto' && resolvedPresetName === 'portrait'
      ? ['B', 'C', 'D']
      : selectedEngine === 'auto'
        ? ['A', 'B', 'C', 'D']
        : undefined;

  return {
    schema: 'chromabook-advanced-mapping-v2',
    preset: presetName,
    resolved_preset: resolvedPresetName,
    target_layout: targetLayout,
    selected_engine: selectedEngine,
    allowed_engines: allowedEngines,
    bg_removal: bgRemovalReq,
    run_stability: Boolean(payload.run_stability),
    auto_grid: autoGrid,
    effort,
    explicit_params: explicitParams,
    params: finalParams,
    analysis,
    warnings,
    side_by_side_max_cols: sideBySideMaxCols,
    target_max_cols: targetMaxCols,
  };
}
