import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildLayoutPdf, type PdfPaper } from '../src/client/export/layoutPdf';
import { input, piece, solve, stock } from './helpers';

const fonts = {
  regular: new Uint8Array(readFileSync('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf')),
  bold: new Uint8Array(readFileSync('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf')),
};

const inp = input([piece('a', 300, 200, 6), piece('b', 150, 100, 4)], [stock('s', 841, 1189, 3)], { kerf: 3 });
const plan = solve(inp).plans[0]!;
const names = new Map([['a', 'Kartvizit Şık'], ['b', 'Etiket ğüşİı']]);

async function read(paper: PdfPaper): Promise<{ sizes: Array<[number, number]>; text: string }> {
  const bytes = await buildLayoutPdf({
    title: 'Sipariş Çiğdem',
    planLabel: 'Önerilen',
    sheets: plan.sheets.map((sheet, i) => ({ sheet, number: i + 1 })),
    totalSheets: plan.sheets.length,
    pieceNames: names,
    paper,
    fonts,
  });
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const sizes: Array<[number, number]> = [];
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    sizes.push([Math.round((page.view[2]! * 25.4) / 72), Math.round((page.view[3]! * 25.4) / 72)]);
    text += (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');
  }
  return { sizes, text };
}

describe('layout PDF', () => {
  it('puts every layout on an A4 page with a Turkish header and the piece names', async () => {
    const { sizes, text } = await read('a4');
    expect(sizes).toHaveLength(plan.sheets.length);
    for (const [w, h] of sizes) expect([w, h].sort()).toEqual([210, 297]);
    expect(text).toContain('Sipariş Çiğdem');
    expect(text).toContain('Kartvizit Şık');
    expect(text).toContain('Kalıp 1/');
  });

  it('makes the page as large as the sheet in 1:1 mode', async () => {
    const { sizes, text } = await read('sheet');
    expect(sizes[0]).toEqual([841, 1189]);
    expect(text).toContain('1:1');
  });
});
