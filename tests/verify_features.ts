import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  DEFAULT_PARAMS,
  PARAMETER_BOUNDS,
  loadPalette,
  runImageAndSave,
  validateParams,
} from '../server/mapping.js';
import { PRESETS, resolveProcessRequest } from '../server/presets.js';
import { FULL_PAGE, SIDE_BY_SIDE, assembleBook, maxColsForLayout } from '../server/book.js';
import { PALETTE_PATH } from '../server/store.js';

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chromabook-verify-'));
  console.log('Running ChromaBook Studio verification tests in', tmpRoot);

  try {
    // 1. Preset bounds + unknown key rejection
    for (const [key, def] of Object.entries(PRESETS)) {
      const validated = validateParams(def.params);
      for (const [paramKey, [lo, hi]] of Object.entries(PARAMETER_BOUNDS)) {
        const v = Number((validated as unknown as Record<string, unknown>)[paramKey]);
        assert.ok(v >= lo && v <= hi, `Preset ${key}.${paramKey}=${v} out of bounds [${lo}, ${hi}]`);
      }
      assert.ok(['A', 'B', 'C', 'D'].includes(def.engine), `Preset ${key} invalid engine ${def.engine}`);
      assert.ok(['side_by_side', 'full_page'].includes(def.target_layout), `Preset ${key} invalid target_layout`);
    }
    assert.throws(() => validateParams({ unknown_slider_key: 42 }), /Unknown Notebook v2 parameters/);
    console.log('PASS [1/6]: All presets lie within PARAMETER_BOUNDS and unknown keys are rejected.');

    // 2. maxColsForLayout 3mm rule checks
    const sideCols = maxColsForLayout(2 / 3, 'side_by_side', 21);
    const fullCols = maxColsForLayout(2 / 3, 'full_page', 21);
    assert.ok(sideCols >= 26 && sideCols <= 31, `Expected side_by_side max cols ~28-29, got ${sideCols}`);
    assert.ok(fullCols >= 46 && fullCols <= 52, `Expected full_page max cols ~48-50, got ${fullCols}`);
    console.log(`PASS [2/6]: maxColsForLayout(2/3) side_by_side=${sideCols}, full_page=${fullCols}.`);

    // 3. Pipeline parity: balanced + bg_mode='off' === legacy DEFAULT_PARAMS + Engine D
    const cozyImg = path.resolve('inputs/cozy_02_lavender_sunset.jpg');
    assert.ok(fs.existsSync(cozyImg), 'Missing fixture inputs/cozy_02_lavender_sunset.jpg');

    const legacyDir = path.join(tmpRoot, 'legacy');
    const balancedDir = path.join(tmpRoot, 'balanced');
    const legacyConfig = await resolveProcessRequest(cozyImg, null, { selected_engine: 'D', params: {} });
    const balancedConfig = await resolveProcessRequest(cozyImg, null, {
      preset: 'balanced',
      selected_engine: 'D',
      bg_removal: 'off',
      params: {},
    });
    assert.deepEqual(legacyConfig.params, DEFAULT_PARAMS, 'Legacy config must match DEFAULT_PARAMS');
    assert.deepEqual(balancedConfig.params, DEFAULT_PARAMS, 'Balanced+off config must match DEFAULT_PARAMS');

    await runImageAndSave(cozyImg, legacyDir, legacyConfig.params, 'D', false);
    await runImageAndSave(cozyImg, balancedDir, balancedConfig.params, 'D', false);
    const legacyLabels = fs.readFileSync(path.join(legacyDir, 'labels.npy'));
    const balancedLabels = fs.readFileSync(path.join(balancedDir, 'labels.npy'));
    assert.ok(legacyLabels.equals(balancedLabels), 'Balanced + off labels.npy must equal legacy DEFAULT_PARAMS output');
    console.log('PASS [3/6]: Legacy & balanced+off pipeline parity verified (byte-identical labels.npy).');

    // 4. Background removal ('simple') on spooky_02_purple_cat.jpg -> >=90% border cells are palette ID '05' (White)
    const spookyImg = path.resolve('inputs/spooky_02_purple_cat.jpg');
    assert.ok(fs.existsSync(spookyImg), 'Missing fixture inputs/spooky_02_purple_cat.jpg');
    const palette = loadPalette(PALETTE_PATH);
    assert.equal(palette.length, 21, 'Palette must stay locked at 21 colours');
    const whiteIdx = palette.findIndex((c) => c.id === '05');
    assert.ok(whiteIdx >= 0, 'Palette must include color ID 05');

    const bgOutDir = path.join(tmpRoot, 'bg_simple');
    const bgRes = await runImageAndSave(
      spookyImg,
      bgOutDir,
      { bg_mode: 'simple', grid_cols: 28 },
      'D',
      false,
    );
    assert.ok(fs.existsSync(path.join(bgOutDir, 'mask.png')), 'mask.png must be generated when bg_mode=simple');
    const bgLabelsJson = JSON.parse(fs.readFileSync(path.join(bgOutDir, 'labels.json'), 'utf-8')) as {
      rows: number;
      cols: number;
      data: number[];
    };
    let borderTotal = 0;
    let borderWhite = 0;
    for (let r = 0; r < bgLabelsJson.rows; r++) {
      for (let c = 0; c < bgLabelsJson.cols; c++) {
        if (r === 0 || r === bgLabelsJson.rows - 1 || c === 0 || c === bgLabelsJson.cols - 1) {
          borderTotal++;
          if (bgLabelsJson.data[r * bgLabelsJson.cols + c] === whiteIdx) borderWhite++;
        }
      }
    }
    const borderWhiteFrac = borderWhite / Math.max(1, borderTotal);
    assert.ok(
      borderWhiteFrac >= 0.9,
      `Expected >= 90% white ('05') border cells on spooky_02_purple_cat.jpg, got ${(borderWhiteFrac * 100).toFixed(1)}% (engine ${bgRes.engine})`,
    );
    console.log(`PASS [4/6]: Simple background removal mapped ${(borderWhiteFrac * 100).toFixed(1)}% border cells to White ('05').`);

    // 5. Auto preset + Auto engine never exceeds 3mm check and produces valid book PDF preflight
    for (const imgPath of [cozyImg, spookyImg]) {
      const meta = await sharp(imgPath).metadata();
      const ar = (meta.width || 1) / (meta.height || 1);
      const maxAllowed = maxColsForLayout(ar, 'side_by_side', 21);
      const autoCfg = await resolveProcessRequest(imgPath, ar, {
        preset: 'auto',
        selected_engine: 'auto',
      });
      assert.ok(
        autoCfg.params.grid_cols <= maxAllowed,
        `Auto mode chose grid_cols=${autoCfg.params.grid_cols} > 3mm limit ${maxAllowed}`,
      );
      assert.ok(autoCfg.analysis !== null, 'Auto mode must include image analysis');

      const autoOutDir = path.join(tmpRoot, `auto_${path.basename(imgPath)}`);
      const autoRun = await runImageAndSave(imgPath, autoOutDir, autoCfg.params, 'auto', false, {
        allowedEngines: autoCfg.allowed_engines,
        warnings: autoCfg.warnings,
      });
      assert.ok(['A', 'B', 'C', 'D'].includes(autoRun.engine), 'Auto must select a valid engine');
      assert.ok(['high', 'medium', 'low'].includes(autoRun.confidence), `Unexpected confidence: ${autoRun.confidence}`);
      assert.ok(autoRun.autoSelection !== null, 'auto_selection summary must be populated');

      const labelsParsed = JSON.parse(fs.readFileSync(path.join(autoOutDir, 'labels.json'), 'utf-8')) as {
        rows: number;
        cols: number;
        data: number[];
      };
      const bookDir = path.join(tmpRoot, `book_${path.basename(imgPath)}`);
      const bookRes = await assembleBook(
        bookDir,
        'Auto Preflight Test',
        'Verification',
        [{ name: path.basename(imgPath), rows: labelsParsed.rows, cols: labelsParsed.cols, labels: Uint8Array.from(labelsParsed.data) }],
        palette,
        SIDE_BY_SIDE,
        3.0,
        'CHROMABOOK',
      );
      assert.equal(bookRes.preflight.passed, true, `Auto output for ${path.basename(imgPath)} failed 3mm book preflight`);
    }
    console.log('PASS [5/6]: Auto preset & Auto engine selection respected 3mm limits and passed book assembly preflight.');

    // 6. Explicit grid_cols exceeding 3mm attaches warning while remaining allowed
    const warnCfg = await resolveProcessRequest(cozyImg, 2 / 3, {
      preset: 'nature',
      selected_engine: 'D',
      params: { grid_cols: 60 },
    });
    assert.equal(warnCfg.params.grid_cols, 60);
    assert.ok(
      warnCfg.warnings.some((w) => w.includes('exceeds 3 mm limit')),
      `Expected 3mm warning, got ${JSON.stringify(warnCfg.warnings)}`,
    );

    // Check full_page constant still works cleanly with detailed grid_cols
    const detailedCfg = await resolveProcessRequest(cozyImg, 2 / 3, {
      preset: 'detailed',
    });
    assert.equal(detailedCfg.params.grid_cols, fullCols);
    assert.equal(FULL_PAGE.name, 'full_page');
    console.log('PASS [6/6]: Explicit override warnings & detailed full_page max_cols verified.');

    console.log('ALL 6 VERIFICATION CHECKS PASSED.');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Verification test failed:', err);
  process.exit(1);
});
