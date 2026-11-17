import { collectCuts, collectPieces, numberCuts } from './geometry';
import type { CutNode, PieceNode, TreeNode } from './types';

/**
 * Keeps pieces of the same product together on a sheet without changing the paper or the number of cuts.
 *
 * Every guillotine cut splits its region into two strips; swapping the strips (and moving their contents with them)
 * is always another valid cutting tree with the same pieces, waste and cuts. A hill climb swaps strips wherever that
 * makes more same-product pieces touch, measured as the length of their shared edges (across one kerf).
 */

function shift(node: TreeNode, dx: number, dy: number): void {
  node.x += dx;
  node.y += dy;
  if (node.type === 'cut') {
    shift(node.first, dx, dy);
    if (node.second) shift(node.second, dx, dy);
  }
}

/** Swaps the two strips of a cut in place; doing it twice restores the original. */
function swapStrips(c: CutNode): void {
  const second = c.second!;
  const extent = c.direction === 'vertical' ? c.w : c.h;
  const rest = extent - c.position - c.kerf;
  const toFirst = -(c.position + c.kerf);
  const toSecond = rest + c.kerf;
  if (c.direction === 'vertical') {
    shift(second, toFirst, 0);
    shift(c.first, toSecond, 0);
  } else {
    shift(second, 0, toFirst);
    shift(c.first, 0, toSecond);
  }
  c.second = c.first;
  c.first = second;
  c.position = rest;
}

const overlap = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Total length of edges shared by pieces of the same product (gap at most `gap`). */
export function togetherness(pieces: PieceNode[], gap: number): number {
  let score = 0;
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i]!;
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j]!;
      if (a.pieceId !== b.pieceId) continue;
      const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
      const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      if (gx >= 0 && gx <= gap) score += overlap(a.y, a.y + a.h, b.y, b.y + b.h);
      else if (gy >= 0 && gy <= gap) score += overlap(a.x, a.x + a.w, b.x, b.x + b.w);
    }
  }
  return score;
}

/** A copy of `tree` with its strips arranged so same-product pieces sit together; cuts are renumbered. */
export function clusterPieces(tree: TreeNode, kerf: number): TreeNode {
  const copy = JSON.parse(JSON.stringify(tree)) as TreeNode;
  const pieces = collectPieces(copy);
  if (new Set(pieces.map((p) => p.pieceId)).size < 2) return tree;
  const cuts = collectCuts(copy).filter((c) => c.second && c.kerf === kerf);
  let best = togetherness(pieces, kerf);
  const start = best;
  for (let round = 0; round < 6; round++) {
    let improved = false;
    for (const c of cuts) {
      swapStrips(c);
      const score = togetherness(pieces, kerf);
      if (score > best) {
        best = score;
        improved = true;
      } else swapStrips(c);
    }
    if (!improved) break;
  }
  if (best === start) return tree;
  numberCuts(copy);
  return copy;
}
