import fs from 'node:fs';
import path from 'node:path';
import { analyzeImage, recommendPresetFromAnalysis } from '../server/mapping.js';

const root = path.resolve('inputs/image-processing-tests');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as {
  images: Array<{ file: string; category: string }>;
};

const rows = [];
for (const item of manifest.images) {
  const imagePath = path.join(root, item.file);
  if (!fs.existsSync(imagePath)) throw new Error(`Missing fixture: ${imagePath}`);
  const analysis = await analyzeImage(imagePath);
  const recommendation = recommendPresetFromAnalysis(analysis);
  const params = recommendation.param_adjustments;
  if (!params || Number(params.denoise_strength) > 10) {
    throw new Error(`Unsafe denoise setting for ${item.file}`);
  }
  if (Number(params.max_side) < 1400) throw new Error(`Analysis resolution too low for ${item.file}`);
  rows.push({
    file: item.file,
    expected_visual_family: item.category,
    detected_profile: recommendation.detail_profile,
    detected_type: recommendation.image_type,
    preset: recommendation.preset,
    edge_density: analysis.edge_density,
    noise_estimate: analysis.noise_estimate,
    dominant_colors: analysis.dominant_colors,
    denoise: `${params.denoise_method}/${params.denoise_strength}`,
    sharpen_fine: params.sharpen_fine,
  });
}

console.table(rows);
console.log(`Analyzed ${rows.length} image fixtures. Review profile fit visually; this is a heuristic regression check, not a semantic image classifier.`);
