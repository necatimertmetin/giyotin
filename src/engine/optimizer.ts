import {
  allowedOrientations,
  computeSheetStats,
  isReusable,
  scaleTree,
  toUnits,
  UNIT,
  type Orientation,
  type Rect,
} from './geometry';
import {
  budgetExhausted,
  searchSheet,
  type SearchBudget,
  type SheetPattern,
  type SheetSearchConfig,
} from './sheetSearch';
import { edgeMarginsOf } from './types';
import type {
  CuttingSettings,
  OptimizationInput,
  OptimizationResult,
  OptimizeOptions,
  Plan,
  PlanTotals,
  PreflightIssue,
  SheetPlan,
} from './types';

// ---------------------------------------------------------------------------------------------
// Objective
// ---------------------------------------------------------------------------------------------

/**
 * Objective profiles. A plan's score (lower is better, in mm² of "effective material") is
 *
 *   (1 − cw) · (stockArea − offcutCredit · reusableOffcutArea) + cw · cost · areaPerCost + cutWeight · cuts
 *   + 1000 · unfulfilledArea
 *
 * The last term makes completing the order dominate everything else. `cw` is the cost weight
 * (settings.costWeight unless the profile forces it) and only has an effect when stock costs are known;
 * `areaPerCost` converts currency into mm² so both terms are commensurable.
 */
export interface Profile {
  id: string;
  /** Fraction (0..1) of a reusable offcut's area that is not counted as consumed. */
  offcutCredit: number;
  /** Penalty (mm²) per cut. */
  cutWeight: number;
  /** Forces the cost weight; undefined = use settings.costWeight. */
  costWeight?: number;
  requiresCosts?: boolean;
  /** Penalty (mm²) per stock item used; a huge value makes "fewest sheets" the dominant goal. */
  sheetWeight?: number;
}

export const PROFILES: Profile[] = [
  { id: 'balanced', offcutCredit: 0.6, cutWeight: 100 },
  { id: 'min-material', offcutCredit: 0, cutWeight: 10 },
  { id: 'min-cost', offcutCredit: 0.5, cutWeight: 50, costWeight: 1, requiresCosts: true },
  { id: 'max-offcut', offcutCredit: 0.95, cutWeight: 50 },
  { id: 'min-cuts', offcutCredit: 0.3, cutWeight: 20000 },
  { id: 'min-sheets', offcutCredit: 0.3, cutWeight: 50, sheetWeight: 5_000_000 },
];

const UNFULFILLED_PENALTY = 1000;
/** Plans with 1…MAX_LAYOUTS different cutting layouts ("kalıp") are offered. */
const MAX_LAYOUTS = 3;
const UNIT2 = UNIT * UNIT;

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

interface StockCtx {
  index: number;
  id: string;
  usable: Rect;
  areaMm: number;
  cost: number;
  hasCost: boolean;
}

interface Ctx {
  input: OptimizationInput;
  settings: CuttingSettings;
  kerf: number;
  stocks: StockCtx[];
  /** orientations[stock][piece]; empty when the piece cannot be cut from that stock. */
  orientations: Orientation[][][];
  pieceAreaMm: number[];
  pieceIds: string[];
  /** Demand that can be attempted at all (0 for unplaceable pieces). */
  initialRem: number[];
  areaPerCost: number;
  anyCost: boolean;
  cache: Map<string, SheetPattern[]>;
  innerWidth: number;
  classify: (w: number, h: number) => 'offcut' | 'waste';
  rootRatio: number;
  /** capacity[stock][piece]: upper bound on how many copies of a piece fit on one sheet of the stock. */
  capacity: number[][];
}

interface Group {
  stock: number;
  pattern: SheetPattern;
  copies: number;
}

interface OuterState {
  rem: number[];
  left: number[];
  groups: Group[];
  g: number;
  f: number;
}

// ---------------------------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------------------------

/** The blade length in mm, or Infinity when unlimited. */
const bladeOf = (s: CuttingSettings): number => (s.bladeLength !== undefined && s.bladeLength > 0 ? s.bladeLength : Number.POSITIVE_INFINITY);

/** A stock item can only be cut apart if the blade spans one of its two (trimmed) sides. */
function cuttable(settings: CuttingSettings, s: { width: number; height: number }): boolean {
  const m = edgeMarginsOf(settings);
  return Math.min(s.width - m.left - m.right, s.height - m.top - m.bottom) <= bladeOf(settings);
}

function preflight(input: OptimizationInput): { issues: PreflightIssue[]; placeable: boolean[] } {
  const issues: PreflightIssue[] = [];
  const m = edgeMarginsOf(input.settings);
  const placeable = input.pieces.map((piece) => {
    const valid = Number.isFinite(piece.width) && Number.isFinite(piece.height) && piece.width > 0 && piece.height > 0;
    if (!valid) {
      issues.push({ pieceId: piece.id, kind: 'invalid-dimension', message: `${piece.name}: dimensions must be positive` });
      return false;
    }
    if (!Number.isInteger(piece.quantity) || piece.quantity < 0) {
      issues.push({ pieceId: piece.id, kind: 'invalid-quantity', message: `${piece.name}: quantity must be a non-negative integer` });
      return false;
    }
    if (piece.quantity === 0) return false;
    const materialMatches = input.stocks.filter((s) => s.quantity > 0 && (piece.materialKey === null || piece.materialKey === s.materialKey));
    if (materialMatches.length === 0) {
      issues.push({
        pieceId: piece.id,
        kind: piece.materialKey === null ? 'no-stock' : 'no-material',
        message: `${piece.name}: no stock available for this material`,
      });
      return false;
    }
    const cuttableMatches = materialMatches.filter((s) => cuttable(input.settings, s));
    if (cuttableMatches.length === 0) {
      issues.push({ pieceId: piece.id, kind: 'blade-length', message: `${piece.name}: the blade is shorter than both sides of every eligible stock item` });
      return false;
    }
    const fitsSomewhere = cuttableMatches.some((s) =>
      allowedOrientations(
        { w: piece.width, h: piece.height, allowRotation: piece.allowRotation, grain: piece.grain },
        s,
      ).some((o) => toUnits(o.w) <= toUnits(s.width - m.left - m.right) && toUnits(o.h) <= toUnits(s.height - m.top - m.bottom)),
    );
    if (!fitsSomewhere) {
      issues.push({ pieceId: piece.id, kind: 'no-fit', message: `${piece.name}: larger than every eligible stock item` });
      return false;
    }
    return true;
  });
  return { issues, placeable };
}

// ---------------------------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------------------------

const costWeightOf = (ctx: Ctx, prof: Profile): number => {
  if (!ctx.anyCost) return 0;
  return prof.costWeight ?? ctx.settings.costWeight;
};

function sheetMetric(ctx: Ctx, stock: StockCtx, pattern: SheetPattern, prof: Profile): number {
  const cw = costWeightOf(ctx, prof);
  const material = stock.areaMm - prof.offcutCredit * (pattern.offcutArea / UNIT2);
  return (1 - cw) * material + cw * stock.cost * ctx.areaPerCost + prof.cutWeight * pattern.cuts + (prof.sheetWeight ?? 0);
}

const remArea = (ctx: Ctx, rem: number[]): number => {
  let a = 0;
  rem.forEach((r, i) => {
    a += r * (ctx.pieceAreaMm[i] ?? 0);
  });
  return a;
};

const finalScore = (ctx: Ctx, s: OuterState): number => s.g + UNFULFILLED_PENALTY * remArea(ctx, s.rem);

const hashKey = (key: string, seed: number): number => {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

// ---------------------------------------------------------------------------------------------
// Inner (single sheet) search with memoisation
// ---------------------------------------------------------------------------------------------

function sheetPatterns(
  ctx: Ctx,
  stockIdx: number,
  rem: number[],
  budget: SearchBudget,
  width = ctx.innerWidth,
  maxResults = 12,
): SheetPattern[] {
  // Demand beyond what one sheet can hold is irrelevant for a single-sheet pattern; capping it lets the
  // cache be shared between outer states that only differ in large remaining quantities.
  const capped = rem.map((r, i) => Math.min(r, ctx.capacity[stockIdx]![i] ?? 0));
  const key = `${stockIdx}|${width}|${capped.join(',')}`;
  const hit = ctx.cache.get(key);
  if (hit) return hit;
  rem = capped;
  const stock = ctx.stocks[stockIdx]!;
  const orientations = ctx.orientations[stockIdx]!.map((o, i) => ((rem[i] ?? 0) > 0 ? o : []));
  const cfg: SheetSearchConfig = {
    usable: stock.usable,
    kerf: ctx.kerf,
    orientations,
    pieceIds: ctx.pieceIds,
    remaining: rem,
    beamWidth: width,
    bladeLength: Number.isFinite(bladeOf(ctx.settings)) ? toUnits(bladeOf(ctx.settings)) : undefined,
    classify: ctx.classify,
  };
  const patterns = searchSheet(cfg, budget, maxResults).filter((p) => p.pieceArea > 0);
  if (budget.stopped === 'completed') ctx.cache.set(key, patterns);
  return patterns;
}

const ratioOf = (ctx: Ctx, stock: StockCtx, p: SheetPattern, prof: Profile): number =>
  sheetMetric(ctx, stock, p, prof) / (p.pieceArea / UNIT2);

function rankedPatterns(ctx: Ctx, stockIdx: number, rem: number[], prof: Profile, budget: SearchBudget, k: number): SheetPattern[] {
  const stock = ctx.stocks[stockIdx]!;
  const all = sheetPatterns(ctx, stockIdx, rem, budget);
  return all
    .map((p) => ({ p, r: ratioOf(ctx, stock, p, prof) }))
    .sort((a, b) => a.r - b.r || a.p.cuts - b.p.cuts)
    .slice(0, k)
    .map((x) => x.p);
}

// ---------------------------------------------------------------------------------------------
// Outer (multi-sheet) beam search
// ---------------------------------------------------------------------------------------------

function applyGroup(ctx: Ctx, s: OuterState, stockIdx: number, pattern: SheetPattern, copies: number, prof: Profile): OuterState {
  const rem = s.rem.map((r, i) => r - copies * (pattern.counts[i] ?? 0));
  const left = s.left.slice();
  left[stockIdx] = (left[stockIdx] ?? 0) - copies;
  const g = s.g + copies * sheetMetric(ctx, ctx.stocks[stockIdx]!, pattern, prof);
  return {
    rem,
    left,
    groups: [...s.groups, { stock: stockIdx, pattern, copies }],
    g,
    f: g + remArea(ctx, rem) * ctx.rootRatio,
  };
}

function expandOuter(ctx: Ctx, s: OuterState, prof: Profile, budget: SearchBudget, topK: number): OuterState[] {
  if (remArea(ctx, s.rem) === 0) return [];
  const out: OuterState[] = [];
  for (const stock of ctx.stocks) {
    if ((s.left[stock.index] ?? 0) <= 0) continue;
    const orient = ctx.orientations[stock.index]!;
    const usable = s.rem.some((r, i) => r > 0 && (orient[i]?.length ?? 0) > 0);
    if (!usable) continue;
    for (const pattern of rankedPatterns(ctx, stock.index, s.rem, prof, budget, topK)) {
      let mFull = s.left[stock.index] ?? 0;
      pattern.counts.forEach((c, i) => {
        if (c > 0) mFull = Math.min(mFull, Math.floor((s.rem[i] ?? 0) / c));
      });
      if (mFull < 1) continue;
      const options = new Set<number>([mFull]);
      if (mFull >= 2) options.add(mFull - 1);
      for (const m of options) out.push(applyGroup(ctx, s, stock.index, pattern, m, prof));
    }
  }
  return out;
}

function stateKey(s: OuterState): string {
  return `${s.rem.join(',')}|${s.left.join(',')}`;
}

function runOuter(
  ctx: Ctx,
  start: OuterState,
  width: number,
  prof: Profile,
  budget: SearchBudget,
  topK = 3,
): OuterState[] {
  let beam: OuterState[] = [start];
  const done: OuterState[] = [];
  const seed = ctx.settings.seed;
  while (beam.length > 0) {
    if (budgetExhausted(budget)) {
      done.push(...beam);
      break;
    }
    const seen = new Map<string, OuterState>();
    for (const s of beam) {
      const children = expandOuter(ctx, s, prof, budget, topK);
      if (children.length === 0) {
        done.push(s);
        continue;
      }
      for (const c of children) {
        const k = stateKey(c);
        const prev = seen.get(k);
        if (!prev || c.g < prev.g) seen.set(k, c);
      }
    }
    beam = [...seen.entries()]
      .sort(([ka, a], [kb, b]) => a.f - b.f || hashKey(ka, seed) - hashKey(kb, seed))
      .slice(0, width)
      .map(([, s]) => s);
  }
  return done.sort((a, b) => finalScore(ctx, a) - finalScore(ctx, b));
}

// ---------------------------------------------------------------------------------------------
// Local improvement
// ---------------------------------------------------------------------------------------------

function restart(ctx: Ctx, groups: Group[], prof: Profile): OuterState {
  let s: OuterState = {
    rem: ctx.initialRem.slice(),
    left: ctx.input.stocks.map((st) => st.quantity),
    groups: [],
    g: 0,
    f: 0,
  };
  s.f = remArea(ctx, s.rem) * ctx.rootRatio;
  for (const grp of groups) s = applyGroup(ctx, s, grp.stock, grp.pattern, grp.copies, prof);
  return s;
}

function improve(ctx: Ctx, best: OuterState, prof: Profile, budget: SearchBudget, width: number): OuterState {
  let current = best;

  // (1) Replace a sheet's cutting tree by a better one for exactly the same pieces.
  const groups = current.groups.map((grp) => ({ ...grp }));
  groups.slice(0, 8).forEach((grp, gi) => {
    if (budgetExhausted(budget)) return;
    const stock = ctx.stocks[grp.stock]!;
    const alternatives = sheetPatterns(ctx, grp.stock, grp.pattern.counts, budget, ctx.innerWidth * 2, 16);
    const same = alternatives.filter((p) => p.counts.every((c, i) => c === grp.pattern.counts[i]));
    for (const p of same) {
      if (sheetMetric(ctx, stock, p, prof) < sheetMetric(ctx, stock, grp.pattern, prof) - 1e-9) {
        groups[gi] = { ...grp, pattern: p };
        grp.pattern = p;
      }
    }
  });
  const retreed = restart(ctx, groups, prof);
  if (finalScore(ctx, retreed) < finalScore(ctx, current)) current = retreed;

  // (2) Re-optimise the tail of the plan: undo the last j sheet groups and search again with a wider beam.
  const maxTail = Math.min(3, current.groups.length);
  for (let j = 1; j <= maxTail; j++) {
    if (budgetExhausted(budget)) break;
    const start = restart(ctx, current.groups.slice(0, current.groups.length - j), prof);
    const results = runOuter(ctx, start, width * 2, prof, budget, 5);
    const candidate = results[0];
    if (candidate && finalScore(ctx, candidate) < finalScore(ctx, current) - 1e-9) current = candidate;
  }
  return current;
}

// ---------------------------------------------------------------------------------------------
// Plan assembly
// ---------------------------------------------------------------------------------------------

function buildPlan(ctx: Ctx, state: OuterState, prof: Profile): Plan {
  const { input } = ctx;
  const built: SheetPlan[] = state.groups.map((grp) => {
    const stockSpec = input.stocks[grp.stock]!;
    const stock = ctx.stocks[grp.stock]!;
    const tree = scaleTree(grp.pattern.tree, 1 / UNIT);
    const usable = {
      x: stock.usable.x / UNIT,
      y: stock.usable.y / UNIT,
      w: stock.usable.w / UNIT,
      h: stock.usable.h / UNIT,
    };
    return {
      stockId: stockSpec.id,
      stockName: stockSpec.name,
      copies: grp.copies,
      width: stockSpec.width,
      height: stockSpec.height,
      tree,
      usable,
      stats: computeSheetStats(tree, stockSpec.width, stockSpec.height, usable),
    };
  });

  // Identical cutting layouts on the same stock are one entry with more copies, however the search found them.
  const merged = new Map<string, SheetPlan>();
  for (const sh of built) {
    const key = `${sh.stockId}|${JSON.stringify(sh.tree)}`;
    const prev = merged.get(key);
    if (prev) prev.copies += sh.copies;
    else merged.set(key, { ...sh });
  }
  const sheets = [...merged.values()];

  const placed: Record<string, number> = {};
  for (const piece of input.pieces) placed[piece.id] = 0;
  for (const grp of state.groups) {
    grp.pattern.counts.forEach((c, i) => {
      const id = ctx.pieceIds[i]!;
      placed[id] = (placed[id] ?? 0) + c * grp.copies;
    });
  }
  const unfulfilled = input.pieces
    .filter((p) => (placed[p.id] ?? 0) < p.quantity)
    .map((p) => ({ pieceId: p.id, name: p.name, quantity: p.quantity - (placed[p.id] ?? 0) }));
  /* Only the single-layout plan cuts more than demanded; ordinary plans never do. */
  const overproduced: Record<string, number> = {};
  for (const p of input.pieces) if ((placed[p.id] ?? 0) > p.quantity) overproduced[p.id] = (placed[p.id] ?? 0) - p.quantity;

  const totals: PlanTotals = {
    stockArea: 0,
    pieceArea: 0,
    kerfArea: 0,
    wasteArea: 0,
    offcutArea: 0,
    cuts: 0,
    sheetCount: 0,
    cost: null,
    utilization: 0,
    sheetsByStock: {},
  };
  for (const sh of sheets) {
    totals.stockArea += sh.stats.sheetArea * sh.copies;
    totals.pieceArea += sh.stats.pieceArea * sh.copies;
    totals.kerfArea += sh.stats.kerfArea * sh.copies;
    totals.wasteArea += sh.stats.wasteArea * sh.copies;
    totals.offcutArea += sh.stats.offcutArea * sh.copies;
    totals.cuts += sh.stats.cuts * sh.copies;
    totals.sheetCount += sh.copies;
    totals.sheetsByStock[sh.stockId] = (totals.sheetsByStock[sh.stockId] ?? 0) + sh.copies;
    const spec = input.stocks.find((s) => s.id === sh.stockId);
    if (spec && spec.unitCost !== null) totals.cost = (totals.cost ?? 0) + spec.unitCost * sh.copies;
  }
  totals.utilization = totals.stockArea > 0 ? totals.pieceArea / totals.stockArea : 0;
  const round = (v: number): number => Math.round(v * 100) / 100;
  totals.stockArea = round(totals.stockArea);
  totals.pieceArea = round(totals.pieceArea);
  totals.kerfArea = round(totals.kerfArea);
  totals.wasteArea = round(totals.wasteArea);
  totals.offcutArea = round(totals.offcutArea);
  if (totals.cost !== null) totals.cost = round(totals.cost);

  return {
    id: `plan-${prof.id}`,
    label: prof.id,
    description: prof.id,
    sheets,
    totals,
    placed,
    unfulfilled,
    fulfilled: unfulfilled.length === 0,
    ...(Object.keys(overproduced).length > 0 ? { overproduced } : {}),
    objective: { profile: prof.id, score: finalScore(ctx, state) },
  };
}

/**
 * Sets of stock indices that together use one stock format per paper type (material key). Stock that no
 * piece can be cut from is ignored; the number of combinations is capped to keep the search affordable.
 */
function singleStockCombos(ctx: Ctx, cap = 12): Array<Set<number>> {
  const byMaterial = new Map<string, number[]>();
  ctx.stocks.forEach((st) => {
    const usable = ctx.orientations[st.index]!.some((o, i) => o.length > 0 && (ctx.initialRem[i] ?? 0) > 0);
    if (!usable) return;
    const key = ctx.input.stocks[st.index]!.materialKey;
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), st.index]);
  });
  let combos: number[][] = [[]];
  for (const options of byMaterial.values()) combos = combos.flatMap((c) => options.map((j) => [...c, j]));
  return combos.slice(0, cap).map((c) => new Set(c));
}

/** One layout covering all remaining demand of `pieces` on stock `j`, repeated m times (fewest m that works). */
function singleLayout(ctx: Ctx, j: number, pieces: number[], demand: number[], maxCopies: number, budget: SearchBudget): Group | null {
  const stock = ctx.stocks[j]!;
  const usableArea = (stock.usable.w * stock.usable.h) / UNIT2;
  const demandArea = pieces.reduce((a, i) => a + (demand[i] ?? 0) * (ctx.pieceAreaMm[i] ?? 0), 0);
  const mLow = Math.max(1, Math.ceil(demandArea / usableArea));
  const mHigh = Math.min(maxCopies, mLow + 40);
  for (let m = mLow; m <= mHigh; m++) {
    if (budgetExhausted(budget)) return null;
    const rem = demand.map((r, i) => (pieces.includes(i) ? Math.ceil(r / m) : 0));
    const need = pieces.reduce((a, i) => a + (rem[i] ?? 0) * (ctx.pieceAreaMm[i] ?? 0), 0);
    if (need > usableArea) continue;
    const fits = sheetPatterns(ctx, j, rem, budget).filter((p) => pieces.every((i) => (p.counts[i] ?? 0) >= (rem[i] ?? 0)));
    const pattern = fits.sort((x, y) => x.cuts - y.cuts)[0];
    if (pattern) return { stock: j, pattern, copies: m };
  }
  return null;
}

/** Covers everything still missing in `s` with one repeated layout per stock (overproduction allowed). */
function completeWithLayouts(ctx: Ctx, s: OuterState, allowed: Set<number>, prof: Profile, budget: SearchBudget): OuterState | null {
  if (remArea(ctx, s.rem) === 0) return s;
  const assigned = new Map<number, number[]>();
  for (let i = 0; i < s.rem.length; i++) {
    if ((s.rem[i] ?? 0) <= 0) continue;
    const j = [...allowed].find((k) => (ctx.orientations[k]![i]?.length ?? 0) > 0 && (s.left[k] ?? 0) > 0);
    if (j === undefined) return null;
    assigned.set(j, [...(assigned.get(j) ?? []), i]);
  }
  let state = s;
  for (const [j, pieces] of assigned) {
    const g = singleLayout(ctx, j, pieces, s.rem, s.left[j] ?? 0, budget);
    if (!g) return null;
    state = applyGroup(ctx, state, g.stock, g.pattern, g.copies, prof);
  }
  return { ...state, rem: state.rem.map((r) => Math.max(0, r)) };
}

const layoutKey = (g: Group): string => `${g.stock}|${g.pattern.counts.join(',')}|${g.pattern.cuts}|${g.pattern.offcutArea}|${g.pattern.wasteArea}`;
const layoutCount = (s: OuterState): number => new Set(s.groups.map(layoutKey)).size;

/**
 * Best plan state that needs at most k different layouts ("kalıp"), for k = 1…maxK. Every paper type is cut
 * from one stock format; the first layouts are searched with the beam search, the last one is a repeated layout
 * that covers whatever is left over (so a few pieces may be overproduced).
 */
function layoutStates(ctx: Ctx, combos: Array<Set<number>>, budget: SearchBudget, from: number, slice: number, width: number, maxK: number): Map<number, OuterState> {
  const prof = PROFILES[0]!;
  const best = new Map<number, { state: OuterState; score: number }>();
  combos.forEach((allowed, c) => {
    if (budget.stopped === 'cancelled') return;
    const sub: SearchBudget = { ...budget, stopped: 'completed', deadline: from + slice * ((c + 1) / combos.length) };
    const restricted: Ctx = { ...ctx, orientations: ctx.orientations.map((o, j) => (allowed.has(j) ? o : o.map(() => []))) };
    let beam: OuterState[] = [restart(restricted, [], prof)];
    for (let depth = 0; depth < maxK && beam.length > 0 && !budgetExhausted(sub); depth++) {
      for (const s of beam) {
        const done = completeWithLayouts(restricted, s, allowed, prof, sub);
        if (!done) continue;
        const k = layoutCount(done);
        const score = finalScore(restricted, done);
        for (let kk = k; kk <= maxK; kk++) {
          const prev = best.get(kk);
          if (!prev || score < prev.score) best.set(kk, { state: done, score });
        }
      }
      if (depth === maxK - 1) break;
      const seen = new Map<string, OuterState>();
      for (const s of beam) for (const child of expandOuter(restricted, s, prof, sub, 3)) seen.set(stateKey(child), child);
      beam = [...seen.values()].sort((x, y) => x.f - y.f).slice(0, width);
    }
    budget.nodes += sub.nodes;
    if (sub.stopped === 'cancelled') budget.stopped = 'cancelled';
  });
  return new Map([...best].map(([k, v]) => [k, v.state]));
}

function planScore(ctx: Ctx, plan: Plan, prof: Profile): number {
  const cw = costWeightOf(ctx, prof);
  const material = plan.totals.stockArea - prof.offcutCredit * plan.totals.offcutArea;
  const costTerm = (plan.totals.cost ?? 0) * ctx.areaPerCost;
  let missing = 0;
  for (const u of plan.unfulfilled) {
    const i = ctx.pieceIds.indexOf(u.pieceId);
    missing += u.quantity * (ctx.pieceAreaMm[i] ?? 0);
  }
  return (1 - cw) * material + cw * costTerm + prof.cutWeight * plan.totals.cuts + (prof.sheetWeight ?? 0) * plan.totals.sheetCount + UNFULFILLED_PENALTY * missing;
}

const planSignature = (p: Plan): string =>
  p.sheets
    .map((s) => `${s.stockId}x${s.copies}:${s.stats.pieceCount}:${s.stats.cuts}:${s.stats.offcutArea}:${s.stats.wasteArea}`)
    .join('|');

// ---------------------------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------------------------

export function optimize(input: OptimizationInput, options: OptimizeOptions = {}): OptimizationResult {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const { settings } = input;
  const { issues, placeable } = preflight(input);

  const kerf = toUnits(settings.kerf);
  const margin = edgeMarginsOf(settings);
  const minW = toUnits(settings.minOffcutWidth);
  const minH = toUnits(settings.minOffcutHeight);

  const stocks: StockCtx[] = input.stocks.map((s, index) => {
    const usable: Rect = {
      x: toUnits(margin.left),
      y: toUnits(margin.top),
      w: toUnits(s.width - margin.left - margin.right),
      h: toUnits(s.height - margin.top - margin.bottom),
    };
    return {
      index,
      id: s.id,
      usable,
      areaMm: (toUnits(s.width) * toUnits(s.height)) / UNIT2,
      cost: s.unitCost ?? 0,
      hasCost: s.unitCost !== null,
    };
  });

  const orientations: Orientation[][][] = input.stocks.map((s, j) => {
    const usable = stocks[j]!.usable;
    const valid = s.quantity > 0 && usable.w > 0 && usable.h > 0 && cuttable(settings, s);
    return input.pieces.map((p, i) => {
      if (!valid || !placeable[i]) return [];
      if (p.materialKey !== null && p.materialKey !== s.materialKey) return [];
      return allowedOrientations(
        { w: toUnits(p.width), h: toUnits(p.height), allowRotation: p.allowRotation, grain: p.grain },
        s,
      ).filter((o) => o.w <= usable.w && o.h <= usable.h);
    });
  });

  const costed = stocks.filter((s) => s.hasCost && s.cost > 0);
  const areaPerCost = costed.length > 0 ? costed.reduce((a, s) => a + s.areaMm, 0) / costed.reduce((a, s) => a + s.cost, 0) : 1;

  const ctx: Ctx = {
    input,
    settings,
    kerf,
    stocks,
    orientations,
    // Piece areas as seen by the grid (rounded to 1/100 mm).
    pieceAreaMm: input.pieces.map((p) => (toUnits(p.width) * toUnits(p.height)) / UNIT2),
    pieceIds: input.pieces.map((p) => p.id),
    initialRem: input.pieces.map((p, i) => (placeable[i] ? p.quantity : 0)),
    areaPerCost,
    anyCost: costed.length > 0,
    cache: new Map(),
    innerWidth: Math.max(2, Math.round(settings.searchWidth * 2)),
    classify: (w, h) => (isReusable(w, h, minW, minH) ? 'offcut' : 'waste'),
    rootRatio: 1,
    capacity: [],
  };
  // Area bound: no sheet can hold more copies of a piece than its area allows.
  ctx.capacity = orientations.map((perPiece, j) => {
    const u = stocks[j]!.usable;
    return perPiece.map((list) => {
      const o = list[0];
      return o ? Math.floor((u.w * u.h) / (o.w * o.h)) : 0;
    });
  });

  const cancel = options.cancel;
  const profiles = PROFILES.filter((p) => !p.requiresCosts || ctx.anyCost);
  const totalMs = Math.max(200, settings.maxRuntimeMs);
  const budget: SearchBudget = {
    nodes: 0,
    maxNodes: Number.POSITIVE_INFINITY,
    deadline: started + totalMs,
    now,
    cancelled: () => cancel?.cancelled === true,
    stopped: 'completed',
  };

  const candidates: Plan[] = [];
  let layouts = new Map<number, OuterState>();
  const hasWork = ctx.initialRem.some((r) => r > 0);
  if (hasWork) {
    const width = Math.max(2, Math.ceil(settings.searchWidth / 2));
    // Estimate the best achievable material ratio once, for the outer heuristic.
    const baseProf = profiles[0]!;
    let ratio = Number.POSITIVE_INFINITY;
    for (const st of stocks) {
      if (!ctx.orientations[st.index]!.some((o) => o.length > 0)) continue;
      for (const p of sheetPatterns(ctx, st.index, ctx.initialRem, budget).slice(0, 4)) {
        ratio = Math.min(ratio, ratioOf(ctx, st, p, baseProf));
      }
    }
    ctx.rootRatio = Number.isFinite(ratio) ? Math.max(1, ratio * 0.9) : 1;

    // One extra slot for the "single stock type" plans, searched after all profiles.
    const slots = profiles.length + 1;
    profiles.forEach((prof, k) => {
      if (budget.stopped !== 'completed' && candidates.length > 0) return;
      const sliceEnd = started + (totalMs * (k + 1)) / slots;
      const sub: SearchBudget = { ...budget, deadline: sliceEnd };
      const start = restart(ctx, [], prof);
      const finished = runOuter(ctx, start, width, prof, sub);
      const top = finished[0];
      if (top) candidates.push(buildPlan(ctx, improve(ctx, top, prof, sub, width), prof));
      for (const extra of finished.slice(1, 3)) candidates.push(buildPlan(ctx, extra, prof));
      budget.nodes += sub.nodes;
      if (sub.stopped === 'cancelled') budget.stopped = 'cancelled';
      else if (sub.stopped === 'timeLimit' && now() > budget.deadline) budget.stopped = 'timeLimit';
    });

    // "Kalıp" plans: one stock format per paper type, cut with at most 1, 2 or 3 different layouts.
    if (budget.stopped !== 'cancelled') {
      const base = started + (totalMs * profiles.length) / slots;
      layouts = layoutStates(ctx, singleStockCombos(ctx), budget, Math.max(now(), base), totalMs / slots, width, MAX_LAYOUTS);
    }
  }

  // Deduplicate equivalent plans and rank them by the balanced objective.
  const unique = new Map<string, Plan>();
  for (const plan of candidates) {
    const sig = planSignature(plan);
    const prev = unique.get(sig);
    if (!prev || plan.objective.score < prev.objective.score) unique.set(sig, plan);
  }
  const balanced = profiles[0]!;
  const scored = [...unique.values()].map((plan) => ({ ...plan, objective: { profile: plan.objective.profile, score: planScore(ctx, plan, balanced) } }));
  scored.sort((x, y) => x.objective.score - y.objective.score);
  const fulfilledFirst = scored.some((p) => p.fulfilled) ? scored.filter((p) => p.fulfilled) : scored;

  // The list: the recommended plan, the cheapest paper cost, then the 1 / 2 / 3 layout plans. A plan that is
  // several of these at once is listed once and carries all its tags.
  const ranked: Plan[] = [];
  const addPlan = (plan: Plan | undefined, tag: string | null): void => {
    if (!plan) return;
    const sig = planSignature(plan);
    const existing = ranked.find((r) => planSignature(r) === sig);
    if (existing) {
      if (tag && !existing.tags?.includes(tag)) existing.tags = [...(existing.tags ?? []), tag];
    } else ranked.push({ ...plan, tags: tag ? [tag] : [] });
  };
  const cheapKey = (p: Plan): number => (p.totals.cost !== null ? p.totals.cost : p.totals.stockArea);
  for (let k = 1; k <= MAX_LAYOUTS; k++) {
    const state = layouts.get(k);
    if (!state) continue;
    const plan = buildPlan(ctx, state, balanced);
    if (!plan.fulfilled && fulfilledFirst.some((p) => p.fulfilled)) continue;
    // Listed under its real layout count (a search for "3" may find a plan with fewer).
    addPlan(plan, `layouts-${plan.sheets.length}`);
  }
  // The recommended plan is the first one: the fewest layouts that work (1, else 2, else 3). Without any layout
  // plan the balanced plan is recommended. The balanced plan otherwise goes last.
  if (ranked.length === 0) addPlan(fulfilledFirst[0], 'balanced');
  addPlan([...fulfilledFirst].sort((x, y) => cheapKey(x) - cheapKey(y) || x.objective.score - y.objective.score)[0], 'cheapest');
  addPlan(fulfilledFirst[0], 'balanced');
  const plans = ranked.map((plan, i) => ({ ...plan, id: `plan-${i + 1}`, label: plan.objective.profile }));

  // A plan with no sheets (nothing placeable) is still reported so the UI can show the issues.
  if (plans.length === 0) {
    plans.push(buildPlan(ctx, restart(ctx, [], PROFILES[0]!), PROFILES[0]!));
  }

  return {
    plans,
    issues,
    runtimeMs: Math.round(now() - started),
    nodesExplored: budget.nodes,
    stoppedBy: budget.stopped,
    provenOptimal: false,
  };
}
