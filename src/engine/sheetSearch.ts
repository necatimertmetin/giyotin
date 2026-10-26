import {
  cutGeometry,
  hasPiece,
  numberCuts,
  walk,
  type Orientation,
  type Rect,
} from './geometry';
import type { RemnantNode, TreeNode } from './types';

/**
 * Beam search that cuts ONE stock rectangle into pieces using guillotine cuts only.
 *
 * Everything here works on the integer grid (1/100 mm). A search state is a set of open rectangular
 * regions plus the remaining demand. Expanding a state takes the largest open region and either
 *
 *  - places a block of cx × cy identical pieces in its top-left corner and separates it with two cuts
 *    (vertical-first or horizontal-first), or
 *  - makes a "pure" guillotine cut through the region at a normal-pattern position,
 *
 * so every state corresponds to a valid recursive cutting tree by construction.
 */

export interface SearchBudget {
  nodes: number;
  maxNodes: number;
  deadline: number;
  now: () => number;
  cancelled: () => boolean;
  stopped: 'completed' | 'timeLimit' | 'cancelled';
}

export const budgetExhausted = (b: SearchBudget): boolean => {
  if (b.stopped !== 'completed') return true;
  if (b.cancelled()) {
    b.stopped = 'cancelled';
    return true;
  }
  if (b.now() > b.deadline) {
    b.stopped = 'timeLimit';
    return true;
  }
  return b.nodes >= b.maxNodes;
};

export interface SheetSearchConfig {
  /** Usable rectangle (after edge trim). */
  usable: Rect;
  kerf: number;
  /** Per global piece index: allowed orientations on this stock (empty = ineligible). */
  orientations: Orientation[][];
  pieceIds: string[];
  /** Remaining demand per global piece index. */
  remaining: number[];
  beamWidth: number;
  classify: (w: number, h: number) => 'offcut' | 'waste';
}

export interface SheetPattern {
  /** Tree in integer units, cuts already numbered. */
  tree: TreeNode;
  counts: number[];
  pieceArea: number;
  kerfArea: number;
  wasteArea: number;
  offcutArea: number;
  cuts: number;
}

interface PlaceDecision {
  op: 'place';
  region: Rect;
  index: number;
  w: number;
  h: number;
  rotated: boolean;
  cx: number;
  cy: number;
  variant: 'V' | 'H';
}
interface CutDecision {
  op: 'cut';
  region: Rect;
  direction: 'vertical' | 'horizontal';
  position: number;
}
type DecisionData = PlaceDecision | CutDecision;
interface Decision {
  prev: Decision | null;
  data: DecisionData;
}

interface State {
  regions: Rect[];
  rem: number[];
  placed: number;
  cuts: number;
  decisions: Decision | null;
  f: number;
}

const regionKey = (r: Rect): string => `${r.x},${r.y},${r.w},${r.h}`;

/** Sorted 1-D normal-pattern points: sums of piece extents separated by kerfs, up to `limit`. */
function normalPoints(dims: number[], limit: number, kerf: number, cap: number): number[] {
  const set = new Set<number>([0]);
  const list: number[] = [0];
  const uniq = [...new Set(dims)].filter((d) => d > 0 && d <= limit).sort((a, b) => a - b);
  for (let i = 0; i < list.length && list.length < cap; i++) {
    const p = list[i]!;
    for (const d of uniq) {
      const q = p === 0 ? d : p + kerf + d;
      if (q <= limit && !set.has(q)) {
        set.add(q);
        list.push(q);
        if (list.length >= cap) break;
      }
    }
  }
  return list.sort((a, b) => a - b);
}

function snapDown(points: number[], x: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]! <= x) {
      best = points[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

export function searchSheet(
  cfg: SheetSearchConfig,
  budget: SearchBudget,
  maxResults: number,
): SheetPattern[] {
  const { kerf, orientations, remaining } = cfg;
  const typeCount = orientations.length;

  const widths: number[] = [];
  const heights: number[] = [];
  for (let i = 0; i < typeCount; i++) {
    if ((remaining[i] ?? 0) <= 0) continue;
    for (const o of orientations[i]!) {
      widths.push(o.w);
      heights.push(o.h);
    }
  }
  if (widths.length === 0) return [];
  const nx = normalPoints(widths, cfg.usable.w, kerf, 400);
  const ny = normalPoints(heights, cfg.usable.h, kerf, 400);
  const pieceArea = (i: number): number => {
    const o = orientations[i]![0];
    return o ? o.w * o.h : 0;
  };

  const fits = (r: Rect, rem: number[]): boolean => {
    for (let i = 0; i < typeCount; i++) {
      if ((rem[i] ?? 0) <= 0) continue;
      for (const o of orientations[i]!) if (o.w <= r.w && o.h <= r.h) return true;
    }
    return false;
  };

  const demandArea = (rem: number[]): number => {
    let a = 0;
    for (let i = 0; i < typeCount; i++) a += (rem[i] ?? 0) * pieceArea(i);
    return a;
  };

  const estimate = (regions: Rect[]): number => {
    let e = 0;
    for (const r of regions) e += snapDown(nx, r.w) * snapDown(ny, r.h);
    return e;
  };

  const makeState = (
    regions: Rect[],
    rem: number[],
    placed: number,
    cuts: number,
    decisions: Decision | null,
  ): State => {
    const open = regions.filter((r) => fits(r, rem));
    const f = placed + Math.min(demandArea(rem), estimate(open));
    return { regions: open, rem, placed, cuts, decisions, f };
  };

  const stateKey = (s: State): string => {
    const keys = s.regions.map(regionKey).sort();
    return `${keys.join(';')}|${s.rem.join(',')}`;
  };

  const blockShapes = (region: Rect, o: Orientation, rem: number): Array<[number, number]> => {
    const cxMax = Math.floor((region.w + kerf) / (o.w + kerf));
    const cyMax = Math.floor((region.h + kerf) / (o.h + kerf));
    const cxA = Math.min(cxMax, rem);
    const cyA = Math.min(cyMax, Math.max(1, Math.floor(rem / cxA)));
    const cyB = Math.min(cyMax, rem);
    const cxB = Math.min(cxMax, Math.max(1, Math.floor(rem / cyB)));
    return cxA === cxB && cyA === cyB
      ? [[cxA, cyA]]
      : [
          [cxA, cyA],
          [cxB, cyB],
        ];
  };

  const expand = (s: State, out: State[], placeOnly = false): void => {
    // Largest open region first (ties: top-left).
    let ri = 0;
    for (let i = 1; i < s.regions.length; i++) {
      const a = s.regions[i]!;
      const b = s.regions[ri]!;
      const aa = a.w * a.h;
      const ba = b.w * b.h;
      if (aa > ba || (aa === ba && (a.y < b.y || (a.y === b.y && a.x < b.x)))) ri = i;
    }
    const region = s.regions[ri]!;
    const others = s.regions.filter((_, i) => i !== ri);

    // 1. Block placements.
    for (let i = 0; i < typeCount; i++) {
      const rem = s.rem[i] ?? 0;
      if (rem <= 0) continue;
      for (const o of orientations[i]!) {
        if (o.w > region.w || o.h > region.h) continue;
        const shapes = blockShapes(region, o, rem);
        for (const [cx, cy] of shapes) {
          const bw = cx * o.w + (cx - 1) * kerf;
          const bh = cy * o.h + (cy - 1) * kerf;
          const variants: Array<'V' | 'H'> = bw === region.w || bh === region.h ? ['V'] : ['V', 'H'];
          for (const variant of variants) {
            const children = placeChildren(region, bw, bh, variant, kerf);
            const nextRem = s.rem.slice();
            nextRem[i] = rem - cx * cy;
            const data: PlaceDecision = {
              op: 'place',
              region,
              index: i,
              w: o.w,
              h: o.h,
              rotated: o.rotated,
              cx,
              cy,
              variant,
            };
            const cuts = (bw < region.w ? 1 : 0) + (bh < region.h ? 1 : 0) + cx * cy - 1;
            out.push(
              makeState(
                [...others, ...children],
                nextRem,
                s.placed + cx * cy * o.w * o.h,
                s.cuts + cuts,
                { prev: s.decisions, data },
              ),
            );
            budget.nodes++;
          }
        }
      }
    }

    // 2. Pure guillotine cuts through the region at normal-pattern positions.
    if (placeOnly) return;
    for (const direction of ['vertical', 'horizontal'] as const) {
      const extent = direction === 'vertical' ? region.w : region.h;
      const points = direction === 'vertical' ? nx : ny;
      const scored: Array<{ p: number; slack: number }> = [];
      for (const p of points) {
        if (p <= 0 || p + kerf >= extent) continue;
        const rest = extent - p - kerf;
        scored.push({ p, slack: rest - snapDown(points, rest) });
      }
      scored.sort((a, b) => a.slack - b.slack || b.p - a.p);
      for (const { p } of scored.slice(0, 3)) {
        const geo = cutGeometry(region, direction, p, kerf);
        if (!geo.second || !fits(geo.first, s.rem) || !fits(geo.second, s.rem)) continue;
        out.push(
          makeState([...others, geo.first, geo.second], s.rem, s.placed, s.cuts + 1, {
            prev: s.decisions,
            data: { op: 'cut', region, direction, position: p },
          }),
        );
        budget.nodes++;
      }
    }
  };

  // Greedy completion of a state: repeatedly take the most promising block placement. The completed
  // state is a real, valid pattern, so its value is an achievable lower bound for the state.
  const rollout = (s: State): State => {
    let { regions, rem, placed, cuts, decisions } = s;
    while (regions.length > 0) {
      let ri = 0;
      for (let i = 1; i < regions.length; i++) {
        const a = regions[i]!;
        const b = regions[ri]!;
        const aa = a.w * a.h;
        const ba = b.w * b.h;
        if (aa > ba || (aa === ba && (a.y < b.y || (a.y === b.y && a.x < b.x)))) ri = i;
      }
      const region = regions[ri]!;
      const others = regions.filter((_, k) => k !== ri);
      const demandLeft = demandArea(rem);
      const othersEst = estimate(others);
      let bestScore = -1;
      let bestArea = 0;
      let pick: { i: number; o: Orientation; cx: number; cy: number; variant: 'V' | 'H'; children: Rect[] } | null = null;
      for (let i = 0; i < typeCount; i++) {
        const r = rem[i] ?? 0;
        if (r <= 0) continue;
        for (const o of orientations[i]!) {
          if (o.w > region.w || o.h > region.h) continue;
          for (const [cx, cy] of blockShapes(region, o, r)) {
            const area = cx * cy * o.w * o.h;
            const bw = cx * o.w + (cx - 1) * kerf;
            const bh = cy * o.h + (cy - 1) * kerf;
            const variants: Array<'V' | 'H'> = bw === region.w || bh === region.h ? ['V'] : ['V', 'H'];
            for (const variant of variants) {
              const children = placeChildren(region, bw, bh, variant, kerf);
              const score = area + Math.min(demandLeft - area, othersEst + estimate(children));
              if (score > bestScore || (score === bestScore && area > bestArea)) {
                bestScore = score;
                bestArea = area;
                pick = { i, o, cx, cy, variant, children };
              }
            }
          }
        }
      }
      if (!pick) break;
      const { i, o, cx, cy, variant, children } = pick;
      const bw = cx * o.w + (cx - 1) * kerf;
      const bh = cy * o.h + (cy - 1) * kerf;
      const nextRem = rem.slice();
      nextRem[i] = (rem[i] ?? 0) - cx * cy;
      const bestVariant = variant;
      const bestChildren = children;
      regions = [...others, ...bestChildren].filter((r) => fits(r, nextRem));
      rem = nextRem;
      placed += cx * cy * o.w * o.h;
      cuts += (bw < region.w ? 1 : 0) + (bh < region.h ? 1 : 0) + cx * cy - 1;
      decisions = {
        prev: decisions,
        data: { op: 'place', region, index: i, w: o.w, h: o.h, rotated: o.rotated, cx, cy, variant: bestVariant },
      };
      budget.nodes += 3;
    }
    return { regions, rem, placed, cuts, decisions, f: placed };
  };

  const root = makeState([cfg.usable], remaining.slice(), 0, 0, null);
  let beam: State[] = [root];
  const finished: State[] = [];
  const finishedKeys = new Set<string>();
  const regionKeys = (s: State): string => s.regions.map(regionKey).sort().join(';');
  const keepFinished = (s: State): void => {
    const k = `${s.rem.join(',')}|${regionKeys(s)}|${s.placed}|${s.cuts}`;
    if (finishedKeys.has(k)) return;
    finishedKeys.add(k);
    finished.push(s);
  };

  if (root.regions.length === 0) return [];
  const rolloutValue = new Map<State, number>();

  while (beam.length > 0) {
    if (budgetExhausted(budget)) {
      // Out of budget: whatever the beam holds is completed greedily so the pattern stays valid.
      for (const s of beam) keepFinished(rollout(s));
      break;
    }
    const next: State[] = [];
    for (const s of beam) expand(s, next);
    const seen = new Map<string, State>();
    for (const s of next) {
      if (s.regions.length === 0) {
        keepFinished(s);
        continue;
      }
      const k = stateKey(s);
      const prev = seen.get(k);
      if (!prev || s.placed > prev.placed || (s.placed === prev.placed && s.cuts < prev.cuts)) seen.set(k, s);
    }
    // Candidates for rollout: the most promising by estimate (optimistic) and by area placed so far
    // (conservative), so a loose estimate cannot hide a strong placement.
    const pool = [...seen.values()];
    const byF = [...pool].sort((a, b) => b.f - a.f || b.placed - a.placed || a.cuts - b.cuts).slice(0, cfg.beamWidth);
    const byPlaced = [...pool].sort((a, b) => b.placed - a.placed || b.f - a.f || a.cuts - b.cuts).slice(0, cfg.beamWidth);
    const ranked = [...new Set([...byF, ...byPlaced])];
    for (const s of ranked) {
      const done = rollout(s);
      keepFinished(done);
      rolloutValue.set(s, done.placed);
    }
    beam = ranked
      .sort((a, b) => (rolloutValue.get(b) ?? 0) - (rolloutValue.get(a) ?? 0) || b.f - a.f || a.cuts - b.cuts)
      .slice(0, cfg.beamWidth);
  }

  // Convert the best finished states into trees.
  finished.sort((a, b) => b.placed - a.placed || a.cuts - b.cuts);
  const patterns: SheetPattern[] = [];
  const signatures = new Set<string>();
  for (const s of finished.slice(0, Math.max(maxResults * 6, 12))) {
    const pattern = buildPattern(s, cfg);
    const sig = `${pattern.counts.join(',')}|${pattern.cuts}|${pattern.offcutArea}|${pattern.wasteArea}`;
    if (signatures.has(sig)) continue;
    signatures.add(sig);
    patterns.push(pattern);
  }
  return patterns;
}

function placeChildren(region: Rect, bw: number, bh: number, variant: 'V' | 'H', kerf: number): Rect[] {
  const out: Rect[] = [];
  if (variant === 'V') {
    if (bw < region.w) {
      const g = cutGeometry(region, 'vertical', bw, kerf);
      if (g.second) out.push(g.second);
    }
    if (bh < region.h) {
      const g = cutGeometry({ x: region.x, y: region.y, w: bw, h: region.h }, 'horizontal', bh, kerf);
      if (g.second) out.push(g.second);
    }
  } else {
    if (bh < region.h) {
      const g = cutGeometry(region, 'horizontal', bh, kerf);
      if (g.second) out.push(g.second);
    }
    if (bw < region.w) {
      const g = cutGeometry({ x: region.x, y: region.y, w: region.w, h: bh }, 'vertical', bw, kerf);
      if (g.second) out.push(g.second);
    }
  }
  return out;
}

function buildPattern(state: State, cfg: SheetSearchConfig): SheetPattern {
  const { kerf } = cfg;
  const map = new Map<string, DecisionData>();
  for (let d = state.decisions; d; d = d.prev) map.set(regionKey(d.data.region), d.data);

  const leaf = (r: Rect): RemnantNode => ({
    type: cfg.classify(r.w, r.h),
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
  });

  const makeCut = (
    r: Rect,
    direction: 'vertical' | 'horizontal',
    position: number,
    first: TreeNode,
    second: TreeNode | null,
    kerfUsed: number,
  ): TreeNode => {
    // A cut that separates nothing but leftovers is pointless: keep the region as one remnant.
    if (!hasPiece(first) && !hasPiece(second)) return leaf(r);
    return { type: 'cut', x: r.x, y: r.y, w: r.w, h: r.h, direction, position, kerf: kerfUsed, sequence: 0, first, second };
  };

  const block = (x: number, y: number, cx: number, cy: number, d: PlaceDecision): TreeNode => {
    const w = cx * d.w + (cx - 1) * kerf;
    const h = cy * d.h + (cy - 1) * kerf;
    if (cx > 1) {
      const first = block(x, y, 1, cy, d);
      const second = block(x + d.w + kerf, y, cx - 1, cy, d);
      return { type: 'cut', x, y, w, h, direction: 'vertical', position: d.w, kerf, sequence: 0, first, second };
    }
    if (cy > 1) {
      const first = block(x, y, 1, 1, d);
      const second = block(x, y + d.h + kerf, 1, cy - 1, d);
      return { type: 'cut', x, y, w, h, direction: 'horizontal', position: d.h, kerf, sequence: 0, first, second };
    }
    return { type: 'piece', x, y, w: d.w, h: d.h, pieceId: cfg.pieceIds[d.index]!, rotated: d.rotated };
  };

  const build = (r: Rect): TreeNode => {
    const d = map.get(regionKey(r));
    if (!d) return leaf(r);
    if (d.op === 'cut') {
      const g = cutGeometry(r, d.direction, d.position, kerf);
      return makeCut(r, d.direction, d.position, build(g.first), g.second ? build(g.second) : null, g.kerf);
    }
    const bw = d.cx * d.w + (d.cx - 1) * kerf;
    const bh = d.cy * d.h + (d.cy - 1) * kerf;
    const blockNode = block(r.x, r.y, d.cx, d.cy, d);
    if (d.variant === 'V') {
      const column: Rect = { x: r.x, y: r.y, w: bw, h: r.h };
      let colNode: TreeNode = blockNode;
      if (bh < r.h) {
        const g = cutGeometry(column, 'horizontal', bh, kerf);
        colNode = makeCut(column, 'horizontal', bh, blockNode, g.second ? build(g.second) : null, g.kerf);
      }
      if (bw < r.w) {
        const g = cutGeometry(r, 'vertical', bw, kerf);
        return makeCut(r, 'vertical', bw, colNode, g.second ? build(g.second) : null, g.kerf);
      }
      return colNode;
    }
    const strip: Rect = { x: r.x, y: r.y, w: r.w, h: bh };
    let stripNode: TreeNode = blockNode;
    if (bw < r.w) {
      const g = cutGeometry(strip, 'vertical', bw, kerf);
      stripNode = makeCut(strip, 'vertical', bw, blockNode, g.second ? build(g.second) : null, g.kerf);
    }
    if (bh < r.h) {
      const g = cutGeometry(r, 'horizontal', bh, kerf);
      return makeCut(r, 'horizontal', bh, stripNode, g.second ? build(g.second) : null, g.kerf);
    }
    return stripNode;
  };

  const tree = build(cfg.usable);
  const cuts = numberCuts(tree);
  const counts = new Array<number>(cfg.orientations.length).fill(0);
  const idIndex = new Map(cfg.pieceIds.map((id, i) => [id, i]));
  let pieceArea = 0;
  let kerfArea = 0;
  let wasteArea = 0;
  let offcutArea = 0;
  walk(tree, (n) => {
    if (n.type === 'piece') {
      counts[idIndex.get(n.pieceId)!]!++;
      pieceArea += n.w * n.h;
    } else if (n.type === 'offcut') offcutArea += n.w * n.h;
    else if (n.type === 'waste') wasteArea += n.w * n.h;
    else kerfArea += n.direction === 'vertical' ? n.kerf * n.h : n.kerf * n.w;
  });
  return { tree, counts, pieceArea, kerfArea, wasteArea, offcutArea, cuts };
}
