import { PDFArray, PDFDict, PDFDocument, PDFFont, PDFImage, PDFRef, PDFStream, degrees, rgb, type PDFEmbeddedPage, type PDFObject, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { collectCuts, collectPieces, type SheetPlan } from '../../engine';

/** 'a4': every layout scaled onto an A4 page; 'sheet': the page is the sheet itself, 1:1. */
export type PdfPaper = 'a4' | 'sheet';

export interface PdfImage {
  bytes: Uint8Array;
  type: 'png' | 'jpg';
}

/** A product's artwork: its vector original (a one-page PDF and the piece's box on it, in pt) or a raster image. */
export type PdfArtwork = ({ kind: 'image' } & PdfImage) | { kind: 'vector'; pdf: Uint8Array; box: [number, number, number, number] };

export interface LayoutPdfInput {
  title: string;
  /**
   * `sideways`: drawn turned by 90° clockwise, as the viewer shows tall sheets.
   */
  sheets: Array<{ sheet: SheetPlan; sideways: boolean; styles?: Map<string, PieceStyle> }>;
  paper: PdfPaper;
  /** Product artwork by piece id, in the product's declared width × height. */
  artworks: Map<string, PdfArtwork>;
  /** Draw the cut lines (off: only the artwork, e.g. for printing the sheet itself). */
  cutLines: boolean;
  /** TrueType font with the Turkish letters, for the summary and the piece texts. Needed only when one of them is printed. */
  font?: Uint8Array;
  /** A summary page printed first, before the layouts (A4 portrait). */
  summary?: SummaryPage;
}

/** Tarama (hatch) patterns for pieces without artwork, so that each product reads differently on the sheet. */
export type Hatch = 'diag' | 'anti' | 'horiz' | 'vert' | 'cross' | 'dots';

/** What is drawn on one piece of a layout: text lines in its middle (none for no text) and a hatch pattern (or none). */
export interface PieceStyle {
  lines: string[];
  hatch: Hatch | null;
}

/** A table on the summary page: column widths in mm (they add up to the text width), a header row and data rows. */
export interface SummaryTable {
  widths: number[];
  header: string[];
  rows: string[][];
}

export interface SummaryPage {
  title: string;
  tables: SummaryTable[];
  /** Lines under the tables: totals, shortfalls and similar. */
  notes: string[];
}

type Drawable = PDFImage | PDFEmbeddedPage;

const PT = 72 / 25.4;
const A4 = { w: 210, h: 297 };
const BLACK = rgb(0, 0, 0);
const SHADE = rgb(0.9, 0.9, 0.9);
/** Piece texts: the largest font size, pt. */
const TEXT_PT = 9;
/** Summary page: margin, table row height (mm) and font sizes (pt). */
const SUMMARY_MARGIN = 10;
const SUMMARY_ROW = 5.8;
const SUMMARY_PT = 9;
const SUMMARY_TITLE_PT = 14;
/** Hatch spacing (mm) and colour. */
const HATCH_MM = 2.5;
const HATCH_COLOR = rgb(0.35, 0.35, 0.35);

/** `text` cut short with an ellipsis so that it is at most `maxPt` wide at `size`. */
function fit(font: PDFFont, text: string, size: number, maxPt: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxPt) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > maxPt) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * The summary: one or more tables and notes on an A4 page, continued on further pages when they do not fit.
 * Every table row is drawn in a fixed grid; the header row is shaded.
 */
function drawSummary(doc: PDFDocument, s: SummaryPage, font: PDFFont): void {
  let page = doc.addPage([A4.w * PT, A4.h * PT]);
  let y = SUMMARY_MARGIN; // mm from the page's top
  const usable = A4.w - 2 * SUMMARY_MARGIN;
  const newPageIf = (h: number): void => {
    if (y + h > A4.h - SUMMARY_MARGIN) {
      page = doc.addPage([A4.w * PT, A4.h * PT]);
      y = SUMMARY_MARGIN;
    }
  };
  // Text with its baseline at ~¾ of the row height below `top`.
  const put = (text: string, xMm: number, top: number, size: number, maxMm: number): void => {
    page.drawText(fit(font, text, size, maxMm * PT), { x: xMm * PT, y: page.getHeight() - (top + SUMMARY_ROW * 0.75) * PT, size, font, color: BLACK });
  };
  const row = (cells: string[], widths: number[], shade: boolean): void => {
    newPageIf(SUMMARY_ROW);
    if (shade) page.drawRectangle({ x: SUMMARY_MARGIN * PT, y: page.getHeight() - (y + SUMMARY_ROW) * PT, width: usable * PT, height: SUMMARY_ROW * PT, color: SHADE });
    let x = SUMMARY_MARGIN;
    cells.forEach((c, i) => {
      put(c, x + 1, y, SUMMARY_PT, widths[i]! - 2);
      x += widths[i]!;
    });
    y += SUMMARY_ROW;
  };

  newPageIf(SUMMARY_TITLE_PT * 0.5);
  put(s.title, SUMMARY_MARGIN, y, SUMMARY_TITLE_PT, usable);
  y += SUMMARY_ROW * 2;
  for (const t of s.tables) {
    row(t.header, t.widths, true);
    for (const r of t.rows) row(r, t.widths, false);
    y += SUMMARY_ROW;
  }
  for (const note of s.notes) {
    newPageIf(SUMMARY_ROW);
    put(note, SUMMARY_MARGIN, y, SUMMARY_PT, usable);
    y += SUMMARY_ROW;
  }
}

/**
 * The sheet as it is cut, nothing else: the cut lines and, where a product has artwork, the artwork itself – as
 * vectors when its original page is known. No labels, numbers, kerf or offcut colouring.
 */
export async function buildLayoutPdf(input: LayoutPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setCreator('Giyotin Kesim Planlayıcı');
  const embedded = new Map<string, Drawable>();
  let font: PDFFont | null = null;
  if (input.font && (input.summary || input.sheets.some((s) => [...(s.styles?.values() ?? [])].some((st) => st.lines.length)))) {
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(input.font, { subset: true });
  }
  for (const [id, art] of input.artworks) {
    if (art.kind === 'vector') {
      // Embedded once as a form XObject and placed on every copy of the piece, so the file grows by one drawing.
      const src = await PDFDocument.load(art.pdf, { ignoreEncryption: true, updateMetadata: false });
      const [left, bottom, right, top] = art.box;
      embedded.set(id, await doc.embedPage(src.getPage(0), { left, bottom, right, top }));
    } else embedded.set(id, art.type === 'png' ? await doc.embedPng(art.bytes) : await doc.embedJpg(art.bytes));
  }
  if (input.summary && font) drawSummary(doc, input.summary, font);

  for (const { sheet, sideways, styles } of input.sheets) {
    const opts: DrawOpts = { cutLines: input.cutLines, styles: styles ?? new Map(), font };
    // Size of the sheet as drawn on the page.
    const dw = sideways ? sheet.height : sheet.width;
    const dh = sideways ? sheet.width : sheet.height;
    if (input.paper === 'sheet') {
      // 1:1 is the cutting template itself: the page is exactly the sheet, in the corner, with nothing else on it.
      const page = doc.addPage([dw * PT, dh * PT]);
      drawSheet(page, sheet, { x: 0, y: 0, scale: 1, sideways }, embedded, opts);
      continue;
    }
    const landscape = dw >= dh;
    const pw = landscape ? A4.h : A4.w;
    const ph = landscape ? A4.w : A4.h;
    // Edge to edge: the sheet touches the page on its tighter side.
    const scale = Math.min(pw / dw, ph / dh);
    const frame = { x: (pw - dw * scale) / 2, y: (ph - dh * scale) / 2, scale, sideways };
    const page = doc.addPage([pw * PT, ph * PT]);
    drawSheet(page, sheet, frame, embedded, opts);
  }
  await doc.flush();
  dropUnused(doc);
  return doc.save();
}

/**
 * Embedding a page copies its original content streams in, then writes them again merged into one drawing; the
 * originals stay behind unused (doubling the size: 27 MB more for spark.pdf). pdf-lib saves every object it holds,
 * so whatever cannot be reached from the document catalog is removed here.
 */
function dropUnused(doc: PDFDocument): void {
  const ctx = doc.context;
  const seen = new Set<string>();
  const visit = (obj: PDFObject | undefined): void => {
    if (obj instanceof PDFRef) {
      if (seen.has(obj.tag)) return;
      seen.add(obj.tag);
      visit(ctx.lookup(obj));
    } else if (obj instanceof PDFDict) for (const [, v] of obj.entries()) visit(v);
    else if (obj instanceof PDFArray) for (const v of obj.asArray()) visit(v);
    else if (obj instanceof PDFStream) visit(obj.dict);
  };
  visit(ctx.trailerInfo.Root);
  visit(ctx.trailerInfo.Info);
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) ctx.delete(ref);
}

interface Frame {
  /** Top-left corner of the sheet on the page, mm from the page's top-left. */
  x: number;
  y: number;
  /** Page mm per sheet mm. */
  scale: number;
  /** Sheet turned by 90° clockwise: its point (x, y) is drawn at (height − y, x). */
  sideways: boolean;
}

interface DrawOpts {
  cutLines: boolean;
  /** Text and hatch per piece id, for this layout. */
  styles: Map<string, PieceStyle>;
  font: PDFFont | null;
}

function drawSheet(page: PDFPage, sheet: SheetPlan, f: Frame, images: Map<string, Drawable>, opts: DrawOpts): void {
  const H = page.getHeight();
  // Sheet coordinates (mm, y down) to PDF points (y up), through the optional quarter turn.
  const at = (x: number, y: number): { x: number; y: number } => {
    const [dx, dy] = f.sideways ? [sheet.height - y, x] : [x, y];
    return { x: (f.x + dx * f.scale) * PT, y: H - (f.y + dy * f.scale) * PT };
  };
  const thickness = 0.5;
  const labels: Array<() => void> = [];

  for (const p of collectPieces(sheet.tree)) {
    const img = images.get(p.pieceId);
    const style = opts.styles.get(p.pieceId);
    if (!img && !style) continue;
    // Corners of the piece as drawn: left/right and top/bottom on the page.
    const a = at(p.x, p.y);
    const b = at(p.x + p.w, p.y + p.h);
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y, b.y);
    // The artwork is in the declared orientation. A rotated piece turns it by 90° clockwise (as in the preview),
    // and so does a sideways sheet: 0, 1 or 2 quarter turns in all.
    if (img) {
      const turns = (p.rotated ? 1 : 0) + (f.sideways ? 1 : 0);
      const w = right - left;
      const h = top - bottom;
      const place =
        turns === 0
          ? { x: left, y: bottom, width: w, height: h }
          : turns === 1
            ? { x: left, y: top, width: h, height: w, rotate: degrees(-90) }
            : { x: right, y: top, width: w, height: h, rotate: degrees(180) };
      if (img instanceof PDFImage) page.drawImage(img, place);
      else page.drawPage(img, place);
    } else if (style?.hatch) hatchRect(page, left, bottom, right, top, style.hatch);
    // Texts go on top of the cut lines, after them.
    if (style && style.lines.length > 0 && opts.font) {
      const font = opts.font;
      labels.push(() => labelRect(page, font, style.lines, left, bottom, right, top));
    }
  }

  const cutLines = (): void => {
  const line =(x1: number, y1: number, x2: number, y2: number): void => page.drawLine({ start: at(x1, y1), end: at(x2, y2), thickness, color: BLACK });
  // Edge trim is cut too: the border of the usable area, where it is inside the sheet.
  const u = sheet.usable;
  if (u.x > 0) line(u.x, 0, u.x, sheet.height);
  if (u.y > 0) line(0, u.y, sheet.width, u.y);
  if (u.x + u.w < sheet.width) line(u.x + u.w, 0, u.x + u.w, sheet.height);
  if (u.y + u.h < sheet.height) line(0, u.y + u.h, sheet.width, u.y + u.h);
  // Each cut is drawn in the middle of its kerf, across the region it splits.
  for (const c of collectCuts(sheet.tree)) {
    if (c.direction === 'vertical') {
      const x = c.x + Math.min(c.position + c.kerf / 2, c.w);
      line(x, c.y, x, c.y + c.h);
    } else {
      const y = c.y + Math.min(c.position + c.kerf / 2, c.h);
      line(c.x, y, c.x + c.w, y);
    }
  }
  };
  if (opts.cutLines) cutLines();
  for (const draw of labels) draw();
}

/** Tarama lines (or dots) over the rectangle l..r × b..t (pt, y up); every line is cut to the rectangle. */
function hatchRect(page: PDFPage, l: number, b: number, r: number, t: number, kind: Hatch): void {
  const step = HATCH_MM * PT;
  const seg = (x1: number, y1: number, x2: number, y2: number): void => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.3, color: HATCH_COLOR });
  };
  const diag = (): void => {
    // y = x + c, for every c that touches the rectangle.
    for (let c = b - r; c <= t - l; c += step) {
      const x0 = Math.max(l, b - c);
      const x1 = Math.min(r, t - c);
      if (x1 > x0) seg(x0, x0 + c, x1, x1 + c);
    }
  };
  const anti = (): void => {
    // y = c − x, for every c that touches the rectangle.
    for (let c = b + l; c <= t + r; c += step) {
      const x0 = Math.max(l, c - t);
      const x1 = Math.min(r, c - b);
      if (x1 > x0) seg(x0, c - x0, x1, c - x1);
    }
  };
  const horiz = (): void => {
    for (let y = b + step / 2; y < t; y += step) seg(l, y, r, y);
  };
  const vert = (): void => {
    for (let x = l + step / 2; x < r; x += step) seg(x, b, x, t);
  };
  if (kind === 'diag') diag();
  else if (kind === 'anti') anti();
  else if (kind === 'horiz') horiz();
  else if (kind === 'vert') vert();
  else if (kind === 'cross') {
    diag();
    anti();
  } else {
    for (let x = l + step / 2; x < r; x += step) {
      for (let y = b + step / 2; y < t; y += step) page.drawCircle({ x, y, size: 0.45 * PT, color: HATCH_COLOR });
    }
  }
}

/** Text lines in the middle of a piece, on a white block; the font shrinks with the piece, and the lines are cut to fit. */
function labelRect(page: PDFPage, font: PDFFont, lines: string[], l: number, b: number, r: number, t: number): void {
  const w = r - l;
  const h = t - b;
  const size = Math.min(TEXT_PT, Math.max(4, (Math.min(w, h) / PT) / 6));
  const pitch = size * 1.25;
  const blockH = lines.length * pitch + 4;
  // Too small for any text: the piece is left bare.
  if (w < 12 * PT || h < blockH) return;
  const texts = lines.map((s) => fit(font, s, size, w - 6));
  const blockW = Math.max(...texts.map((s) => font.widthOfTextAtSize(s, size))) + 6;
  const cx = (l + r) / 2;
  const cy = (b + t) / 2;
  page.drawRectangle({ x: cx - blockW / 2, y: cy - blockH / 2, width: blockW, height: blockH, color: rgb(1, 1, 1) });
  texts.forEach((s, i) => {
    const tw = font.widthOfTextAtSize(s, size);
    const baseline = cy + blockH / 2 - 2 - pitch * i - size * 0.8;
    page.drawText(s, { x: cx - tw / 2, y: baseline, size, font, color: BLACK });
  });
}
