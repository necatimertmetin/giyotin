import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { collectPieces } from '../src/engine';
import { buildLayoutPdf, type PdfPaper } from '../src/client/export/layoutPdf';
import { input, piece, solve, stock } from './helpers';

// A 1×1 red PNG stands in for a product's artwork.
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

const inp = input([piece('a', 300, 200, 6), piece('b', 150, 100, 4)], [stock('s', 841, 1189, 3)], { kerf: 3 });
const plan = solve(inp).plans[0]!;

async function read(paper: PdfPaper, sideways = false): Promise<{ sizes: Array<[number, number]>; text: string; images: number }> {
  const bytes = await buildLayoutPdf({ title: 'Sipariş', sheets: plan.sheets.map((sheet) => ({ sheet, sideways })), paper, images: new Map([['a', { bytes: png, type: 'png' }]]) });
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const sizes: Array<[number, number]> = [];
  let text = '';
  let images = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    sizes.push([Math.round((page.view[2]! * 25.4) / 72), Math.round((page.view[3]! * 25.4) / 72)]);
    text += (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
    const ops = await page.getOperatorList();
    images += ops.fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject).length;
  }
  return { sizes, text, images };
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
});
