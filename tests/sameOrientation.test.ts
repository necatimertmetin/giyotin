import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { collectPieces, type OptimizationInput, type Plan } from '../src/engine';
import { input, piece, solve, stock } from './helpers';

/** Placed widths per size (either way round) on every sheet of the plan. */
function widthsBySize(plan: Plan, inp: OptimizationInput): Array<Map<string, Set<number>>> {
  const spec = new Map(inp.pieces.map((p) => [p.id, p]));
  return plan.sheets.map((sheet) => {
    const m = new Map<string, Set<number>>();
    for (const n of collectPieces(sheet.tree)) {
      const p = spec.get(n.pieceId)!;
      const key = `${Math.min(p.width, p.height)}x${Math.max(p.width, p.height)}`;
      m.set(key, (m.get(key) ?? new Set()).add(n.w));
    }
    return m;
  });
}
const mixed = (plan: Plan, inp: OptimizationInput): boolean =>
  widthsBySize(plan, inp).some((m) => [...m.values()].some((ws) => ws.size > 1));

describe('same orientation', () => {
  const pieces = [piece('a', 30, 20, 11)];
  const sheets = [stock('s', 100, 70, 5)];

  it('without the option the best plan turns some copies to fit more', () => {
    const inp = input(pieces, sheets);
    expect(mixed(solve(inp).plans[0]!, inp)).toBe(true);
  });

  it('with the option no sheet mixes turned and upright copies', () => {
    const inp = input(pieces, sheets, { sameOrientation: true });
    const r = solve(inp);
    expect(r.plans.length).toBeGreaterThan(0);
    for (const plan of r.plans) {
      expect(plan.fulfilled).toBe(true);
      expect(mixed(plan, inp)).toBe(false);
    }
  });

  it('treats different products of the same size as one group, whichever way they are declared', () => {
    const inp = input([piece('a', 30, 20, 6), piece('b', 20, 30, 5)], sheets, { sameOrientation: true });
    for (const plan of solve(inp).plans) expect(mixed(plan, inp)).toBe(false);
  });

  it('holds for random orders', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ w: fc.integer({ min: 10, max: 60 }), h: fc.integer({ min: 10, max: 60 }), q: fc.integer({ min: 1, max: 12 }) }), { minLength: 1, maxLength: 4 }),
        (rows) => {
          const inp = input(rows.map((r, i) => piece(`p${i}`, r.w, r.h, r.q)), [stock('s', 120, 90, 30)], { sameOrientation: true, maxRuntimeMs: 1500 });
          for (const plan of solve(inp).plans) expect(mixed(plan, inp)).toBe(false);
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('layout ("kalıp") plans', () => {
  // A real order: 1000 flyers and 2000 samples on A0. Fewer sheets beat fewer cuts.
  const order = (sameOrientation: boolean): OptimizationInput =>
    input([piece('flyer', 100, 150, 1000), piece('ornek', 123, 175, 2000)], [stock('a0', 841, 1189, 10000)], {
      kerf: 3,
      edgeMargin: 5,
      edgeMargins: { top: 0, right: 5, bottom: 0, left: 0 },
      bladeLength: 870,
      minOffcutWidth: 100,
      minOffcutHeight: 100,
      maxRuntimeMs: 8000,
      searchWidth: 6,
      sameOrientation,
    });
  const oneLayout = (inp: OptimizationInput): Plan => solve(inp).plans.find((p) => p.tags?.includes('layouts-1'))!;

  it('a single layout uses the fewest sheets, not the fewest cuts', () => {
    expect(oneLayout(order(false)).totals.sheetCount).toBeLessThanOrEqual(63);
  });

  it('also with the same-direction option', () => {
    const inp = order(true);
    const plan = oneLayout(inp);
    expect(plan.totals.sheetCount).toBeLessThanOrEqual(72);
    expect(mixed(plan, inp)).toBe(false);
  });
});

describe('layout plans with several paper types', () => {
  // Every paper is its own material, so all four land in one plan; the first one in the list fills badly when the
  // pieces must face one way. The layout plans must still be offered, on the paper that needs the least.
  const papers = [
    stock('41x57', 570, 410, 100000, { materialKey: 'a' }),
    stock('45x64', 450, 640, 100000, { materialKey: 'b' }),
    stock('50x70', 500, 700, 100000, { materialKey: 'c' }),
    stock('a0', 841, 1189, 10000, { materialKey: 'd' }),
  ];
  const order = (sameOrientation: boolean): OptimizationInput =>
    input([piece('flyer', 100, 150, 1000), piece('ornek', 123, 175, 2000)], papers, {
      kerf: 3,
      edgeMargin: 5,
      edgeMargins: { top: 0, right: 5, bottom: 0, left: 0 },
      bladeLength: 870,
      maxRuntimeMs: 8000,
      searchWidth: 6,
      sameOrientation,
    });

  it('offers a one-layout plan with the same-direction option', () => {
    const inp = order(true);
    const plans = solve(inp).plans;
    const one = plans.find((p) => p.tags?.includes('layouts-1'));
    expect(one).toBeDefined();
    expect(plans[0]).toBe(one);
    expect(mixed(one!, inp)).toBe(false);
  });

  it('never keeps a layout that another layout on the same paper covers', () => {
    for (const same of [false, true]) {
      for (const plan of solve(order(same)).plans) {
        const counts = plan.sheets.map((s) => {
          const c = new Map<string, number>();
          for (const n of collectPieces(s.tree)) c.set(n.pieceId, (c.get(n.pieceId) ?? 0) + 1);
          return { stock: s.stockId, c };
        });
        for (const a of counts)
          for (const b of counts)
            if (a !== b && a.stock === b.stock) expect([...a.c].every(([id, n]) => (b.c.get(id) ?? 0) >= n)).toBe(false);
      }
    }
  });
});
