import { describe, expect, it } from 'vitest';
import {
  allowedOrientations,
  collectCuts,
  collectPieces,
  collectRemnants,
  computeSheetStats,
  cutGeometry,
  isReusable,
  numberCuts,
  type TreeNode,
} from '../src/engine';

describe('cutGeometry', () => {
  it('splits a region and accounts for the kerf strip (vertical)', () => {
    const g = cutGeometry({ x: 0, y: 0, w: 100, h: 50 }, 'vertical', 40, 3);
    expect(g.kerf).toBe(3);
    expect(g.first).toEqual({ x: 0, y: 0, w: 40, h: 50 });
    expect(g.second).toEqual({ x: 43, y: 0, w: 57, h: 50 });
  });

  it('splits horizontally', () => {
    const g = cutGeometry({ x: 10, y: 20, w: 100, h: 50 }, 'horizontal', 30, 2);
    expect(g.first).toEqual({ x: 10, y: 20, w: 100, h: 30 });
    expect(g.second).toEqual({ x: 10, y: 52, w: 100, h: 18 });
  });

  it('lets the blade hang off the edge when the remainder is not wider than the kerf', () => {
    const g = cutGeometry({ x: 0, y: 0, w: 100, h: 50 }, 'vertical', 99, 3);
    expect(g.kerf).toBe(1);
    expect(g.second).toBeNull();
  });

  it('with zero kerf the two parts are adjacent', () => {
    const g = cutGeometry({ x: 0, y: 0, w: 100, h: 50 }, 'vertical', 60, 0);
    expect(g.second).toEqual({ x: 60, y: 0, w: 40, h: 50 });
  });
});

describe('allowedOrientations', () => {
  const p = { w: 20, h: 30, allowRotation: true, grain: 'any' as const };
  it('offers both orientations when rotation is allowed', () => {
    expect(allowedOrientations(p, { allowRotation: true, grain: 'none' })).toHaveLength(2);
  });
  it('respects the piece rotation flag', () => {
    expect(allowedOrientations({ ...p, allowRotation: false }, { allowRotation: true, grain: 'none' })).toEqual([
      { w: 20, h: 30, rotated: false },
    ]);
  });
  it('respects the stock rotation flag', () => {
    expect(allowedOrientations(p, { allowRotation: false, grain: 'none' })).toHaveLength(1);
  });
  it('does not duplicate square pieces', () => {
    expect(allowedOrientations({ ...p, w: 30 }, { allowRotation: true, grain: 'none' })).toHaveLength(1);
  });
  it('applies grain constraints', () => {
    const grainPiece = { ...p, grain: 'height' as const };
    expect(allowedOrientations(grainPiece, { allowRotation: true, grain: 'height' })).toEqual([
      { w: 20, h: 30, rotated: false },
    ]);
    expect(allowedOrientations(grainPiece, { allowRotation: true, grain: 'width' })).toEqual([
      { w: 30, h: 20, rotated: true },
    ]);
  });
});

describe('tree helpers', () => {
  // 100×50 sheet, vertical cut at 40 (kerf 2): left piece 40×50, right region 58×50 split horizontally at 20.
  const tree: TreeNode = {
    type: 'cut',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    direction: 'vertical',
    position: 40,
    kerf: 2,
    sequence: 0,
    first: { type: 'piece', x: 0, y: 0, w: 40, h: 50, pieceId: 'a', rotated: false },
    second: {
      type: 'cut',
      x: 42,
      y: 0,
      w: 58,
      h: 50,
      direction: 'horizontal',
      position: 20,
      kerf: 2,
      sequence: 0,
      first: { type: 'piece', x: 42, y: 0, w: 58, h: 20, pieceId: 'b', rotated: false },
      second: { type: 'offcut', x: 42, y: 22, w: 58, h: 28 },
    },
  };

  it('numbers cuts depth-first', () => {
    expect(numberCuts(tree)).toBe(2);
    expect(collectCuts(tree).map((c) => c.direction)).toEqual(['vertical', 'horizontal']);
  });

  it('collects pieces and remnants', () => {
    expect(collectPieces(tree)).toHaveLength(2);
    expect(collectRemnants(tree)).toHaveLength(1);
  });

  it('closes the area accounting: pieces + kerf + waste + offcut = sheet', () => {
    const stats = computeSheetStats(tree, 100, 50, { x: 0, y: 0, w: 100, h: 50 });
    expect(stats.pieceArea).toBe(40 * 50 + 58 * 20);
    expect(stats.kerfArea).toBe(2 * 50 + 2 * 58);
    expect(stats.offcutArea).toBe(58 * 28);
    expect(stats.pieceArea + stats.kerfArea + stats.wasteArea + stats.offcutArea).toBe(stats.sheetArea);
  });

  it('counts the edge trim as waste', () => {
    const stats = computeSheetStats(tree, 104, 54, { x: 2, y: 2, w: 100, h: 50 });
    expect(stats.trimArea).toBe(104 * 54 - 100 * 50);
    expect(stats.pieceArea + stats.kerfArea + stats.wasteArea + stats.offcutArea).toBe(stats.sheetArea);
  });
});

describe('isReusable', () => {
  it('is rotation agnostic', () => {
    expect(isReusable(50, 200, 100, 40)).toBe(true);
    expect(isReusable(30, 200, 100, 40)).toBe(false);
    expect(isReusable(200, 50, 40, 100)).toBe(true);
  });
});
