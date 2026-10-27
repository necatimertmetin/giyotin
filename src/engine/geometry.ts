import type {
  CutNode,
  PieceGrain,
  PieceNode,
  RemnantNode,
  SheetStats,
  StockGrain,
  TreeNode,
} from './types';

/** The engine searches on an integer grid of 1/100 mm. */
export const UNIT = 100;

export const toUnits = (mm: number): number => Math.round(mm * UNIT);
export const toMm = (units: number): number => units / UNIT;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Orientation {
  w: number;
  h: number;
  rotated: boolean;
}

/**
 * Orientations in which a piece (declared w × h) may be cut from a stock item.
 * This single function is the only place that interprets rotation permissions and grain
 * constraints, so grain handling can be refined without touching the search.
 *
 * Grain: the stock grain runs along the stock's `width` or `height` axis. A piece that requires grain
 * along its own `height` must be cut unrotated on height-grain stock and rotated on width-grain stock.
 */
export function allowedOrientations(
  piece: { w: number; h: number; allowRotation: boolean; grain: PieceGrain },
  stock: { allowRotation: boolean; grain: StockGrain },
): Orientation[] {
  const candidates: Orientation[] = [{ w: piece.w, h: piece.h, rotated: false }];
  if (piece.allowRotation && stock.allowRotation && piece.w !== piece.h) {
    candidates.push({ w: piece.h, h: piece.w, rotated: true });
  }
  const pieceGrain = piece.grain;
  if (pieceGrain === 'any' || stock.grain === 'none') return candidates;
  return candidates.filter((o) => {
    // Axis (of the stock) along which the piece's required grain axis ends up.
    const requiredAxisOnStock: 'width' | 'height' = o.rotated
      ? pieceGrain === 'height'
        ? 'width'
        : 'height'
      : pieceGrain;
    return requiredAxisOnStock === stock.grain;
  });
}

export interface CutGeometry {
  kerf: number;
  first: Rect;
  second: Rect | null;
}

/**
 * Geometry of a guillotine cut through `region` at `position` (distance of the blade's leading
 * edge from the region's left/top edge). The kerf strip follows the position; when the remainder is
 * not wider than the kerf the blade simply hangs off the edge and no second region exists.
 */
export function cutGeometry(
  region: Rect,
  direction: 'vertical' | 'horizontal',
  position: number,
  kerf: number,
): CutGeometry {
  if (direction === 'vertical') {
    const rest = region.w - position;
    const kerfUsed = Math.min(kerf, rest);
    const secondW = rest - kerfUsed;
    return {
      kerf: kerfUsed,
      first: { x: region.x, y: region.y, w: position, h: region.h },
      second:
        secondW > 0 ? { x: region.x + position + kerfUsed, y: region.y, w: secondW, h: region.h } : null,
    };
  }
  const rest = region.h - position;
  const kerfUsed = Math.min(kerf, rest);
  const secondH = rest - kerfUsed;
  return {
    kerf: kerfUsed,
    first: { x: region.x, y: region.y, w: region.w, h: position },
    second:
      secondH > 0 ? { x: region.x, y: region.y + position + kerfUsed, w: region.w, h: secondH } : null,
  };
}

export const hasPiece = (node: TreeNode | null): boolean => {
  if (!node) return false;
  if (node.type === 'piece') return true;
  if (node.type === 'cut') return hasPiece(node.first) || hasPiece(node.second);
  return false;
};

/** Visit nodes in cut order (pre-order, first child before second). */
export function walk(node: TreeNode, visit: (n: TreeNode) => void): void {
  visit(node);
  if (node.type === 'cut') {
    walk(node.first, visit);
    if (node.second) walk(node.second, visit);
  }
}

export const collectPieces = (tree: TreeNode): PieceNode[] => {
  const out: PieceNode[] = [];
  walk(tree, (n) => {
    if (n.type === 'piece') out.push(n);
  });
  return out;
};

export const collectRemnants = (tree: TreeNode): RemnantNode[] => {
  const out: RemnantNode[] = [];
  walk(tree, (n) => {
    if (n.type === 'offcut' || n.type === 'waste') out.push(n);
  });
  return out;
};

/** Cuts ordered by their `sequence`. */
export const collectCuts = (tree: TreeNode): CutNode[] => {
  const out: CutNode[] = [];
  walk(tree, (n) => {
    if (n.type === 'cut') out.push(n);
  });
  return out.sort((a, b) => a.sequence - b.sequence);
};

/**
 * Assign 1-based sequence numbers in place; returns the number of cuts.
 *
 * The order is the one a shop floor wants. A "run" is the cuts of one direction that follow each other in the same
 * strip (all the cuts that divide that strip, parent before child). Runs are made level by level: first the runs
 * that cut the sheet, then the runs that cut the resulting strips, and so on, and within a level all runs of one
 * direction are made before the paper is turned. So cuts of the same kind stay together and nothing of another
 * kind comes in between; a cut always comes after the cut that created its region.
 */
export function numberCuts(tree: TreeNode): number {
  interface Run {
    level: number;
    direction: CutNode['direction'];
    top: CutNode;
    cuts: CutNode[];
  }
  const runs: Run[] = [];
  const visit = (node: TreeNode, parent: CutNode | null, run: Run | null): void => {
    if (node.type !== 'cut') return;
    let current = run;
    if (!current || !parent || parent.direction !== node.direction) {
      current = { level: run ? run.level + 1 : 0, direction: node.direction, top: node, cuts: [] };
      runs.push(current);
    }
    current.cuts.push(node);
    visit(node.first, node, current);
    if (node.second) visit(node.second, node, current);
  };
  visit(tree, null, null);

  const reading = (a: Run, b: Run): number => a.top.y - b.top.y || a.top.x - b.top.x;
  let seq = 0;
  let last: CutNode['direction'] | null = null;
  const maxLevel = runs.reduce((m, r) => Math.max(m, r.level), 0);
  for (let level = 0; level <= maxLevel; level++) {
    const atLevel = runs.filter((r) => r.level === level);
    // Turn the paper once per level: continue in the direction that is not the one just used.
    const first: CutNode['direction'] = last === 'vertical' ? 'horizontal' : last === 'horizontal' ? 'vertical' : (atLevel[0]?.direction ?? 'vertical');
    const second: CutNode['direction'] = first === 'vertical' ? 'horizontal' : 'vertical';
    for (const direction of [first, second]) {
      for (const run of atLevel.filter((r) => r.direction === direction).sort(reading)) {
        for (const cut of run.cuts) cut.sequence = ++seq;
        last = direction;
      }
    }
  }
  return seq;
}

export function scaleTree(node: TreeNode, factor: number): TreeNode {
  const s = (v: number): number => Math.round(v * factor * UNIT) / UNIT;
  if (node.type === 'cut') {
    return {
      ...node,
      x: s(node.x),
      y: s(node.y),
      w: s(node.w),
      h: s(node.h),
      position: s(node.position),
      kerf: s(node.kerf),
      first: scaleTree(node.first, factor),
      second: node.second ? scaleTree(node.second, factor) : null,
    };
  }
  return { ...node, x: s(node.x), y: s(node.y), w: s(node.w), h: s(node.h) };
}

const areaUnits = (w: number, h: number): number => Math.round(w * UNIT) * Math.round(h * UNIT);

/** Area accounting of a tree whose coordinates are in mm. */
export function computeSheetStats(
  tree: TreeNode,
  sheetWidth: number,
  sheetHeight: number,
  usable: Rect,
): SheetStats {
  let piece = 0;
  let kerf = 0;
  let waste = 0;
  let offcut = 0;
  let cuts = 0;
  let pieceCount = 0;
  walk(tree, (n) => {
    if (n.type === 'piece') {
      piece += areaUnits(n.w, n.h);
      pieceCount++;
    } else if (n.type === 'offcut') offcut += areaUnits(n.w, n.h);
    else if (n.type === 'waste') waste += areaUnits(n.w, n.h);
    else {
      cuts++;
      kerf += n.direction === 'vertical' ? areaUnits(n.kerf, n.h) : areaUnits(n.w, n.kerf);
    }
  });
  const sheet = areaUnits(sheetWidth, sheetHeight);
  const trim = sheet - areaUnits(usable.w, usable.h);
  const div = UNIT * UNIT;
  return {
    sheetArea: sheet / div,
    pieceArea: piece / div,
    kerfArea: kerf / div,
    wasteArea: (waste + trim) / div,
    trimArea: trim / div,
    offcutArea: offcut / div,
    cuts,
    pieceCount,
  };
}

/** Is a leftover rectangle large enough to be kept as a reusable offcut (rotation-agnostic)? */
export function isReusable(w: number, h: number, minW: number, minH: number): boolean {
  const small = Math.min(w, h);
  const large = Math.max(w, h);
  return small >= Math.min(minW, minH) && large >= Math.max(minW, minH);
}
