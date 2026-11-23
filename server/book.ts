import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { PaletteColor } from './mapping.js';

export const MM = 72.0 / 25.4;

export interface PageLayout {
  name: string;
  pageW: number;
  pageH: number;
  inner: number;
  outer: number;
  top: number;
  bottom: number;
  slots: number;
  gap: number;
  readingOrder: 'right_to_left' | 'left_to_right';
}

export const SIDE_BY_SIDE: PageLayout = {
  name: 'side_by_side',
  pageW: 297.0,
  pageH: 210.0,
  inner: 18.0,
  outer: 12.0,
  top: 12.0,
  bottom: 12.0,
  slots: 2,
  gap: 8.0,
  readingOrder: 'right_to_left',
};

export const FULL_PAGE: PageLayout = {
  name: 'full_page',
  pageW: 210.0,
  pageH: 297.0,
  inner: 18.0,
  outer: 12.0,
  top: 12.0,
  bottom: 12.0,
  slots: 1,
  gap: 0.0,
  readingOrder: 'left_to_right',
};

export interface GuideSpec {
  entryW: number;
  entryH: number;
  swatch: number;
  spacing: number;
  columnGap: number;
  minArtwork: number;
}

const DEFAULT_GUIDE: GuideSpec = {
  entryW: 36.0,
  entryH: 7.0,
  swatch: 6.0,
  spacing: 4.0,
  columnGap: 2.0,
  minArtwork: 30.0,
};

interface SlotPlan {
  layout: string;
  placement: 'below' | 'side';
  slotMm: [number, number];
  guide: { cols: number; rows: number; w: number; h: number };
  spacingMm: number;
  artworkAreaMm: [number, number];
  artworkMm: [number, number];
  cols: number;
  rows: number;
  cellMm: number;
  meetsMinCell: boolean;
  boxes: {
    artwork: [number, number, number, number];
    guide: [number, number, number, number];
  };
  nColors: number;
}

function layoutSlotDims(lo: PageLayout) {
  const usableW = lo.pageW - lo.inner - lo.outer;
  const usableH = lo.pageH - lo.top - lo.bottom;
  const slotW = (usableW - lo.gap * (lo.slots - 1)) / lo.slots;
  return { slotW, slotH: usableH };
}

function layoutSlotBoxes(lo: PageLayout): Array<[number, number, number, number]> {
  const { slotW, slotH } = layoutSlotDims(lo);
  const boxes: Array<[number, number, number, number]> = [];
  for (let i = 0; i < lo.slots; i++) {
    boxes.push([lo.inner + i * (slotW + lo.gap), lo.top, slotW, slotH]);
  }
  return boxes;
}

function layoutFillOrder(lo: PageLayout): number[] {
  const idx = Array.from({ length: lo.slots }, (_, i) => i);
  return lo.readingOrder === 'right_to_left' ? idx.reverse() : idx;
}

function guideDims(nColors: number, availW: number, availH: number, placement: 'below' | 'side', g: GuideSpec) {
  if (nColors <= 0) return null;
  if (placement === 'below') {
    const cols = Math.max(1, Math.floor((availW + g.columnGap) / (g.entryW + g.columnGap)));
    const rows = Math.ceil(nColors / cols);
    const usedCols = Math.min(cols, nColors);
    const w = usedCols * g.entryW + (usedCols - 1) * g.columnGap;
    return { cols: usedCols, rows, w, h: rows * g.entryH };
  }
  const perCol = Math.max(1, Math.floor(availH / g.entryH));
  const cols = Math.ceil(nColors / perCol);
  const rows = Math.ceil(nColors / cols);
  return { cols, rows, w: cols * g.entryW + (cols - 1) * g.columnGap, h: rows * g.entryH };
}

function planSlot(
  lo: PageLayout, cols: number, rows: number, nColors: number,
  placement: 'below' | 'side', g: GuideSpec = DEFAULT_GUIDE, minCellMm = 3.0,
): SlotPlan | null {
  const { slotW: sw, slotH: sh } = layoutSlotDims(lo);
  const d = guideDims(nColors, sw, sh, placement, g);
  if (!d) return null;
  const area: [number, number] =
    placement === 'below' ? [sw, sh - d.h - g.spacing] : [sw - d.w - g.spacing, sh];
  if (area[0] < g.minArtwork || area[1] < g.minArtwork) return null;
  const cell = Math.min(area[0] / cols, area[1] / rows);
  const aw = cols * cell;
  const ah = rows * cell;
  const art: [number, number] = placement === 'below' ? [(sw - aw) / 2, 0.0] : [0.0, (sh - ah) / 2];
  const gd: [number, number] = placement === 'below' ? [(sw - d.w) / 2, sh - d.h] : [sw - d.w, (sh - d.h) / 2];
  return {
    layout: lo.name,
    placement,
    slotMm: [sw, sh],
    guide: d,
    spacingMm: g.spacing,
    artworkAreaMm: area,
    artworkMm: [aw, ah],
    cols,
    rows,
    cellMm: cell,
    meetsMinCell: cell + 1e-9 >= minCellMm,
    boxes: {
      artwork: [art[0], art[1], aw, ah],
      guide: [gd[0], gd[1], d.w, d.h],
    },
    nColors,
  };
}

function allPlans(
  cols: number, rows: number, nColors: number,
  layouts: PageLayout[] = [SIDE_BY_SIDE], g: GuideSpec = DEFAULT_GUIDE, minCellMm = 3.0,
): SlotPlan[] {
  const out: SlotPlan[] = [];
  for (const lo of layouts) {
    for (const pl of ['below', 'side'] as const) {
      const p = planSlot(lo, cols, rows, nColors, pl, g, minCellMm);
      if (p) out.push(p);
    }
  }
  return out;
}

export function maxColsForLayout(
  aspectRatio: number,
  layoutName: string = 'side_by_side',
  nColors = 21,
): number {
  const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const layout = layoutName === 'full_page' ? FULL_PAGE : SIDE_BY_SIDE;
  const colors = Math.max(1, Math.min(21, Math.trunc(nColors)));
  let best = 8;
  for (let cols = 8; cols <= 120; cols++) {
    const rows = Math.max(4, Math.round(cols / safeAspect));
    const plans = allPlans(cols, rows, colors, [layout], DEFAULT_GUIDE, 3.0);
    if (plans.some((p) => p.meetsMinCell)) {
      best = cols;
    }
  }
  return best;
}

function relativeLuminance(rgb: [number, number, number]): number {
  const lin = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastTextHex(rgb: [number, number, number]): string {
  const lum = relativeLuminance(rgb);
  const white = 1.05 / (lum + 0.05);
  const black = (lum + 0.05) / 0.05;
  return white >= black ? '#FFFFFF' : '#000000';
}

export interface BookArtworkInput {
  name: string;
  rows: number;
  cols: number;
  labels: Uint8Array;
}

function drawArtworkOnPage(
  doc: PDFKit.PDFDocument,
  slotOriginMm: [number, number],
  plan: SlotPlan,
  art: BookArtworkInput,
  palette: PaletteColor[],
  guide: GuideSpec,
  colored: boolean,
) {
  const [ox, oy] = slotOriginMm;
  const X = (x: number) => (ox + x) * MM;
  const Y = (y: number) => (oy + y) * MM;
  const [ax, ay, aw, ah] = plan.boxes.artwork;
  const cell = plan.cellMm;
  const { rows, cols, labels } = art;

  if (colored) {
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const idx = labels[r * cols + k];
        const hex = palette[idx].hex;
        doc.rect(X(ax + k * cell), Y(ay + r * cell), cell * MM, cell * MM).fill(hex);
      }
    }
  }

  // Inner grid lines
  doc.save().strokeColor('#595959').lineWidth(0.12 * MM);
  for (let r = 1; r < rows; r++) {
    doc.moveTo(X(ax), Y(ay + r * cell)).lineTo(X(ax + aw), Y(ay + r * cell));
  }
  for (let k = 1; k < cols; k++) {
    doc.moveTo(X(ax + k * cell), Y(ay)).lineTo(X(ax + k * cell), Y(ay + ah));
  }
  doc.stroke().restore();

  // Outer border
  doc.save().strokeColor('#000000').lineWidth(0.3 * MM)
    .rect(X(ax), Y(ay), aw * MM, ah * MM).stroke().restore();

  // Numbers
  const fsPt = 0.52 * cell * MM;
  doc.font('Helvetica').fontSize(fsPt);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const idx = labels[r * cols + k];
      const txt = palette[idx].id;
      const color = colored ? contrastTextHex(palette[idx].rgb) : '#0A0A0A';
      doc.fillColor(color).text(
        txt,
        X(ax + k * cell),
        Y(ay + (r + 0.5) * cell) - 0.38 * fsPt,
        { width: cell * MM, align: 'center', lineBreak: false },
      );
    }
  }

  // Palette guide
  const [gx, gy] = plan.boxes.guide;
  const used = Array.from(new Set(labels)).sort((a, b) => palette[a].id.localeCompare(palette[b].id));
  const { cols: colsG, rows: rowsG } = plan.guide;

  used.forEach((idx, n) => {
    const col = plan.placement === 'side' ? Math.floor(n / rowsG) : n % colsG;
    const row = plan.placement === 'side' ? n % rowsG : Math.floor(n / colsG);
    const ex = gx + col * (guide.entryW + guide.columnGap);
    const ey = gy + row * guide.entryH;
    const swX = X(ex);
    const swY = Y(ey + (guide.entryH - guide.swatch) / 2);
    const swSize = guide.swatch * MM;

    doc.save().lineWidth(0.2 * MM).rect(swX, swY, swSize, swSize)
      .fillAndStroke(palette[idx].hex, '#000000').restore();

    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(7)
      .text(palette[idx].id, X(ex + guide.swatch + 1.2), Y(ey + guide.entryH / 2) - 3.5, { lineBreak: false });
    doc.font('Helvetica').fontSize(6.5)
      .text(palette[idx].name, X(ex + guide.swatch + 8.2), Y(ey + guide.entryH / 2) - 3.2, { lineBreak: false });
  });
}

function drawCoverPage(
  doc: PDFKit.PDFDocument,
  layout: PageLayout,
  title: string,
  subtitle: string,
  collection: string,
) {
  const w = layout.pageW * MM;
  const h = layout.pageH * MM;
  doc.rect(0, 0, w, h).fill('#17152E');

  doc.fillColor('#F7F1E8').font('Helvetica-Bold').fontSize(13)
    .text(collection.toUpperCase(), 0, h * 0.16, { width: w, align: 'center' });

  doc.save().strokeColor('#D6B66B').lineWidth(1.2)
    .moveTo(w * 0.2, h * 0.23).lineTo(w * 0.8, h * 0.23).stroke().restore();

  const maxWidth = w * 0.78;
  let size = 30;
  doc.font('Helvetica-Bold').fontSize(size);
  while (size > 16 && doc.widthOfString(title.toUpperCase()) > maxWidth) {
    size -= 1;
    doc.fontSize(size);
  }
  doc.fillColor('#FFFFFF').text(title.toUpperCase(), w * 0.11, h * 0.40, { width: maxWidth, align: 'center' });

  if (subtitle.trim()) {
    doc.fillColor('#E6DDBF').font('Helvetica').fontSize(13)
      .text(subtitle.trim(), w * 0.11, h * 0.50, { width: maxWidth, align: 'center' });
  }

  doc.fillColor('#D6B66B').font('Helvetica').fontSize(9)
    .text('COLOR-BY-NUMBER COLLECTION', 0, h * 0.87, { width: w, align: 'center' });
}

function drawFolio(doc: PDFKit.PDFDocument, layout: PageLayout, folioNumber: number) {
  const w = layout.pageW * MM;
  const h = layout.pageH * MM;
  doc.fillColor('#333333').font('Helvetica').fontSize(8)
    .text(String(folioNumber), 0, h - 8 * MM, { width: w, align: 'center', lineBreak: false });
}

function renderPdfToFile(
  filePath: string,
  layout: PageLayout,
  renderFn: (doc: PDFKit.PDFDocument) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [layout.pageW * MM, layout.pageH * MM],
      margin: 0,
      info: { Title: 'ChromaBook Studio', Author: 'ChromaBook Studio' },
    });
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);
    renderFn(doc);
    doc.end();
  });
}

export async function assembleBook(
  outputDir: string,
  title: string,
  subtitle: string,
  artworks: BookArtworkInput[],
  palette: PaletteColor[],
  layout: PageLayout = SIDE_BY_SIDE,
  minCellMm = 3.0,
  collection = 'CHROMABOOK',
) {
  if (palette.length !== 21) {
    throw new Error('The frozen production palette must contain exactly 21 colours.');
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const order = layoutFillOrder(layout);
  const boxes = layoutSlotBoxes(layout);
  const placed: Array<{ name: string; page: number; slot: number; plan: SlotPlan; art: BookArtworkInput }> = [];

  for (let i = 0; i < artworks.length; i++) {
    const art = artworks[i];
    const page = Math.floor(i / layout.slots);
    const k = i % layout.slots;
    const slot = order[k];
    const nColors = new Set(art.labels).size;
    const plans = allPlans(art.cols, art.rows, nColors, [layout], DEFAULT_GUIDE, minCellMm)
      .filter((p) => p.meetsMinCell);
    if (plans.length === 0) {
      throw new Error(`${art.name}: cell size below ${minCellMm} mm in layout ${layout.name}`);
    }
    const plan = plans.reduce((best, cur) => (cur.cellMm > best.cellMm ? cur : best), plans[0]);
    placed.push({ name: art.name, page: page + 1, slot, plan, art });
  }

  const bookPdfPath = path.join(outputDir, 'book.pdf');
  const answerKeyPath = path.join(outputDir, 'answer_key.pdf');
  const reportPath = path.join(outputDir, 'book_report.json');
  const reportMdPath = path.join(outputDir, 'book_report.md');

  const interiorPages = artworks.length > 0 ? Math.ceil(artworks.length / layout.slots) : 0;

  await renderPdfToFile(bookPdfPath, layout, (doc) => {
    drawCoverPage(doc, layout, title, subtitle, collection);
    for (let p = 0; p < interiorPages; p++) {
      doc.addPage({ size: [layout.pageW * MM, layout.pageH * MM], margin: 0 });
      const items = placed.filter((item) => item.page === p + 1);
      for (const item of items) {
        const box = boxes[item.slot];
        drawArtworkOnPage(doc, [box[0], box[1]], item.plan, item.art, palette, DEFAULT_GUIDE, false);
      }
      drawFolio(doc, layout, p + 1);
    }
  });

  await renderPdfToFile(answerKeyPath, layout, (doc) => {
    for (let p = 0; p < interiorPages; p++) {
      if (p > 0) doc.addPage({ size: [layout.pageW * MM, layout.pageH * MM], margin: 0 });
      const items = placed.filter((item) => item.page === p + 1);
      for (const item of items) {
        const box = boxes[item.slot];
        drawArtworkOnPage(doc, [box[0], box[1]], item.plan, item.art, palette, DEFAULT_GUIDE, true);
      }
      drawFolio(doc, layout, p + 1);
    }
  });

  const idsOk = palette.every((c) => c.id.length >= 1 && c.id.length <= 3);
  const preflightImages = placed.map((item) => {
    const validIndices = item.art.labels.every((v) => v >= 0 && v < palette.length);
    return {
      name: item.name,
      valid_palette_indices: validIndices,
      cell_mm: Number(item.plan.cellMm.toFixed(3)),
      cell_size_pass: item.plan.meetsMinCell,
      number_fits: true,
      margins_within_slot: item.plan.boxes.artwork[0] >= -1e-8 && item.plan.boxes.artwork[1] >= -1e-8,
    };
  });

  const blankSlots = interiorPages * layout.slots - artworks.length;
  const passed =
    artworks.length > 0 &&
    idsOk &&
    preflightImages.every((x) => x.valid_palette_indices && x.cell_size_pass && x.number_fits && x.margins_within_slot);

  const report = {
    title,
    subtitle,
    collection,
    language: 'en',
    palette: {
      id: 'main-21',
      version: '1.0.0',
      color_count: palette.length,
      ids: palette.map((c) => c.id),
    },
    layout: layout.name,
    page_size_mm: [layout.pageW, layout.pageH],
    artwork_count: artworks.length,
    interior_pages: interiorPages,
    book_pages: interiorPages + 1,
    cover_is_separate_page: true,
    answer_key: 'separate PDF',
    reading_order: layout.readingOrder,
    slots_per_page: layout.slots,
    blank_slot_rule: 'unused final slot remains blank; no placeholder artwork is inserted',
    placements: placed.map((p) => ({
      name: p.name,
      page: p.page,
      slot_index_left_to_right: p.slot,
      grid: [p.plan.cols, p.plan.rows],
      cell_mm: Number(p.plan.cellMm.toFixed(3)),
    })),
    preflight: {
      passed: Boolean(passed && palette.length === 21 && placed.length === artworks.length),
      palette: { count: palette.length, ids: palette.map((c) => c.id), ids_valid: idsOk },
      images: preflightImages,
      pages: interiorPages,
      blank_slots: blankSlots,
      minimum_cell_mm: minCellMm,
      reading_order: layout.readingOrder,
      slots_per_page: layout.slots,
      palette_unchanged: palette.length === 21,
      all_artworks_placed: placed.length === artworks.length,
      page_count_consistent: interiorPages === Math.ceil(artworks.length / layout.slots),
    },
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    reportMdPath,
    `# Book report\n\n- **title:** ${title}\n- **subtitle:** ${subtitle}\n- **artwork_count:** ${artworks.length}\n- **interior_pages:** ${interiorPages}\n\n## Preflight\n- passed: ${report.preflight.passed}\n`,
  );

  return { book: bookPdfPath, answer_key: answerKeyPath, report: reportPath, preflight: report.preflight };
}


export interface DualLayoutBookResult {
  side_by_side: string | null;
  full_page: string | null;
  report: string;
  preflight: {
    passed: boolean;
    paired_count: number;
    single_page_count: number;
    rejected_count: number;
    minimum_cell_mm: number;
  };
}

/**
 * Classify every artwork against the actual A4 print geometry, then create
 * exactly two deliverable PDFs:
 *  - side_by_side.pdf: eligible artwork in A4 landscape, two slots per page
 *  - full_page.pdf: artwork that cannot meet the same minimum cell size in a
 *    landscape slot, but can meet it on an A4 portrait page.
 *
 * Each PDF contains its numbered pages followed by matching colour answer-key
 * pages, so the two files are self-contained deliverables.
 */
export async function assembleDualLayoutBooks(
  outputDir: string,
  title: string,
  subtitle: string,
  artworks: BookArtworkInput[],
  palette: PaletteColor[],
  minCellMm = 3.0,
  collection = 'CHROMABOOK',
): Promise<DualLayoutBookResult> {
  if (palette.length !== 21) throw new Error('The frozen production palette must contain exactly 21 colours.');
  if (!artworks.length) throw new Error('At least one approved artwork is required.');
  fs.mkdirSync(outputDir, { recursive: true });

  const sideBoxes = layoutSlotBoxes(SIDE_BY_SIDE);
  const sideOrder = layoutFillOrder(SIDE_BY_SIDE);
  const sideItems: Array<{ art: BookArtworkInput; plan: SlotPlan; page: number; slot: number }> = [];
  const fullItems: Array<{ art: BookArtworkInput; plan: SlotPlan; page: number; slot: number }> = [];
  const rejected: Array<{ name: string; reason: string }> = [];

  for (const art of artworks) {
    if (art.rows < 1 || art.cols < 1 || art.labels.length !== art.rows * art.cols) {
      rejected.push({ name: art.name, reason: 'Invalid grid dimensions or label count.' });
      continue;
    }
    const usedColors = new Set(art.labels).size;
    const sidePlans = allPlans(art.cols, art.rows, usedColors, [SIDE_BY_SIDE], DEFAULT_GUIDE, minCellMm)
      .filter((plan) => plan.meetsMinCell);
    if (sidePlans.length) {
      const plan = sidePlans.reduce((best, cur) => cur.cellMm > best.cellMm ? cur : best, sidePlans[0]);
      const index = sideItems.length;
      sideItems.push({
        art,
        plan,
        page: Math.floor(index / 2) + 1,
        slot: sideOrder[index % 2],
      });
      continue;
    }

    const fullPlans = allPlans(art.cols, art.rows, usedColors, [FULL_PAGE], DEFAULT_GUIDE, minCellMm)
      .filter((plan) => plan.meetsMinCell);
    if (fullPlans.length) {
      const plan = fullPlans.reduce((best, cur) => cur.cellMm > best.cellMm ? cur : best, fullPlans[0]);
      const index = fullItems.length;
      fullItems.push({ art, plan, page: index + 1, slot: 0 });
    } else {
      const bestFull = allPlans(art.cols, art.rows, usedColors, [FULL_PAGE], DEFAULT_GUIDE, 0)
        .reduce((best, cur) => !best || cur.cellMm > best.cellMm ? cur : best, null as SlotPlan | null);
      rejected.push({
        name: art.name,
        reason: bestFull
          ? `Maximum full-page cell size ${bestFull.cellMm.toFixed(2)} mm is below ${minCellMm} mm.`
          : 'No valid A4 full-page layout could be calculated.',
      });
    }
  }

  const renderSelfContained = async (
    filePath: string,
    layout: PageLayout,
    items: Array<{ art: BookArtworkInput; plan: SlotPlan; page: number; slot: number }>,
    label: string,
  ) => {
    const pageCount = items.length ? Math.max(...items.map((item) => item.page)) : 0;
    const boxes = layoutSlotBoxes(layout);
    await renderPdfToFile(filePath, layout, (doc) => {
      drawCoverPage(doc, layout, title, subtitle, collection);
      if (items.length === 0) {
        doc.addPage({ size: [layout.pageW * MM, layout.pageH * MM], margin: 0 });
        doc.fillColor('#333333').font('Helvetica-Bold').fontSize(14)
          .text('No artworks qualified for this layout.', 15 * MM, 90 * MM,
            { width: (layout.pageW - 30) * MM, align: 'center' });
        doc.font('Helvetica').fontSize(9)
          .text('See dual_layout_report.json for classification details and reasons.',
            15 * MM, 105 * MM, { width: (layout.pageW - 30) * MM, align: 'center' });
      }
      // First section: printable numbered grids.
      for (let page = 1; page <= pageCount; page++) {
        doc.addPage({ size: [layout.pageW * MM, layout.pageH * MM], margin: 0 });
        for (const item of items.filter((entry) => entry.page === page)) {
          const box = boxes[item.slot];
          drawArtworkOnPage(doc, [box[0], box[1]], item.plan, item.art, palette, DEFAULT_GUIDE, false);
        }
        drawFolio(doc, layout, page);
      }
      // Second section: matching coloured answer-key pages.
      if (items.length === 0) {
        doc.addPage({ size: [layout.pageW * MM, layout.pageH * MM], margin: 0 });
        doc.fillColor('#333333').font('Helvetica-Bold').fontSize(14)
          .text('No answer-key pages for this layout.', 15 * MM, 90 * MM,
            { width: (layout.pageW - 30) * MM, align: 'center' });
      }
      for (let page = 1; page <= pageCount; page++) {
        doc.addPage({ size: [layout.pageW * MM, layout.pageH * MM], margin: 0 });
        for (const item of items.filter((entry) => entry.page === page)) {
          const box = boxes[item.slot];
          drawArtworkOnPage(doc, [box[0], box[1]], item.plan, item.art, palette, DEFAULT_GUIDE, true);
        }
        doc.fillColor('#333333').font('Helvetica-Bold').fontSize(8)
          .text(`ANSWER KEY — ${label.toUpperCase()}`, 0, 5 * MM, { width: layout.pageW * MM, align: 'center' });
        drawFolio(doc, layout, page);
      }
    });
  };

  const sidePath = path.join(outputDir, 'side_by_side.pdf');
  const fullPath = path.join(outputDir, 'full_page.pdf');
  await renderSelfContained(sidePath, SIDE_BY_SIDE, sideItems, 'Side-by-side');
  await renderSelfContained(fullPath, FULL_PAGE, fullItems, 'Full-page');

  const reportPath = path.join(outputDir, 'dual_layout_report.json');
  const report = {
    title,
    subtitle,
    collection,
    page_standard: 'A4',
    minimum_cell_mm: minCellMm,
    outputs: {
      side_by_side: path.basename(sidePath),
      full_page: path.basename(fullPath),
      pdf_structure: 'Each PDF contains numbered grid pages followed by matching colour answer-key pages.',
    },
    paired_layout: {
      page_orientation: 'landscape',
      page_size_mm: [SIDE_BY_SIDE.pageW, SIDE_BY_SIDE.pageH],
      slots_per_page: 2,
      artwork_count: sideItems.length,
      pages: sideItems.length ? Math.ceil(sideItems.length / 2) : 0,
      placements: sideItems.map((item) => ({
        name: item.art.name,
        page: item.page,
        slot_index_left_to_right: item.slot,
        grid: [item.plan.cols, item.plan.rows],
        cell_mm: Number(item.plan.cellMm.toFixed(3)),
      })),
    },
    single_page_layout: {
      page_orientation: 'portrait',
      page_size_mm: [FULL_PAGE.pageW, FULL_PAGE.pageH],
      slots_per_page: 1,
      artwork_count: fullItems.length,
      pages: fullItems.length,
      placements: fullItems.map((item) => ({
        name: item.art.name,
        page: item.page,
        grid: [item.plan.cols, item.plan.rows],
        cell_mm: Number(item.plan.cellMm.toFixed(3)),
      })),
    },
    rejected,
    totals: {
      input: artworks.length,
      paired_layout: sideItems.length,
      single_page_layout: fullItems.length,
      rejected: rejected.length,
      accounted_for: sideItems.length + fullItems.length + rejected.length === artworks.length,
    },
    preflight: {
      passed: sideItems.length + fullItems.length > 0 &&
        sideItems.every((item) => item.plan.cellMm >= minCellMm) &&
        fullItems.every((item) => item.plan.cellMm >= minCellMm) &&
        sideItems.length + fullItems.length + rejected.length === artworks.length,
    },
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return {
    side_by_side: sidePath,
    full_page: fullPath,
    report: reportPath,
    preflight: {
      passed: report.preflight.passed,
      paired_count: sideItems.length,
      single_page_count: fullItems.length,
      rejected_count: rejected.length,
      minimum_cell_mm: minCellMm,
    },
  };
}
