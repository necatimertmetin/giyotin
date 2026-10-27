import {
  allowedOrientations,
  collectCuts,
  collectPieces,
  computeSheetStats,
  cutGeometry,
  isReusable,
  toUnits,
  type Rect,
} from './geometry';
import { edgeMarginsOf, type OptimizationInput, type Plan, type SheetPlan, type TreeNode } from './types';

const eq = (a: number, b: number): boolean => toUnits(a) === toUnits(b);
const near = (a: number, b: number, tol = 0.01): boolean => Math.abs(a - b) <= tol;

const rectOf = (n: Rect): string => `(${n.x}, ${n.y}, ${n.w}×${n.h})`;

/**
 * Independent verification of a plan against the input it was built for. It re-derives every
 * geometric invariant from the tree itself and returns a list of violations (empty = valid).
 */
export function validatePlan(plan: Plan, input: OptimizationInput): string[] {
  const errors: string[] = [];
  const { settings } = input;
  const stockById = new Map(input.stocks.map((s) => [s.id, s]));
  const pieceById = new Map(input.pieces.map((p) => [p.id, p]));
  const usedStock = new Map<string, number>();
  const placed = new Map<string, number>();

  plan.sheets.forEach((sheet, index) => {
    const tag = `sheet ${index + 1}`;
    const stock = stockById.get(sheet.stockId);
    if (!stock) {
      errors.push(`${tag}: unknown stock ${sheet.stockId}`);
      return;
    }
    if (!Number.isInteger(sheet.copies) || sheet.copies < 1) errors.push(`${tag}: invalid copies`);
    usedStock.set(stock.id, (usedStock.get(stock.id) ?? 0) + sheet.copies);
    if (!eq(sheet.width, stock.width) || !eq(sheet.height, stock.height)) {
      errors.push(`${tag}: sheet size differs from stock`);
    }
    const m = edgeMarginsOf(settings);
    const expectedUsable: Rect = { x: m.left, y: m.top, w: stock.width - m.left - m.right, h: stock.height - m.top - m.bottom };
    const u = sheet.usable;
    if (!eq(u.x, expectedUsable.x) || !eq(u.y, expectedUsable.y) || !eq(u.w, expectedUsable.w) || !eq(u.h, expectedUsable.h)) {
      errors.push(`${tag}: usable rectangle ${rectOf(u)} != expected ${rectOf(expectedUsable)}`);
    }

    checkNode(sheet.tree, u, stock.id, tag);
    checkSequence(sheet, tag);
    checkOverlap(sheet, tag);

    for (const p of collectPieces(sheet.tree)) {
      placed.set(p.pieceId, (placed.get(p.pieceId) ?? 0) + sheet.copies);
    }

    const stats = computeSheetStats(sheet.tree, sheet.width, sheet.height, u);
    const sum = stats.pieceArea + stats.kerfArea + stats.wasteArea + stats.offcutArea;
    if (!near(sum, stats.sheetArea, 0.001)) errors.push(`${tag}: area accounting does not close (${sum} vs ${stats.sheetArea})`);
    if (!near(stats.pieceArea, sheet.stats.pieceArea, 0.001) || stats.cuts !== sheet.stats.cuts) {
      errors.push(`${tag}: stored stats differ from the tree`);
    }
  });

  function checkNode(node: TreeNode, expected: Rect, stockId: string, tag: string): void {
    if (!eq(node.x, expected.x) || !eq(node.y, expected.y) || !eq(node.w, expected.w) || !eq(node.h, expected.h)) {
      errors.push(`${tag}: node ${rectOf(node)} does not match expected region ${rectOf(expected)}`);
      return;
    }
    if (node.w <= 0 || node.h <= 0) errors.push(`${tag}: empty region ${rectOf(node)}`);
    if (node.type === 'piece') {
      const piece = pieceById.get(node.pieceId);
      const stock = stockById.get(stockId);
      if (!piece || !stock) {
        errors.push(`${tag}: piece ${node.pieceId} not in demand`);
        return;
      }
      if (piece.materialKey !== null && piece.materialKey !== stock.materialKey) {
        errors.push(`${tag}: piece ${piece.name} placed on incompatible material`);
      }
      const ok = allowedOrientations(
        { w: piece.width, h: piece.height, allowRotation: piece.allowRotation, grain: piece.grain },
        stock,
      ).some((o) => o.rotated === node.rotated && eq(o.w, node.w) && eq(o.h, node.h));
      if (!ok) errors.push(`${tag}: piece ${piece.name} has a forbidden size/orientation ${rectOf(node)}`);
      return;
    }
    if (node.type === 'offcut') {
      if (!isReusable(node.w, node.h, settings.minOffcutWidth, settings.minOffcutHeight)) {
        errors.push(`${tag}: offcut ${rectOf(node)} is below the minimum reusable size`);
      }
      return;
    }
    if (node.type === 'waste') return;

    const extent = node.direction === 'vertical' ? node.w : node.h;
    if (!(toUnits(node.position) > 0 && toUnits(node.position) < toUnits(extent))) {
      errors.push(`${tag}: cut position ${node.position} outside region ${rectOf(node)}`);
      return;
    }
    const geo = cutGeometry(
      { x: toUnits(node.x), y: toUnits(node.y), w: toUnits(node.w), h: toUnits(node.h) },
      node.direction,
      toUnits(node.position),
      toUnits(settings.kerf),
    );
    if (toUnits(node.kerf) !== geo.kerf) errors.push(`${tag}: inconsistent kerf on cut #${node.sequence}`);
    const toMmRect = (r: Rect): Rect => ({ x: r.x / 100, y: r.y / 100, w: r.w / 100, h: r.h / 100 });
    checkNode(node.first, toMmRect(geo.first), stockId, tag);
    if (geo.second) {
      if (!node.second) errors.push(`${tag}: missing second region after cut #${node.sequence}`);
      else checkNode(node.second, toMmRect(geo.second), stockId, tag);
    } else if (node.second) {
      errors.push(`${tag}: cut #${node.sequence} has a second region although the kerf consumed it`);
    }
  }

  function checkSequence(sheet: SheetPlan, tag: string): void {
    const seqs = collectCuts(sheet.tree).map((c) => c.sequence);
    seqs.forEach((s, i) => {
      if (s !== i + 1) errors.push(`${tag}: cut sequence is not 1..n`);
    });
    const order: number[] = [];
    const visit = (n: TreeNode): void => {
      if (n.type !== 'cut') return;
      order.push(n.sequence);
      visit(n.first);
      if (n.second) visit(n.second);
    };
    visit(sheet.tree);
    if (order.some((s, i) => s !== i + 1)) errors.push(`${tag}: cuts are not numbered depth-first`);
  }

  function checkOverlap(sheet: SheetPlan, tag: string): void {
    const pieces = collectPieces(sheet.tree);
    const u = sheet.usable;
    for (const p of pieces) {
      if (toUnits(p.x) < toUnits(u.x) || toUnits(p.y) < toUnits(u.y) || toUnits(p.x + p.w) > toUnits(u.x + u.w) || toUnits(p.y + p.h) > toUnits(u.y + u.h)) {
        errors.push(`${tag}: piece ${rectOf(p)} leaves the usable sheet area`);
      }
    }
    if (pieces.length > 400) return;
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i]!;
        const b = pieces[j]!;
        if (toUnits(a.x) < toUnits(b.x + b.w) && toUnits(b.x) < toUnits(a.x + a.w) && toUnits(a.y) < toUnits(b.y + b.h) && toUnits(b.y) < toUnits(a.y + a.h)) {
          errors.push(`${tag}: pieces overlap ${rectOf(a)} / ${rectOf(b)}`);
        }
      }
    }
  }

  // Stock counts.
  for (const [id, n] of usedStock) {
    const stock = stockById.get(id);
    if (stock && n > stock.quantity) errors.push(`stock ${stock.name} used ${n}× but only ${stock.quantity} available`);
  }
  // Demand reconciliation.
  for (const piece of input.pieces) {
    const n = placed.get(piece.id) ?? 0;
    if (n > piece.quantity + (plan.overproduced?.[piece.id] ?? 0)) errors.push(`piece ${piece.name} placed ${n}× but only ${piece.quantity} demanded`);
    if ((plan.placed[piece.id] ?? 0) !== n) errors.push(`plan.placed mismatch for ${piece.name}`);
    const missing = plan.unfulfilled.find((u) => u.pieceId === piece.id)?.quantity ?? 0;
    if (missing !== Math.max(0, piece.quantity - n)) errors.push(`unfulfilled mismatch for ${piece.name}`);
  }
  if (plan.fulfilled !== (plan.unfulfilled.length === 0)) errors.push('fulfilled flag inconsistent');

  // Totals.
  let stockArea = 0;
  let pieceArea = 0;
  let cuts = 0;
  for (const s of plan.sheets) {
    stockArea += s.stats.sheetArea * s.copies;
    pieceArea += s.stats.pieceArea * s.copies;
    cuts += s.stats.cuts * s.copies;
  }
  if (!near(stockArea, plan.totals.stockArea, 0.01)) errors.push('totals.stockArea mismatch');
  if (!near(pieceArea, plan.totals.pieceArea, 0.01)) errors.push('totals.pieceArea mismatch');
  if (cuts !== plan.totals.cuts) errors.push('totals.cuts mismatch');
  return errors;
}
