/**
 * Exhaustive reference solver for TINY single-sheet instances (integer dimensions).
 *
 * It explores every guillotine cut position and every split of the demand between the two sides, so
 * the returned value is the true maximum piece area obtainable from one sheet. It exists only to
 * validate the heuristic engine in tests; its running time explodes with instance size.
 */
export interface ReferencePiece {
  w: number;
  h: number;
  quantity: number;
  allowRotation: boolean;
}

export function referenceMaxArea(
  sheetW: number,
  sheetH: number,
  pieces: ReferencePiece[],
  kerf: number,
): number {
  const shapes = pieces.map((p) => {
    const list = [{ w: p.w, h: p.h }];
    if (p.allowRotation && p.w !== p.h) list.push({ w: p.h, h: p.w });
    return list;
  });
  const memo = new Map<string, number>();

  const best = (w: number, h: number, demand: number[]): number => {
    if (w <= 0 || h <= 0) return 0;
    const key = `${w},${h},${demand.join(',')}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let value = 0;
    demand.forEach((d, i) => {
      if (d <= 0) return;
      for (const s of shapes[i]!) if (s.w === w && s.h === h) value = Math.max(value, w * h);
    });
    for (const direction of ['v', 'h'] as const) {
      const extent = direction === 'v' ? w : h;
      for (let p = 1; p < extent; p++) {
        const rest = extent - p;
        const second = rest - Math.min(kerf, rest);
        const a = direction === 'v' ? [p, h] : [w, p];
        const b = direction === 'v' ? [second, h] : [w, second];
        if (second <= 0) {
          value = Math.max(value, best(a[0]!, a[1]!, demand));
          continue;
        }
        forEachSplit(demand, (d1, d2) => {
          value = Math.max(value, best(a[0]!, a[1]!, d1) + best(b[0]!, b[1]!, d2));
        });
      }
    }
    memo.set(key, value);
    return value;
  };

  return best(sheetW, sheetH, pieces.map((p) => p.quantity));
}

function forEachSplit(demand: number[], visit: (a: number[], b: number[]) => void): void {
  const a = new Array<number>(demand.length).fill(0);
  const rec = (i: number): void => {
    if (i === demand.length) {
      visit(a.slice(), demand.map((d, k) => d - a[k]!));
      return;
    }
    for (let v = 0; v <= demand[i]!; v++) {
      a[i] = v;
      rec(i + 1);
    }
  };
  rec(0);
}
