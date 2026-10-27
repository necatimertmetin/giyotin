/**
 * Domain model of the guillotine cutting engine.
 *
 * All public lengths are millimetres, all areas are mm². Every coordinate the engine produces is an
 * exact multiple of 0.01 mm (the engine searches on an integer grid of hundredths of a millimetre).
 */

/** Direction of the paper grain on a stock sheet, relative to the sheet's own width/height. */
export type StockGrain = 'none' | 'width' | 'height';
/** Grain direction a finished piece requires, relative to the piece's own declared width/height. */
export type PieceGrain = 'any' | 'width' | 'height';

export interface PieceSpec {
  id: string;
  name: string;
  width: number;
  height: number;
  quantity: number;
  /** May the finished piece be rotated by 90°? */
  allowRotation: boolean;
  /** Restrict the piece to stock with this material key; null = any material. */
  materialKey: string | null;
  grain: PieceGrain;
}

export interface StockSpec {
  id: string;
  name: string;
  width: number;
  height: number;
  quantity: number;
  /** Cost per sheet/offcut; null when unknown (treated as 0 in cost terms). */
  unitCost: number | null;
  /** May pieces be rotated when cut from this stock? */
  allowRotation: boolean;
  grain: StockGrain;
  /** Pieces with different material keys are never mixed on the same stock item. */
  materialKey: string;
  kind: 'sheet' | 'offcut';
}

/** Trim removed from each edge of a stock item before cutting, mm. */
export interface EdgeMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CuttingSettings {
  /** Blade width in mm. */
  kerf: number;
  /** Trim removed from every edge of every stock item before cutting, mm. */
  edgeMargin: number;
  /** Per-edge trim; when present it replaces `edgeMargin`. */
  edgeMargins?: EdgeMargins;
  /** Longest cut the guillotine can make, mm (a cut spans its whole region). 0 / undefined = unlimited. */
  bladeLength?: number;
  /** A leftover rectangle is a reusable offcut only if it is at least this large (in either orientation). */
  minOffcutWidth: number;
  minOffcutHeight: number;
  /** Safety stop for the whole optimisation, in ms. */
  maxRuntimeMs: number;
  /** 1 (fast) … 10 (thorough): beam width of the search. */
  searchWidth: number;
  /** 0 … 1: how strongly material cost (instead of consumed area) drives the objective. */
  costWeight: number;
  /** Seed for the (deterministic) tie-breaking used by local improvement. */
  seed: number;
}

/** The trim of each edge: the per-edge values if set, otherwise `edgeMargin` on all four edges. */
export const edgeMarginsOf = (s: Pick<CuttingSettings, 'edgeMargin' | 'edgeMargins'>): EdgeMargins =>
  s.edgeMargins ?? { top: s.edgeMargin, right: s.edgeMargin, bottom: s.edgeMargin, left: s.edgeMargin };

export const DEFAULT_SETTINGS: CuttingSettings = {
  kerf: 3,
  edgeMargin: 0,
  minOffcutWidth: 100,
  minOffcutHeight: 100,
  maxRuntimeMs: 8000,
  searchWidth: 5,
  costWeight: 0,
  seed: 1,
};

export interface OptimizationInput {
  pieces: PieceSpec[];
  stocks: StockSpec[];
  settings: CuttingSettings;
}

// ---------------------------------------------------------------------------------------------
// Cutting tree
// ---------------------------------------------------------------------------------------------

export interface PieceNode {
  type: 'piece';
  x: number;
  y: number;
  w: number;
  h: number;
  pieceId: string;
  /** True when the piece is cut rotated by 90° with respect to its declared width×height. */
  rotated: boolean;
}

export interface OffcutNode {
  type: 'offcut';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WasteNode {
  type: 'waste';
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RemnantNode = OffcutNode | WasteNode;

/**
 * A guillotine cut spanning the whole region (x, y, w, h).
 *
 * - `vertical`: the blade runs top to bottom at x + position; `first` is the left part
 *   (x, y, position, h), the kerf strip covers [x+position, x+position+kerf] and `second` is the right part.
 * - `horizontal`: the blade runs left to right at y + position; `first` is the top part.
 *
 * `second` is null when the kerf consumed the entire remainder (blade hanging off the edge).
 * `sequence` is the 1-based order in which the cut should be made (depth-first, derived from the tree).
 */
export interface CutNode {
  type: 'cut';
  x: number;
  y: number;
  w: number;
  h: number;
  direction: 'vertical' | 'horizontal';
  position: number;
  kerf: number;
  sequence: number;
  first: TreeNode;
  second: TreeNode | null;
}

export type TreeNode = PieceNode | OffcutNode | WasteNode | CutNode;

// ---------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------

export interface SheetStats {
  /** All areas are for ONE copy of the sheet. */
  sheetArea: number;
  pieceArea: number;
  kerfArea: number;
  /** Unusable waste, including the edge trim. */
  wasteArea: number;
  trimArea: number;
  offcutArea: number;
  cuts: number;
  pieceCount: number;
}

export interface SheetPlan {
  stockId: string;
  stockName: string;
  /** Number of identical sheets cut with this exact tree. */
  copies: number;
  width: number;
  height: number;
  /** Tree covering the trimmed (usable) rectangle. */
  tree: TreeNode;
  usable: { x: number; y: number; w: number; h: number };
  stats: SheetStats;
}

/** Cut steps of a plan: every layout is cut once for its whole stack of sheets. */
export const cutSteps = (plan: { sheets: Array<{ stats: { cuts: number } }> }): number => plan.sheets.reduce((c, sh) => c + sh.stats.cuts, 0);

export interface PlanTotals {
  stockArea: number;
  pieceArea: number;
  kerfArea: number;
  wasteArea: number;
  offcutArea: number;
  cuts: number;
  sheetCount: number;
  /** null when no used stock has a cost. */
  cost: number | null;
  /** pieceArea / stockArea, 0..1 */
  utilization: number;
  sheetsByStock: Record<string, number>;
}

export interface Unfulfilled {
  pieceId: string;
  name: string;
  quantity: number;
}

export interface PlanObjective {
  profile: string;
  score: number;
}

export interface Plan {
  id: string;
  label: string;
  description: string;
  sheets: SheetPlan[];
  totals: PlanTotals;
  placed: Record<string, number>;
  unfulfilled: Unfulfilled[];
  fulfilled: boolean;
  /** Pieces cut beyond the demanded quantity (pieceId → extra copies); only the single-layout plan has any. */
  overproduced?: Record<string, number>;
  /** Why this plan is listed: 'cheapest', 'balanced' and/or 'layouts-N' (its number of different layouts). The first plan is the recommended one. */
  tags?: string[];
  objective: PlanObjective;
}

export type PreflightIssueKind = 'invalid-dimension' | 'invalid-quantity' | 'no-fit' | 'no-material' | 'no-stock' | 'blade-length';

export interface PreflightIssue {
  pieceId: string;
  kind: PreflightIssueKind;
  message: string;
}

export interface OptimizationResult {
  plans: Plan[];
  issues: PreflightIssue[];
  runtimeMs: number;
  nodesExplored: number;
  stoppedBy: 'completed' | 'timeLimit' | 'cancelled';
  /** Always false: the search is a heuristic and gives no optimality proof. */
  provenOptimal: false;
}

export interface CancelToken {
  cancelled: boolean;
}

export interface OptimizeOptions {
  cancel?: CancelToken;
  now?: () => number;
}
