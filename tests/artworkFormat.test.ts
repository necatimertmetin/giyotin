import { describe, expect, it } from 'vitest';
import { baseName, intersect, kindOf, pageBox, pieceBox, postScriptBox, postScriptPart, ptToMm, svgSize } from '../src/client/import/artworkFormat';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('artwork file kinds', () => {
  it('recognises PDF-compatible Illustrator files, PostScript, SVG and unreadable formats', () => {
    expect(kindOf('kartvizit.ai', bytes('%PDF-1.6\n%âãÏÓ'))).toBe('pdf');
    expect(kindOf('flyer.pdf', bytes('%PDF-1.4'))).toBe('pdf');
    expect(kindOf('eski.ai', bytes('%!PS-Adobe-3.0 \n%%Creator: Adobe Illustrator'))).toBe('postscript');
    expect(kindOf('logo.eps', new Uint8Array([0xc5, 0xd0, 0xd3, 0xc6, 0, 0]))).toBe('postscript');
    expect(kindOf('etiket.svg', bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">'))).toBe('svg');
    expect(kindOf('afis.cdr', bytes('PK\u0003\u0004'))).toBe('corel');
    expect(kindOf('brosur.FH11', bytes('AGD3'))).toBe('freehand');
    expect(kindOf('foto.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('unknown');
  });

  it('strips only the extension from the product name', () => {
    expect(baseName('Kartvizit 85x55.final.ai')).toBe('Kartvizit 85x55.final');
    expect(baseName('afis')).toBe('afis');
  });
});

describe('sizes', () => {
  it('converts points to mm, rounded to 0.1 mm', () => {
    expect(ptToMm(595.276)).toBe(210);
    expect(ptToMm(841.89)).toBe(297);
    expect(ptToMm(240.945)).toBe(85);
  });

  it('reads the PostScript bounding box, preferring the high-resolution one', () => {
    expect(postScriptBox('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 241 156\n%%HiResBoundingBox: 0 0 240.945 155.906\n')).toEqual([0, 0, 240.945, 155.906]);
    expect(postScriptBox('%!PS\n%%BoundingBox: (atend)\n%%BoundingBox: 10 20 110 220\n')).toEqual([10, 20, 110, 220]);
    expect(postScriptBox('%!PS\n')).toBeNull();
  });

  it('finds the PostScript section of a DOS EPS file', () => {
    const ps = bytes('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 50\n');
    const file = new Uint8Array(30 + ps.length);
    file.set([0xc5, 0xd0, 0xd3, 0xc6]);
    new DataView(file.buffer).setUint32(4, 30, true);
    new DataView(file.buffer).setUint32(8, ps.length, true);
    file.set(ps, 30);
    expect(new TextDecoder().decode(postScriptPart(file))).toBe(new TextDecoder().decode(ps));
  });

  it('reads SVG sizes from units, from one side plus the viewBox, or from the viewBox alone', () => {
    expect(svgSize('<svg width="85mm" height="55mm" viewBox="0 0 85 55">')).toEqual({ width: 85, height: 55 });
    expect(svgSize('<svg width="8.5cm" height="5.5cm">')).toEqual({ width: 85, height: 55 });
    expect(svgSize('<svg width="3in" viewBox="0 0 300 150">')).toEqual({ width: 76.2, height: 38.1 });
    expect(svgSize('<svg viewBox="0 0 96 192">')).toEqual({ width: 25.4, height: 50.8 });
    expect(svgSize('<svg width="100%" height="100%" viewBox="0,0,960,480">')).toEqual({ width: 254, height: 127 });
    expect(svgSize('<svg>')).toBeNull();
  });

  it('reads the trim box of the right page object and ignores the bleed', () => {
    const pdf = [
      '%PDF-1.6',
      '12 0 obj <</Type/Page/MediaBox[0 0 612 792]/TrimBox[9 9 603 783]>> endobj',
      '3 0 obj <</Type/Page/MediaBox[0 0 258.9 173.8]/BleedBox[0 0 258.9 173.8]/TrimBox[ 8.5 8.94 249.45 164.85 ]>> endobj',
      '4 0 obj <</Type/Page/MediaBox[0 0 100 100]>> endobj',
    ].join('\n');
    const trim = pageBox(pdf, 3, 0)!;
    expect(trim).toEqual([8.5, 8.94, 249.45, 164.85]);
    expect(ptToMm(trim[2] - trim[0])).toBe(85);
    expect(ptToMm(trim[3] - trim[1])).toBe(55);
    expect(pageBox(pdf, 4, 0)).toBeNull();
    expect(pageBox(pdf, 2, 0)).toBeNull();
  });

  it('clips a box to another one', () => {
    expect(intersect([-10, -10, 50, 50], [0, 0, 100, 100])).toEqual([0, 0, 50, 50]);
    expect(intersect([200, 200, 300, 300], [0, 0, 100, 100])).toBeNull();
  });

  it('uses the art box when the trim box is the whole page (a label on an A4 artboard)', () => {
    // spark.pdf from Illustrator: A4 landscape page, trim = page, the label drawn in a 816×156 pt strip.
    const view: [number, number, number, number] = [0, 0, 841.89, 595.276];
    const art: [number, number, number, number] = [0, 315.824, 816.628, 472.208];
    const r = pieceBox(view, view, art);
    expect(r.fromArt).toBe(true);
    expect([ptToMm(r.box[2] - r.box[0]), ptToMm(r.box[3] - r.box[1])]).toEqual([288.1, 55.2]);
    // A real trim box wins over the art box; without either the page is the piece.
    expect(pieceBox(view, [9, 9, 832.89, 586.276], art)).toEqual({ box: [9, 9, 832.89, 586.276], fromArt: false });
    expect(pieceBox(view, null, null)).toEqual({ box: view, fromArt: false });
    expect(pieceBox(view, view, view)).toEqual({ box: view, fromArt: false });
  });
});
