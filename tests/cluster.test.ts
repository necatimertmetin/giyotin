import { describe, expect, it } from 'vitest';
import { clusterPieces, togetherness } from '../src/engine/cluster';
import { collectCuts, collectPieces, type TreeNode } from '../src/engine';

const piece = (id: string, x: number): TreeNode => ({ type: 'piece', x, y: 0, w: 100, h: 50, pieceId: id, rotated: false });

describe('clusterPieces', () => {
  // Three strips side by side, 3 mm kerf: A | B | A. Swapping the right-hand strips puts the two A pieces together.
  const tree: TreeNode = {
    type: 'cut', x: 0, y: 0, w: 306, h: 50, direction: 'vertical', position: 100, kerf: 3, sequence: 1,
    first: piece('A', 0),
    second: {
      type: 'cut', x: 103, y: 0, w: 203, h: 50, direction: 'vertical', position: 100, kerf: 3, sequence: 2,
      first: piece('B', 103),
      second: piece('A', 206),
    },
  };

  it('brings pieces of the same product together', () => {
    const out = clusterPieces(tree, 3);
    expect(togetherness(collectPieces(tree), 3)).toBe(0);
    expect(togetherness(collectPieces(out), 3)).toBe(50);
  });

  it('keeps the same pieces, cuts and outline and does not touch the input', () => {
    const before = JSON.stringify(tree);
    const out = clusterPieces(tree, 3);
    expect(JSON.stringify(tree)).toBe(before);
    expect(collectPieces(out).map((p) => p.pieceId).sort()).toEqual(['A', 'A', 'B']);
    expect(collectCuts(out)).toHaveLength(2);
    const xs = collectPieces(out).map((p) => p.x).sort((a, b) => a - b);
    expect(xs).toEqual([0, 103, 206]);
  });
});
