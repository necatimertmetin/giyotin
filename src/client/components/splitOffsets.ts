import { walk, type TreeNode } from '../../engine';

export interface Shift {
  dx: number;
  dy: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where every node of a cutting tree sits once the first `step` cuts are made and the two halves of each made
 * cut have moved `gap` mm apart (half of it each). Shifts add up down the tree, so a piece that was separated
 * by several cuts has moved by the sum of them.
 */
export function computeShifts(tree: TreeNode, step: number, gap: number): Map<TreeNode, Shift> {
  const out = new Map<TreeNode, Shift>();
  const visit = (node: TreeNode, dx: number, dy: number): void => {
    out.set(node, { dx, dy });
    if (node.type !== 'cut') return;
    const half = node.sequence <= step ? gap / 2 : 0;
    const vertical = node.direction === 'vertical';
    visit(node.first, dx - (vertical ? half : 0), dy - (vertical ? 0 : half));
    if (node.second) visit(node.second, dx + (vertical ? half : 0), dy + (vertical ? 0 : half));
  };
  visit(tree, 0, 0);
  return out;
}

const leafBounds = (tree: TreeNode, shifts: Map<TreeNode, Shift>, W: number, H: number): Bounds => {
  const b: Bounds = { x0: 0, y0: 0, x1: W, y1: H };
  walk(tree, (n) => {
    if (n.type === 'cut') return;
    const s = shifts.get(n) ?? { dx: 0, dy: 0 };
    b.x0 = Math.min(b.x0, n.x + s.dx);
    b.y0 = Math.min(b.y0, n.y + s.dy);
    b.x1 = Math.max(b.x1, n.x + n.w + s.dx);
    b.y1 = Math.max(b.y1, n.y + n.h + s.dy);
  });
  return b;
};

/** The gap per cut (small enough that the fully separated layout stays within ~25% of the sheet size) and the area it needs. */
export function splitLayout(tree: TreeNode, W: number, H: number): { gap: number; bounds: Bounds } {
  const unit = leafBounds(tree, computeShifts(tree, Number.POSITIVE_INFINITY, 1), W, H);
  const spreadX = Math.max(1, unit.x1 - unit.x0 - W);
  const spreadY = Math.max(1, unit.y1 - unit.y0 - H);
  const gap = Math.min(0.03 * Math.max(W, H), (0.25 * W) / spreadX, (0.25 * H) / spreadY);
  return { gap, bounds: leafBounds(tree, computeShifts(tree, Number.POSITIVE_INFINITY, gap), W, H) };
}
