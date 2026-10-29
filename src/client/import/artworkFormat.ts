/**
 * Pure helpers for reading product sizes out of artwork files (no DOM, no PDF library), so they can be unit tested.
 * PDF and PostScript lengths are points (1/72 in); SVG lengths default to CSS pixels (1/96 in).
 */

export type ArtworkKind = 'pdf' | 'postscript' | 'svg' | 'corel' | 'freehand' | 'unknown';

/** A PDF box or bounding box: [x0, y0, x1, y1] in points. */
export type Box = [number, number, number, number];

const MM_PER_PT = 25.4 / 72;
const MM_PER_UNIT: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: MM_PER_PT, pc: 12 * MM_PER_PT, px: 25.4 / 96, '': 25.4 / 96 };

/** Sizes are rounded to 0.1 mm: artboards drawn as 210 × 297 mm come out of the file as 209.9999… */
const round1 = (mm: number): number => Math.round(mm * 10) / 10;
export const ptToMm = (pt: number): number => round1(pt * MM_PER_PT);

const startsWith = (bytes: Uint8Array, magic: number[], at = 0): boolean => magic.every((b, i) => bytes[at + i] === b);
const ascii = (bytes: Uint8Array, length: number): string => String.fromCharCode(...bytes.subarray(0, length));

/** File name without its extension. */
export const baseName = (fileName: string): string => fileName.replace(/\.[^./\\]+$/, '').trim() || fileName;

export function kindOf(fileName: string, head: Uint8Array): ArtworkKind {
  const ext = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? '';
  const text = ascii(head, Math.min(head.length, 1024));
  // Illustrator saves a PDF inside the .ai file unless "Create PDF Compatible File" was switched off.
  if (text.includes('%PDF-')) return 'pdf';
  if (text.startsWith('%!PS') || startsWith(head, [0xc5, 0xd0, 0xd3, 0xc6])) return 'postscript';
  if (ext === 'svg' || /<svg[\s>]/i.test(text)) return 'svg';
  if (ext === 'cdr' || ext === 'cdt' || ext === 'cmx') return 'corel';
  if (/^(fh|ft)\d*$/.test(ext)) return 'freehand';
  return 'unknown';
}

/** The PostScript part of an EPS file; DOS EPS files wrap it with a binary header and a TIFF/WMF preview. */
export function postScriptPart(bytes: Uint8Array): Uint8Array {
  if (!startsWith(bytes, [0xc5, 0xd0, 0xd3, 0xc6])) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = view.getUint32(4, true);
  const length = view.getUint32(8, true);
  return bytes.subarray(start, Math.min(bytes.length, start + length));
}

/** %%HiResBoundingBox (preferred) or %%BoundingBox from the header of a PostScript file, in points. */
export function postScriptBox(text: string): Box | null {
  for (const key of ['%%HiResBoundingBox:', '%%BoundingBox:']) {
    const re = new RegExp(`^${key}\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)`, 'm');
    const m = re.exec(text);
    if (m) {
      const box = m.slice(1, 5).map(Number) as Box;
      if (box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1]) return box;
    }
  }
  return null;
}

function svgLength(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^\s*([\d.]+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?\s*$/i.exec(value);
  if (!m) return null; // percentages and other units: fall back to the viewBox
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n * MM_PER_UNIT[(m[2] ?? '').toLowerCase()]! : null;
}

/** Size of an SVG drawing in mm, from the root element's width/height, otherwise its viewBox (user units = px). */
export function svgSize(text: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  let width = svgLength(attr('width'));
  let height = svgLength(attr('height'));
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) {
    // One explicit side scales the other through the viewBox ratio.
    if (width === null && height !== null) width = (height * vb[2]!) / vb[3]!;
    else if (height === null && width !== null) height = (width * vb[3]!) / vb[2]!;
    else if (width === null && height === null) {
      width = vb[2]! * MM_PER_UNIT.px!;
      height = vb[3]! * MM_PER_UNIT.px!;
    }
  }
  return width && height ? { width: round1(width), height: round1(height) } : null;
}

/**
 * The /TrimBox (or another page box) of the page object `num gen obj`, if the page dictionary is stored uncompressed
 * (as Illustrator and most prepress exports do). pdf.js does not expose these, and the media/crop box includes the bleed.
 */
export function pageBox(pdfText: string, num: number, gen: number, kind: 'TrimBox' | 'ArtBox' = 'TrimBox'): Box | null {
  const obj = new RegExp(`(?:^|[^\\d])${num}\\s+${gen}\\s+obj\\b([\\s\\S]*?)\\bendobj`).exec(pdfText)?.[1];
  const m = obj && new RegExp(`/${kind}\\s*\\[\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s*\\]`).exec(obj);
  if (!m) return null;
  const [a, b, c, d] = m.slice(1, 5).map(Number) as Box;
  const box: Box = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
  return box[2] > box[0] && box[3] > box[1] ? box : null;
}

/** The part of `inner` that lies inside `outer`, or null when they do not overlap. */
export function intersect(inner: Box, outer: Box): Box | null {
  const box: Box = [Math.max(inner[0], outer[0]), Math.max(inner[1], outer[1]), Math.min(inner[2], outer[2]), Math.min(inner[3], outer[3])];
  return box[2] > box[0] && box[3] > box[1] ? box : null;
}

/** Below this difference (pt, ≈ 1 mm) two box edges count as the same. */
const SAME_EDGE_PT = 3;
const sameBox = (a: Box, b: Box): boolean => a.every((v, i) => Math.abs(v - b[i]!) < SAME_EDGE_PT);

/**
 * The finished piece on a PDF page. A trim box smaller than the page wins. When the trim box is the whole page
 * (a small label placed on an A4 artboard), Illustrator's /ArtBox – the extent of the drawing – is used instead;
 * `fromArt` tells the caller that the size is a guess the user should check.
 */
export function pieceBox(view: Box, trim: Box | null, art: Box | null): { box: Box; fromArt: boolean } {
  const t = trim && intersect(trim, view);
  if (t && !sameBox(t, view)) return { box: t, fromArt: false };
  const a = art && intersect(art, view);
  if (a && !sameBox(a, view)) return { box: a, fromArt: true };
  return { box: t ?? view, fromArt: false };
}
