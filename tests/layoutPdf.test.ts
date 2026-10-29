import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, rgb } from 'pdf-lib';
import { collectPieces } from '../src/engine';
import { buildLayoutPdf, type PdfArtwork, type PdfPaper } from '../src/client/export/layoutPdf';
import { input, piece, solve, stock } from './helpers';

// A 1×1 red PNG stands in for a product's artwork.
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

const inp = input([piece('a', 300, 200, 6), piece('b', 150, 100, 4)], [stock('s', 841, 1189, 3)], { kerf: 3 });
const plan = solve(inp).plans[0]!;

const image: PdfArtwork = { kind: 'image', bytes: png, type: 'png' };

async function read(
  paper: PdfPaper,
  sideways = false,
  artwork: PdfArtwork = image,
  cutLines = true,
): Promise<{ sizes: Array<[number, number]>; text: string; images: number; forms: number; strokes: number }> {
  const bytes = await buildLayoutPdf({ title: 'Sipariş', sheets: plan.sheets.map((sheet) => ({ sheet, sideways })), paper, artworks: new Map([['a', artwork]]), cutLines });
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const sizes: Array<[number, number]> = [];
  let text = '';
  let images = 0;
  let forms = 0;
  let strokes = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    sizes.push([Math.round((page.view[2]! * 25.4) / 72), Math.round((page.view[3]! * 25.4) / 72)]);
    text += (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
    const ops = await page.getOperatorList();
    images += ops.fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject).length;
    forms += ops.fnArray.filter((fn) => fn === pdfjs.OPS.paintFormXObjectBegin).length;
    strokes += ops.fnArray.filter((fn) => fn === pdfjs.OPS.stroke || fn === pdfjs.OPS.constructPath).length;
  }
  return { sizes, text, images, forms, strokes };
}

const artworkPieces = plan.sheets.reduce((n, s) => n + collectPieces(s.tree).filter((p) => p.pieceId === 'a').length, 0);

describe('layout PDF', () => {
  it('puts every layout on an A4 page with only cut lines and the product artwork', async () => {
    const { sizes, text, images } = await read('a4');
    expect(sizes).toHaveLength(plan.sheets.length);
    for (const [w, h] of sizes) expect([w, h].sort()).toEqual([210, 297]);
    expect(text).toBe('');
    expect(images).toBe(artworkPieces);
  });

  it('makes the page as large as the sheet in 1:1 mode', async () => {
    const { sizes, images } = await read('sheet');
    expect(sizes[0]).toEqual([841, 1189]);
    expect(images).toBe(artworkPieces);
  });

  it('turns the sheet like the viewer does', async () => {
    const { sizes, images } = await read('sheet', true);
    expect(sizes[0]).toEqual([1189, 841]);
    expect(images).toBe(artworkPieces);
  });

  it('places the vector original of a product instead of a picture, and can leave out the cut lines', async () => {
    // A one-page "artwork" PDF: a red label in the middle of an A4 page; the box is the label.
    const art = await PDFDocument.create();
    art.addPage([595, 842]).drawRectangle({ x: 100, y: 300, width: 300, height: 200, color: rgb(1, 0, 0) });
    const vector: PdfArtwork = { kind: 'vector', pdf: await art.save(), box: [100, 300, 400, 500] };
    const withLines = await read('a4', false, vector, true);
    expect(withLines.images).toBe(0);
    expect(withLines.forms).toBe(artworkPieces);
    const without = await read('a4', false, vector, false);
    expect(without.forms).toBe(artworkPieces);
    // Only the artwork's own rectangle is drawn as a path, once per piece.
    expect(without.strokes).toBeLessThan(withLines.strokes);
  });
});
