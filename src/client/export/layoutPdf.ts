import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { collectCuts, collectPieces, walk, type SheetPlan } from '../../engine';
import { fmtNum } from '../format';

/** 'a4': every layout scaled onto an A4 page with a header; 'sheet': the page is the sheet itself, 1:1. */
export type PdfPaper = 'a4' | 'sheet';

export interface LayoutPdfInput {
  title: string;
  planLabel: string;
  /** The layouts to print with their 1-based number in the plan. */
  sheets: Array<{ sheet: SheetPlan; number: number }>;
  totalSheets: number;
  pieceNames: Map<string, string>;
  paper: PdfPaper;
  /** TrueType fonts with Turkish glyphs (the standard PDF fonts have none). */
  fonts: { regular: Uint8Array; bold: Uint8Array };
  date?: Date;
}

const PT = 72 / 25.4;
const A4 = { w: 210, h: 297 };
const MARGIN = 12;
const HEADER = 16;
const FOOTER = 9;

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  ink: hex('#1f2933'),
  muted: hex('#52606d'),
  trim: hex('#e4e7eb'),
  piece: hex('#ffffff'),
  offcut: hex('#d7f0e4'),
  offcutInk: hex('#2f855a'),
  waste: hex('#f3d9d6'),
  wasteInk: hex('#b4463c'),
  kerf: hex('#1f2933'),
  cut: hex('#c2410c'),
};

/** Builds a PDF of cutting layouts; vector drawing straight from the cut trees, so it prints sharp at any size. */
export async function buildLayoutPdf(input: LayoutPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${input.title} — ${input.planLabel}`);
  doc.setCreator('Giyotin Kesim Planlayıcı');
  const regular = await doc.embedFont(input.fonts.regular, { subset: true });
  const bold = await doc.embedFont(input.fonts.bold, { subset: true });
  const date = (input.date ?? new Date()).toLocaleDateString('tr-TR');

  for (const { sheet, number } of input.sheets) {
    if (input.paper === 'sheet') {
      const page = doc.addPage([sheet.width * PT, sheet.height * PT]);
      drawSheet(page, sheet, { x: 0, y: 0, scale: 1 }, input.pieceNames, regular, bold);
      const label = `${input.title} · Kalıp ${number}/${input.totalSheets} · ${dims(sheet.width, sheet.height)}${sheet.copies > 1 ? ` · ×${sheet.copies} tabaka` : ''} · 1:1`;
      const size = 9;
      const w = regular.widthOfTextAtSize(label, size);
      page.drawRectangle({ x: 4, y: page.getHeight() - 4 - size - 6, width: w + 8, height: size + 6, color: rgb(1, 1, 1), opacity: 0.85 });
      page.drawText(label, { x: 8, y: page.getHeight() - 4 - size - 2, size, font: regular, color: C.ink });
      continue;
    }

    const landscape = sheet.width >= sheet.height;
    const pw = landscape ? A4.h : A4.w;
    const ph = landscape ? A4.w : A4.h;
    const page = doc.addPage([pw * PT, ph * PT]);
    const availW = pw - 2 * MARGIN;
    const availH = ph - 2 * MARGIN - HEADER - FOOTER;
    const scale = Math.min(availW / sheet.width, availH / sheet.height);
    const x = MARGIN + (availW - sheet.width * scale) / 2;
    const y = MARGIN + HEADER + (availH - sheet.height * scale) / 2;
    drawSheet(page, sheet, { x, y, scale }, input.pieceNames, regular, bold);

    const top = (mm: number): number => (ph - mm) * PT;
    page.drawText(`${input.title} — ${input.planLabel}`, { x: MARGIN * PT, y: top(MARGIN + 5), size: 13, font: bold, color: C.ink });
    const info = [
      `Kalıp ${number}/${input.totalSheets}`,
      `${sheet.stockName} ${dims(sheet.width, sheet.height)}`,
      sheet.copies > 1 ? `×${sheet.copies} tabaka` : '1 tabaka',
      `${sheet.stats.pieceCount} parça`,
      `${sheet.stats.cuts} kesim`,
      `ölçek 1:${fmtNum(1 / scale, 1)}`,
    ].join('  ·  ');
    page.drawText(info, { x: MARGIN * PT, y: top(MARGIN + 11), size: 9, font: regular, color: C.muted });
    drawLegend(page, regular, MARGIN * PT, (MARGIN - 4) * PT);
    const foot = `Giyotin Kesim Planlayıcı · ${date}`;
    page.drawText(foot, { x: (pw - MARGIN) * PT - regular.widthOfTextAtSize(foot, 7), y: (MARGIN - 4) * PT, size: 7, font: regular, color: C.muted });
  }
  return doc.save();
}

const dims = (w: number, h: number): string => `${fmtNum(w)} × ${fmtNum(h)} mm`;

interface Frame {
  /** Top-left corner of the sheet on the page, mm from the page's top-left. */
  x: number;
  y: number;
  /** Page mm per sheet mm. */
  scale: number;
}

function drawSheet(page: PDFPage, sheet: SheetPlan, f: Frame, names: Map<string, string>, regular: PDFFont, bold: PDFFont): void {
  const H = page.getHeight();
  // Sheet coordinates (mm, y down) to PDF points (y up).
  const rect = (x: number, y: number, w: number, h: number): { x: number; y: number; width: number; height: number } => ({
    x: (f.x + x * f.scale) * PT,
    y: H - (f.y + (y + h) * f.scale) * PT,
    width: w * f.scale * PT,
    height: h * f.scale * PT,
  });
  // Line widths and labels grow with the drawing, but stay readable on A4.
  const line = Math.max(0.4, Math.min(1.2, sheet.width * f.scale * PT / 600));
  // Large offcuts would otherwise get huge letters on A4.
  const maxText = f.scale >= 1 ? 40 : 14;

  page.drawRectangle({ ...rect(0, 0, sheet.width, sheet.height), color: C.trim, borderColor: C.ink, borderWidth: line * 1.5 });
  walk(sheet.tree, (n) => {
    if (n.type === 'piece') page.drawRectangle({ ...rect(n.x, n.y, n.w, n.h), color: C.piece, borderColor: C.ink, borderWidth: line });
    else if (n.type === 'offcut') page.drawRectangle({ ...rect(n.x, n.y, n.w, n.h), color: C.offcut, borderColor: C.offcutInk, borderWidth: line });
    else if (n.type === 'waste') page.drawRectangle({ ...rect(n.x, n.y, n.w, n.h), color: C.waste });
  });

  const cuts = collectCuts(sheet.tree);
  for (const c of cuts) {
    const k = c.kerf;
    if (k > 0) {
      const strip = c.direction === 'vertical' ? rect(c.x + c.position, c.y, Math.min(k, c.w - c.position), c.h) : rect(c.x, c.y + c.position, c.w, Math.min(k, c.h - c.position));
      page.drawRectangle({ ...strip, color: C.kerf });
    }
  }

  for (const p of collectPieces(sheet.tree)) {
    const name = names.get(p.pieceId) ?? p.pieceId;
    label(page, rect(p.x, p.y, p.w, p.h), [name, `${fmtNum(p.w)}×${fmtNum(p.h)}`], [bold, regular], C.ink, maxText);
  }
  walk(sheet.tree, (n) => {
    if (n.type === 'offcut') label(page, rect(n.x, n.y, n.w, n.h), ['ARTIK', `${fmtNum(n.w)}×${fmtNum(n.h)}`], [bold, regular], C.offcutInk, maxText);
  });

  // Cut numbers in a circle where the blade enters (top edge for vertical cuts, left edge for horizontal ones).
  const r = Math.max(4.5, Math.min(14, sheet.width * f.scale * PT / 90));
  for (const c of cuts) {
    const mid = c.position + c.kerf / 2;
    const at = c.direction === 'vertical' ? rect(c.x + mid, c.y, 0, 0) : rect(c.x, c.y + mid, 0, 0);
    const cx = c.direction === 'vertical' ? at.x : at.x + r + 1;
    const cy = c.direction === 'vertical' ? at.y - r - 1 : at.y;
    const text = String(c.sequence);
    const size = r * (text.length > 2 ? 0.8 : 1.05);
    page.drawCircle({ x: cx, y: cy, size: r, color: C.cut, borderColor: rgb(1, 1, 1), borderWidth: r / 8 });
    page.drawText(text, { x: cx - bold.widthOfTextAtSize(text, size) / 2, y: cy - size * 0.36, size, font: bold, color: rgb(1, 1, 1) });
  }
}

/** Two centred lines (name, size) at the largest size that fits; turned by 90° in tall narrow boxes. */
function label(page: PDFPage, box: { x: number; y: number; width: number; height: number }, lines: [string, string], fonts: [PDFFont, PDFFont], color: RGB, max: number): void {
  const fit = (w: number, h: number): number => {
    const widest = Math.max(fonts[0].widthOfTextAtSize(lines[0], 1), fonts[1].widthOfTextAtSize(lines[1], 1) / 0.8);
    return Math.min((w * 0.9) / widest, (h * 0.8) / 2.1, max);
  };
  const flat = fit(box.width, box.height);
  const turned = fit(box.height, box.width);
  const rotate = turned > flat * 1.2;
  const size = rotate ? turned : flat;
  if (size < 3) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rows = [
    { text: lines[0], font: fonts[0], size, offset: size * 0.15 },
    { text: lines[1], font: fonts[1], size: size * 0.8, offset: -size * 0.95 },
  ];
  for (const row of rows) {
    const w = row.font.widthOfTextAtSize(row.text, row.size);
    // Unrotated: x along the text, y up. Rotated by 90°: the text runs bottom to top.
    const x = rotate ? cx - row.offset : cx - w / 2;
    const y = rotate ? cy - w / 2 : cy + row.offset;
    page.drawText(row.text, { x, y, size: row.size, font: row.font, color, rotate: degrees(rotate ? 90 : 0) });
  }
}

function drawLegend(page: PDFPage, font: PDFFont, x: number, y: number): void {
  const items: Array<[RGB, RGB | undefined, string]> = [
    [C.piece, C.ink, 'Ürün'],
    [C.offcut, C.offcutInk, 'Artık (saklanır)'],
    [C.waste, undefined, 'Fire'],
    [C.trim, undefined, 'Kenar payı'],
    [C.kerf, undefined, 'Bıçak payı'],
    [C.cut, undefined, 'Kesim sırası'],
  ];
  let cx = x;
  for (const [fill, border, text] of items) {
    page.drawRectangle({ x: cx, y: y - 1, width: 8, height: 8, color: fill, borderColor: border, borderWidth: border ? 0.5 : 0 });
    page.drawText(text, { x: cx + 11, y, size: 7, font, color: C.muted });
    cx += 11 + font.widthOfTextAtSize(text, 7) + 12;
  }
}
