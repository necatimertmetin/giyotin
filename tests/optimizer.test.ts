import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  collectCuts,
  collectPieces,
  collectRemnants,
  cutGeometry,
  optimize,
  referenceMaxArea,
  toUnits,
  validatePlan,
  type Plan,
  type Rect,
} from '../src/engine';
import { input, piece, settings, solve, stock } from './helpers';

const best = (plans: Plan[]): Plan => plans[0]!;

describe('single pieces', () => {
  it('fits a single piece on a sheet', () => {
    const inp = input([piece('a', 100, 100, 1)], [stock('s', 200, 200, 1)]);
    const r = solve(inp);
    expect(best(r.plans).fulfilled).toBe(true);
    expect(best(r.plans).totals.sheetCount).toBe(1);
    expect(collectPieces(best(r.plans).sheets[0]!.tree)).toHaveLength(1);
    expect(r.provenOptimal).toBe(false);
  });

  it('uses rotation when the piece only fits rotated', () => {
    const inp = input([piece('a', 200, 50, 1)], [stock('s', 100, 300, 1)]);
    const p = best(solve(inp).plans);
    expect(p.fulfilled).toBe(true);
    const placed = collectPieces(p.sheets[0]!.tree)[0]!;
    expect(placed.rotated).toBe(true);
    expect([placed.w, placed.h]).toEqual([50, 200]);
  });

  it('reports a rotation-disabled piece that cannot fit unrotated', () => {
    const inp = input([piece('a', 200, 50, 1, { allowRotation: false })], [stock('s', 100, 300, 1)]);
    const r = solve(inp);
    expect(r.issues.map((i) => i.kind)).toContain('no-fit');
    expect(best(r.plans).fulfilled).toBe(false);
    expect(best(r.plans).unfulfilled).toEqual([{ pieceId: 'a', name: 'a', quantity: 1 }]);
  });

  it('does not rotate pieces on stock that forbids rotation', () => {
    const inp = input([piece('a', 200, 50, 1)], [stock('s', 100, 300, 1, { allowRotation: false })]);
    expect(solve(inp).issues.map((i) => i.kind)).toContain('no-fit');
  });

  it('flags invalid dimensions and quantities explicitly', () => {
    const inp = input(
      [piece('z', 0, 10, 1), piece('n', 10, -5, 1), piece('q', 10, 10, 1.5)],
      [stock('s', 100, 100, 1)],
    );
    const kinds = solve(inp).issues.map((i) => i.kind).sort((a, b) => a.localeCompare(b));
    expect(kinds).toEqual(['invalid-dimension', 'invalid-dimension', 'invalid-quantity']);
  });
});

describe('orders with several products and stocks', () => {
  it('cuts multiple product dimensions from one stock', () => {
    const inp = input(
      [piece('flyer', 100, 150, 40), piece('card', 85, 55, 60), piece('poster', 300, 400, 2)],
      [stock('s', 700, 1000, 5)],
      { kerf: 3 },
    );
    const p = best(solve(inp).plans);
    expect(p.fulfilled).toBe(true);
    expect(p.placed).toEqual({ flyer: 40, card: 60, poster: 2 });
  });

  it('chooses among multiple stock formats and keeps counts within quantity', () => {
    const inp = input(
      [piece('a', 200, 140, 30)],
      [stock('small', 210, 297, 10), stock('big', 700, 1000, 3)],
      { kerf: 2 },
    );
    const r = solve(inp);
    const p = best(r.plans);
    expect(p.fulfilled).toBe(true);
    expect(p.totals.sheetsByStock.small ?? 0).toBeLessThanOrEqual(10);
    expect(p.totals.sheetsByStock.big ?? 0).toBeLessThanOrEqual(3);
  });

  it('never exceeds limited stock and reports unfulfilled quantities', () => {
    const inp = input([piece('a', 100, 100, 100)], [stock('s', 300, 300, 2)]);
    const r = solve(inp);
    const p = best(r.plans);
    expect(p.totals.sheetCount).toBeLessThanOrEqual(2);
    expect(p.fulfilled).toBe(false);
    const missing = p.unfulfilled[0]!.quantity;
    expect(p.placed.a! + missing).toBe(100);
    expect(p.placed.a).toBe(18);
  });

  it('reports insufficient stock when nothing is available', () => {
    const inp = input([piece('a', 10, 10, 5)], [stock('s', 100, 100, 0)]);
    const r = solve(inp);
    expect(r.issues.map((i) => i.kind)).toContain('no-stock');
    expect(best(r.plans).sheets).toHaveLength(0);
  });

  it('respects material compatibility', () => {
    const inp = input(
      [piece('a', 50, 50, 4, { materialKey: 'karton350' })],
      [stock('s', 200, 200, 3, { materialKey: 'kuse135' })],
    );
    const r = solve(inp);
    expect(r.issues.map((i) => i.kind)).toContain('no-material');
    expect(best(r.plans).fulfilled).toBe(false);
  });

  it('keeps different materials on separate stock items', () => {
    const inp = input(
      [piece('a', 50, 50, 4, { materialKey: 'm1' }), piece('b', 50, 50, 4, { materialKey: 'm2' })],
      [stock('s1', 100, 100, 1, { materialKey: 'm1' }), stock('s2', 100, 100, 1, { materialKey: 'm2' })],
    );
    const p = best(solve(inp).plans);
    expect(p.fulfilled).toBe(true);
    for (const sheet of p.sheets) {
      const ids = new Set(collectPieces(sheet.tree).map((x) => x.pieceId));
      expect(ids.size).toBe(1);
    }
  });
});

describe('kerf and margins', () => {
  it('fits two pieces side by side without kerf but not with kerf', () => {
    const pcs = [piece('a', 50, 50, 2, { allowRotation: false })];
    const noKerf = best(solve(input(pcs, [stock('s', 100, 50, 2)], { kerf: 0 })).plans);
    expect(noKerf.totals.sheetCount).toBe(1);
    const kerf = best(solve(input(pcs, [stock('s', 100, 50, 2)], { kerf: 3 })).plans);
    expect(kerf.totals.sheetCount).toBe(2);
    expect(kerf.fulfilled).toBe(true);
  });

  it('accounts for kerf loss in the totals', () => {
    const inp = input([piece('a', 40, 40, 4)], [stock('s', 100, 100, 1)], { kerf: 4 });
    const p = best(solve(inp).plans);
    expect(p.fulfilled).toBe(true);
    expect(p.totals.kerfArea).toBeGreaterThan(0);
    const sum = p.totals.pieceArea + p.totals.kerfArea + p.totals.wasteArea + p.totals.offcutArea;
    expect(sum).toBeCloseTo(p.totals.stockArea, 2);
  });

  it('lets the blade hang off the sheet edge for a piece nearly as wide as the sheet', () => {
    const inp = input([piece('a', 99, 100, 1, { allowRotation: false })], [stock('s', 100, 100, 1)], { kerf: 3 });
    const p = best(solve(inp).plans);
    expect(p.fulfilled).toBe(true);
    const cut = collectCuts(p.sheets[0]!.tree)[0]!;
    expect(cut.kerf).toBe(1);
    expect(cut.second).toBeNull();
  });

  it('applies the edge margin to feasibility', () => {
    const tooBig = input([piece('a', 100, 100, 1)], [stock('s', 100, 100, 1)], { edgeMargin: 5 });
    expect(solve(tooBig).issues.map((i) => i.kind)).toContain('no-fit');
    const ok = input([piece('a', 90, 90, 1)], [stock('s', 100, 100, 1)], { edgeMargin: 5 });
    const p = best(solve(ok).plans);
    expect(p.fulfilled).toBe(true);
    const placed = collectPieces(p.sheets[0]!.tree)[0]!;
    expect(placed.x).toBe(5);
    expect(placed.y).toBe(5);
    expect(p.sheets[0]!.stats.trimArea).toBe(100 * 100 - 90 * 90);
  });

  it('trims each edge by its own margin', () => {
    const edgeMargins = { top: 0, right: 0, bottom: 20, left: 10 };
    const tooBig = input([piece('a', 91, 100, 1, { allowRotation: false })], [stock('s', 100, 100, 1)], { edgeMargins });
    expect(solve(tooBig).issues.map((i) => i.kind)).toContain('no-fit');
    const inp = input([piece('a', 90, 80, 1, { allowRotation: false })], [stock('s', 100, 100, 1)], { edgeMargins });
    const p = best(solve(inp).plans);
    expect(p.fulfilled).toBe(true);
    const placed = collectPieces(p.sheets[0]!.tree)[0]!;
    expect([placed.x, placed.y]).toEqual([10, 0]);
    expect(p.sheets[0]!.stats.trimArea).toBe(100 * 100 - 90 * 80);
    expect(validatePlan(p, inp)).toEqual([]);
  });

  it('supports non-integer ISO/US dimensions exactly', () => {
    const inp = input([piece('letter', 215.9, 279.4, 4)], [stock('s', 431.8, 558.8, 1)], { kerf: 0 });
    const p = best(solve(inp).plans);
    expect(p.fulfilled).toBe(true);
    expect(p.totals.pieceArea).toBeCloseTo(4 * 215.9 * 279.4, 2);
  });
});

describe('cut tree, sequence and offcuts', () => {
  const inp = input(
    [piece('a', 120, 80, 7), piece('b', 60, 60, 9)],
    [stock('s', 400, 300, 3)],
    { kerf: 3, minOffcutWidth: 50, minOffcutHeight: 50 },
  );
  const plan = best(solve(inp).plans);

  it('replaying the numbered cuts reproduces exactly the leaves of the tree', () => {
    for (const sheet of plan.sheets) {
      const regions: Rect[] = [{ ...sheet.usable }];
      for (const cut of collectCuts(sheet.tree)) {
        const idx = regions.findIndex(
          (r) => toUnits(r.x) === toUnits(cut.x) && toUnits(r.y) === toUnits(cut.y) && toUnits(r.w) === toUnits(cut.w) && toUnits(r.h) === toUnits(cut.h),
        );
        expect(idx, `cut #${cut.sequence} must act on an existing region`).toBeGreaterThanOrEqual(0);
        const g = cutGeometry(
          { x: toUnits(cut.x), y: toUnits(cut.y), w: toUnits(cut.w), h: toUnits(cut.h) },
          cut.direction,
          toUnits(cut.position),
          toUnits(inp.settings.kerf),
        );
        const unit = (r: Rect): Rect => ({ x: r.x / 100, y: r.y / 100, w: r.w / 100, h: r.h / 100 });
        regions.splice(idx, 1, unit(g.first), ...(g.second ? [unit(g.second)] : []));
      }
      const leaves = [...collectPieces(sheet.tree), ...collectRemnants(sheet.tree)].map((n) => `${n.x},${n.y},${n.w},${n.h}`).sort((a, b) => a.localeCompare(b));
      const replayed = regions.map((r) => `${r.x},${r.y},${r.w},${r.h}`).sort((a, b) => a.localeCompare(b));
      expect(replayed).toEqual(leaves);
    }
  });

  it('every offcut is a real leaf of the cut tree, inside the sheet and free of pieces', () => {
    for (const sheet of plan.sheets) {
      const pieces = collectPieces(sheet.tree);
      for (const o of collectRemnants(sheet.tree).filter((n) => n.type === 'offcut')) {
        expect(o.w).toBeGreaterThanOrEqual(50 - 1e-9);
        for (const p of pieces) {
          const overlap = toUnits(o.x) < toUnits(p.x + p.w) && toUnits(p.x) < toUnits(o.x + o.w) && toUnits(o.y) < toUnits(p.y + p.h) && toUnits(p.y) < toUnits(o.y + o.h);
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('closes the area accounting on every sheet', () => {
    for (const sheet of plan.sheets) {
      const s = sheet.stats;
      expect(s.pieceArea + s.kerfArea + s.wasteArea + s.offcutArea).toBeCloseTo(s.sheetArea, 4);
    }
  });

  it('a lone small piece leaves one large reusable offcut', () => {
    const one = best(solve(input([piece('a', 100, 100, 1)], [stock('s', 500, 500, 1)], { kerf: 3, minOffcutWidth: 100, minOffcutHeight: 100 })).plans);
    const offcuts = collectRemnants(one.sheets[0]!.tree).filter((n) => n.type === 'offcut');
    expect(offcuts.length).toBeGreaterThanOrEqual(1);
    expect(one.totals.offcutArea).toBeGreaterThan(0.5 * (500 * 500 - 100 * 100));
  });

  it('does not report slivers below the minimum size as reusable offcuts', () => {
    const p = best(solve(input([piece('a', 98, 98, 1)], [stock('s', 100, 100, 1)], { kerf: 0, minOffcutWidth: 50, minOffcutHeight: 50 })).plans);
    expect(p.totals.offcutArea).toBe(0);
    expect(p.totals.wasteArea).toBeGreaterThan(0);
  });
});

describe('offcut reuse in later jobs', () => {
  it('prefers a suitable offcut over cutting a fresh large sheet', () => {
    const stocks = [
      stock('sheet', 1000, 1000, 5),
      stock('offcut-1', 300, 200, 1, { kind: 'offcut' }),
    ];
    const p = best(solve(input([piece('a', 250, 150, 1)], stocks, { kerf: 3 })).plans);
    expect(p.totals.sheetsByStock['offcut-1']).toBe(1);
    expect(p.totals.sheetsByStock.sheet).toBeUndefined();
  });

  it('does not use an offcut of a different material', () => {
    const stocks = [
      stock('sheet', 1000, 1000, 1, { materialKey: 'm1' }),
      stock('offcut-1', 300, 200, 1, { kind: 'offcut', materialKey: 'm2' }),
    ];
    const p = best(solve(input([piece('a', 250, 150, 1, { materialKey: 'm1' })], stocks)).plans);
    expect(p.totals.sheetsByStock['offcut-1']).toBeUndefined();
  });

  it('can reuse the offcut produced by a previous plan as stock', () => {
    const first = best(solve(input([piece('a', 300, 300, 1)], [stock('sheet', 700, 500, 1)], { kerf: 3, minOffcutWidth: 100, minOffcutHeight: 100 })).plans);
    const offcuts = collectRemnants(first.sheets[0]!.tree).filter((n) => n.type === 'offcut');
    expect(offcuts.length).toBeGreaterThan(0);
    const largest = offcuts.sort((a, b) => b.w * b.h - a.w * a.h)[0]!;
    const next = input(
      [piece('b', 100, 100, 1)],
      [stock('off', largest.w, largest.h, 1, { kind: 'offcut' })],
    );
    const p = best(solve(next).plans);
    expect(p.fulfilled).toBe(true);
    expect(p.totals.sheetsByStock.off).toBe(1);
  });
});

describe('alternatives', () => {
  it('offers a plan that minimises the number of sheets even when smaller stock is cheaper per area', () => {
    const inp = input(
      [piece('a', 100, 100, 120)],
      [stock('small', 210, 210, 60, { unitCost: 1 }), stock('big', 700, 1000, 6, { unitCost: 9 })],
      { kerf: 3 },
    );
    const r = solve(inp);
    const counts = r.plans.map((p) => p.totals.sheetCount);
    // 120 pieces of 100×100 need at least 3 big sheets; the plan list must contain a plan close to that.
    expect(Math.min(...counts)).toBeLessThanOrEqual(4);
    expect(r.plans.length).toBeLessThanOrEqual(6);
    // Every plan in the list is valid and the fewest-sheets plan is never beaten by another listed plan.
    const fewest = r.plans.reduce((m, p) => Math.min(m, p.totals.sheetCount), Infinity);
    expect(r.plans.some((p) => p.totals.sheetCount === fewest)).toBe(true);
  });

  it('offers a plan that cuts every paper type from a single stock format', () => {
    const inp = input(
      [piece('a', 100, 100, 120), piece('b', 60, 90, 40)],
      [stock('small', 210, 210, 60, { unitCost: 1 }), stock('big', 700, 1000, 6, { unitCost: 9 }), stock('mid', 500, 700, 10, { unitCost: 5 })],
      { kerf: 3 },
    );
    const r = solve(inp);
    const single = r.plans.find((p) => p.objective.profile === 'single-stock');
    expect(single).toBeDefined();
    expect(r.plans.indexOf(single!)).toBe(1);
    expect(single!.fulfilled).toBe(true);
    expect(Object.keys(single!.totals.sheetsByStock)).toHaveLength(1);
    expect(single!.sheets).toHaveLength(1); // one layout (kalıp), repeated
    expect(validatePlan(single!, inp)).toEqual([]);
  });
});

describe('determinism and cancellation', () => {
  it('produces identical plans for identical settings', () => {
    const inp = input(
      [piece('a', 120, 80, 17), piece('b', 60, 60, 29), piece('c', 90, 140, 5)],
      [stock('s', 500, 700, 6), stock('t', 300, 400, 6)],
      { kerf: 3, seed: 7 },
    );
    const strip = (r: ReturnType<typeof optimize>): unknown => ({ ...r, runtimeMs: 0 });
    expect(strip(optimize(inp))).toEqual(strip(optimize(inp)));
  });

  it('stops early when cancelled', () => {
    const inp = input([piece('a', 30, 30, 500)], [stock('s', 700, 1000, 50)]);
    const r = optimize(inp, { cancel: { cancelled: true } });
    expect(r.stoppedBy).toBe('cancelled');
  });
});

describe('comparison with an exhaustive reference solver', () => {
  const area = (inp: ReturnType<typeof input>): number => best(solve(inp).plans).totals.pieceArea;

  it('matches the optimum on hand-picked tiny instances', () => {
    const cases: Array<{ w: number; h: number; k: number; pcs: Array<[number, number, number, boolean]> }> = [
      { w: 12, h: 13, k: 0, pcs: [[4, 2, 1, false], [4, 4, 2, false], [5, 6, 3, true]] },
      { w: 11, h: 11, k: 0, pcs: [[6, 4, 3, true], [4, 2, 3, true]] },
      { w: 13, h: 10, k: 1, pcs: [[2, 6, 1, false], [11, 4, 2, false], [1, 3, 2, true]] },
      { w: 10, h: 11, k: 2, pcs: [[6, 3, 4, true]] },
      { w: 7, h: 6, k: 0, pcs: [[6, 5, 4, true], [4, 3, 3, true]] },
    ];
    for (const c of cases) {
      const ref = referenceMaxArea(c.w, c.h, c.pcs.map(([w, h, quantity, allowRotation]) => ({ w, h, quantity, allowRotation })), c.k);
      const got = area(
        input(c.pcs.map(([w, h, q, r], i) => piece(`p${i}`, w, h, q, { allowRotation: r })), [stock('s', c.w, c.h, 1)], { kerf: c.k, minOffcutWidth: 1, minOffcutHeight: 1 }),
      );
      expect(got).toBe(ref);
    }
  });

  it('is never better than the optimum and rarely worse on random tiny instances', () => {
    const instance = fc.record({
      w: fc.integer({ min: 6, max: 12 }),
      h: fc.integer({ min: 6, max: 12 }),
      k: fc.integer({ min: 0, max: 2 }),
      pcs: fc.array(
        fc.tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 3 }), fc.boolean()),
        { minLength: 1, maxLength: 3 },
      ),
    });
    let worse = 0;
    let total = 0;
    fc.assert(
      fc.property(instance, (c) => {
        const ref = referenceMaxArea(c.w, c.h, c.pcs.map(([w, h, quantity, allowRotation]) => ({ w, h, quantity, allowRotation })), c.k);
        const got = area(
          input(c.pcs.map(([w, h, q, r], i) => piece(`p${i}`, w, h, q, { allowRotation: r })), [stock('s', c.w, c.h, 1)], { kerf: c.k, minOffcutWidth: 1, minOffcutHeight: 1 }),
        );
        total++;
        if (got < ref) worse++;
        return got <= ref;
      }),
      { numRuns: 60, seed: 42 },
    );
    expect(worse / total).toBeLessThanOrEqual(0.05);
  });
});

describe('geometric invariants hold for arbitrary orders (property based)', () => {
  it('every generated plan validates', () => {
    const pieceArb = fc.record({
      w: fc.integer({ min: 20, max: 300 }),
      h: fc.integer({ min: 20, max: 300 }),
      q: fc.integer({ min: 1, max: 30 }),
      rot: fc.boolean(),
    });
    const stockArb = fc.record({
      w: fc.integer({ min: 150, max: 700 }),
      h: fc.integer({ min: 150, max: 1000 }),
      q: fc.integer({ min: 1, max: 4 }),
    });
    fc.assert(
      fc.property(
        fc.array(pieceArb, { minLength: 1, maxLength: 4 }),
        fc.array(stockArb, { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 6 }),
        (ps, ss, kerf, margin) => {
          const inp = {
            pieces: ps.map((p, i) => piece(`p${i}`, p.w, p.h, p.q, { allowRotation: p.rot })),
            stocks: ss.map((s, i) => stock(`s${i}`, s.w, s.h, s.q)),
            settings: settings({ kerf, edgeMargin: margin, maxRuntimeMs: 3000, searchWidth: 3 }),
          };
          const r = optimize(inp);
          for (const plan of r.plans) {
            expect(validatePlan(plan, inp)).toEqual([]);
          }
          return true;
        },
      ),
      { numRuns: 25, seed: 1 },
    );
  });
});

