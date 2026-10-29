import { PDFDocument, degrees, rgb, type PDFImage, type PDFPage } from 'pdf-lib';
import { collectCuts, collectPieces, type SheetPlan } from '../../engine';

/** 'a4': every layout scaled onto an A4 page; 'sheet': the page is the sheet itself, 1:1. */
export type PdfPaper = 'a4' | 'sheet';

export interface PdfImage {
  bytes: Uint8Array;
  type: 'png' | 'jpg';
}

export interface LayoutPdfInput {
  title: string;
  /** `sideways`: drawn turned by 90° clockwise, as the viewer shows tall sheets. */
  sheets: Array<{ sheet: SheetPlan; sideways: boolean }>;
  paper: PdfPaper;
  /** Product artwork by piece id, in the product's declared width × height. */
  images: Map<string, PdfImage>;
}

const PT = 72 / 25.4;
const A4 = { w: 210, h: 297 };
const BLACK = rgb(0, 0, 0);

/**
 * The sheet as it is cut, nothing else: the cut lines and, where a product has artwork, the
 * artwork itself. No labels, numbers, kerf or offcut colouring. Vector lines straight from the cut tree.
 */
export async function buildLayoutPdf(input: LayoutPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  doc.setCreator('Giyotin Kesim Planlayıcı');
  const embedded = new Map<string, PDFImage>();
  for (const [id, img] of input.images) embedded.set(id, img.type === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes));

  for (const { sheet, sideways } of input.sheets) {
    // Size of the sheet as drawn on the page.
    const dw = sideways ? sheet.height : sheet.width;
    const dh = sideways ? sheet.width : sheet.height;
    if (input.paper === 'sheet') {
      drawSheet(doc.addPage([dw * PT, dh * PT]), sheet, { x: 0, y: 0, scale: 1, sideways }, embedded);
      continue;
    }
    const landscape = dw >= dh;
    const pw = landscape ? A4.h : A4.w;
    const ph = landscape ? A4.w : A4.h;
    // Edge to edge: the sheet touches the page on its tighter side.
    const scale = Math.min(pw / dw, ph / dh);
    const frame = { x: (pw - dw * scale) / 2, y: (ph - dh * scale) / 2, scale, sideways };
    drawSheet(doc.addPage([pw * PT, ph * PT]), sheet, frame, embedded);
  }
  return doc.save();
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

function drawSheet(page: PDFPage, sheet: SheetPlan, f: Frame, images: Map<string, PDFImage>): void {
  const H = page.getHeight();
  // Sheet coordinates (mm, y down) to PDF points (y up), through the optional quarter turn.
  const at = (x: number, y: number): { x: number; y: number } => {
    const [dx, dy] = f.sideways ? [sheet.height - y, x] : [x, y];
    return { x: (f.x + dx * f.scale) * PT, y: H - (f.y + dy * f.scale) * PT };
  };
  const thickness = 0.5;

  for (const p of collectPieces(sheet.tree)) {
    const img = images.get(p.pieceId);
    if (!img) continue;
    // Corners of the piece as drawn: left/right and top/bottom on the page.
    const a = at(p.x, p.y);
    const b = at(p.x + p.w, p.y + p.h);
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y, b.y);
    // The artwork is in the declared orientation. A rotated piece turns it by 90° clockwise (as in the preview),
    // and so does a sideways sheet: 0, 1 or 2 quarter turns in all.
    const turns = (p.rotated ? 1 : 0) + (f.sideways ? 1 : 0);
    const w = right - left;
    const h = top - bottom;
    if (turns === 0) page.drawImage(img, { x: left, y: bottom, width: w, height: h });
    else if (turns === 1) page.drawImage(img, { x: left, y: top, width: h, height: w, rotate: degrees(-90) });
    else page.drawImage(img, { x: right, y: top, width: w, height: h, rotate: degrees(180) });
  }

  const line = (x1: number, y1: number, x2: number, y2: number): void => page.drawLine({ start: at(x1, y1), end: at(x2, y2), thickness, color: BLACK });
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
}
