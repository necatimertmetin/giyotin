import {
  DEFAULT_SETTINGS,
  optimize,
  validatePlan,
  type CuttingSettings,
  type OptimizationInput,
  type OptimizationResult,
  type PieceSpec,
  type StockSpec,
} from '../src/engine';

export const piece = (
  id: string,
  width: number,
  height: number,
  quantity: number,
  over: Partial<PieceSpec> = {},
): PieceSpec => ({
  id,
  name: id,
  width,
  height,
  quantity,
  allowRotation: true,
  materialKey: null,
  grain: 'any',
  ...over,
});

export const stock = (
  id: string,
  width: number,
  height: number,
  quantity: number,
  over: Partial<StockSpec> = {},
): StockSpec => ({
  id,
  name: id,
  width,
  height,
  quantity,
  unitCost: null,
  allowRotation: true,
  grain: 'none',
  materialKey: 'kuse135',
  kind: 'sheet',
  ...over,
});

export const settings = (over: Partial<CuttingSettings> = {}): CuttingSettings => ({
  ...DEFAULT_SETTINGS,
  kerf: 0,
  minOffcutWidth: 10,
  minOffcutHeight: 10,
  maxRuntimeMs: 20000,
  ...over,
});

export const input = (
  pieces: PieceSpec[],
  stocks: StockSpec[],
  over: Partial<CuttingSettings> = {},
): OptimizationInput => ({ pieces, stocks, settings: settings(over) });

/** Optimise and assert that every returned plan passes the independent validator. */
export function solve(inp: OptimizationInput): OptimizationResult {
  const result = optimize(inp);
  for (const plan of result.plans) {
    const errors = validatePlan(plan, inp);
    if (errors.length > 0) throw new Error(`Invalid plan ${plan.id}:\n${errors.join('\n')}`);
  }
  return result;
}
