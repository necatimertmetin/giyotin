import { describe, expect, it } from 'vitest';
import { summaryOf } from '../src/client/components/PdfExportDialog';
import { buildPieceInfo } from '../src/client/components/viewerTypes';
import { input, piece, solve, stock } from './helpers';

const int = (s: string): number => Number(s.replace(/\./g, ''));

describe('print summary', () => {
  const inp = input([piece('a', 100, 150, 30), piece('b', 120, 170, 50)], [stock('s', 500, 700, 100)]);
  const plan = solve(inp).plans[0]!;
  const s = summaryOf({ plan, pieces: buildPieceInfo(inp.pieces, new Map()), title: 'Sipariş' });

  it('lists every layout with its sheets, and one block per layout', () => {
    const [layouts, ...rest] = s.tables;
    expect(layouts!.rows).toHaveLength(plan.sheets.length + 1);
    expect(int(layouts!.rows.at(-1)![3]!)).toBe(plan.totals.sheetCount);
    expect(rest).toHaveLength(plan.sheets.length + 1);
  });

  it('per layout counts times sheets add up to what is cut of each product', () => {
    const cut = new Map<string, number>();
    plan.sheets.forEach((_, i) => {
      for (const r of s.tables[1 + i]!.rows) cut.set(r[1]!, (cut.get(r[1]!) ?? 0) + int(r[4]!));
    });
    const order = s.tables.at(-1)!;
    for (const r of order.rows) expect(cut.get(r[1]!)).toBe(int(r[4]!));
    expect(order.rows.map((r) => r[1])).toEqual(['a', 'b']);
  });
});
