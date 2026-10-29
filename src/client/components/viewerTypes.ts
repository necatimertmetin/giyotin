import type { CutNode, OffcutNode, PieceNode, PieceSpec, WasteNode } from '../../engine';

export interface PieceInfo {
  id: string;
  name: string;
  code: string;
  width: number;
  height: number;
  quantity: number;
  fill: string;
  stroke: string;
  /** Preview image (data URL) drawn on the piece instead of the plain colour; in the declared width × height. */
  artwork: string | null;
}

export type Selection =
  | { kind: 'piece'; node: PieceNode }
  | { kind: 'cut'; node: CutNode }
  | { kind: 'remnant'; node: OffcutNode | WasteNode };

const codeOf = (index: number): string => {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

/** Stable, distinguishable colours per product (light fills, dark outlines, dark text works on all). */
export function buildPieceInfo(pieces: PieceSpec[], artworks: Map<string, string> = new Map()): Map<string, PieceInfo> {
  const map = new Map<string, PieceInfo>();
  pieces.forEach((p, i) => {
    const hue = Math.round((i * 137.508 + 205) % 360);
    map.set(p.id, {
      id: p.id,
      name: p.name,
      code: codeOf(i),
      width: p.width,
      height: p.height,
      quantity: p.quantity,
      fill: `hsl(${hue} 62% 80%)`,
      stroke: `hsl(${hue} 55% 28%)`,
      artwork: (p.artworkId && artworks.get(p.artworkId)) || null,
    });
  });
  return map;
}
