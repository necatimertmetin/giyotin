import { describe, expect, it } from 'vitest';
import { PAPER_PRESETS } from '../src/shared/presets';

const find = (name: string) => PAPER_PRESETS.find((p) => p.name === name);

describe('paper presets', () => {
  it('contains A0–A10 and B0–B10 with ISO sizes', () => {
    expect(PAPER_PRESETS.filter((p) => p.group === 'ISO A')).toHaveLength(11);
    expect(PAPER_PRESETS.filter((p) => p.group === 'ISO B')).toHaveLength(11);
    expect([find('A4')?.width, find('A4')?.height]).toEqual([210, 297]);
    expect([find('A0')?.width, find('A0')?.height]).toEqual([841, 1189]);
    expect([find('A10')?.width, find('A10')?.height]).toEqual([26, 37]);
    expect([find('B0')?.width, find('B0')?.height]).toEqual([1000, 1414]);
    expect([find('B10')?.width, find('B10')?.height]).toEqual([31, 44]);
  });

  it('contains the North American formats in millimetres', () => {
    expect([find('US Letter')?.width, find('US Letter')?.height]).toEqual([215.9, 279.4]);
    expect([find('US Legal')?.width, find('US Legal')?.height]).toEqual([215.9, 355.6]);
    expect([find('US Tabloid / Ledger')?.width, find('US Tabloid / Ledger')?.height]).toEqual([279.4, 431.8]);
    expect([find('US Executive')?.width, find('US Executive')?.height]).toEqual([184.15, 266.7]);
  });

  it('each ISO series is a consecutive halving (width of N+1 ≈ height of N / 2)', () => {
    for (const group of ['ISO A', 'ISO B'] as const) {
      const list = PAPER_PRESETS.filter((p) => p.group === group);
      for (let i = 0; i < list.length - 1; i++) {
        expect(Math.abs(list[i + 1]!.height - list[i]!.width)).toBeLessThanOrEqual(1);
      }
    }
  });
});
