import {
  collectRemnants,
  DEFAULT_SETTINGS,
  validatePlan,
  type CuttingSettings,
  type OptimizationInput,
  type OptimizationResult,
  type Plan,
  type StockGrain,
  type PieceGrain,
} from '../src/engine';
import {
  materialKeyOf,
  type ConfirmRequest,
  type CustomPaperDto,
  type JobDto,
  type JobOffcutDto,
  type JobSummaryDto,
  type OrderDto,
  type OrderInput,
  type OrderLineDto,
  type RunDto,
  type SettingsProfileDto,
  type StockInput,
  type StockItemDto,
} from '../src/shared/api';
import { nowIso, transaction, type Db } from './schema';

const randomUUID = (): string => globalThis.crypto.randomUUID();

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Row = Record<string, string | number | bigint | null>;
const rows = (v: unknown): Row[] => v as Row[];
const row = (v: unknown): Row | undefined => (v as Row | undefined) ?? undefined;
const num = (v: string | number | bigint | null | undefined): number => Number(v ?? 0);
const str = (v: string | number | bigint | null | undefined): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: string | number | bigint | null | undefined): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: string | number | bigint | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------------------------

const bad = (message: string): never => {
  throw new HttpError(400, message);
};

function positive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) bad(`${label} sıfırdan büyük bir sayı olmalıdır.`);
  return value as number;
}

function wholeNumber(value: unknown, label: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) bad(`${label} en az ${min} olan bir tam sayı olmalıdır.`);
  return value as number;
}

function optionalNonNegative(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) bad(`${label} negatif olmayan bir sayı olmalıdır.`);
  return value as number;
}

function text(value: unknown, label: string, required = false): string | null {
  if (value === null || value === undefined || value === '') {
    if (required) bad(`${label} boş bırakılamaz.`);
    return null;
  }
  if (typeof value !== 'string') return bad(`${label} metin olmalıdır.`);
  const t = value.trim();
  if (required && t.length === 0) bad(`${label} boş bırakılamaz.`);
  return t.length > 0 ? t.slice(0, 500) : null;
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], label: string): T => {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) return bad(`${label} geçersiz.`);
  return value as T;
};

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};

export function parseSettings(raw: unknown): CuttingSettings {
  const r = (raw ?? {}) as Partial<Record<keyof CuttingSettings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const em = typeof r.edgeMargins === 'object' && r.edgeMargins !== null ? (r.edgeMargins as Record<string, unknown>) : null;
  const edgeMargin = clamp(r.edgeMargin, 0, 100, d.edgeMargin);
  return {
    kerf: clamp(r.kerf, 0, 50, d.kerf),
    edgeMargin,
    ...(em ? { edgeMargins: { top: clamp(em.top, 0, 100, edgeMargin), right: clamp(em.right, 0, 100, edgeMargin), bottom: clamp(em.bottom, 0, 100, edgeMargin), left: clamp(em.left, 0, 100, edgeMargin) } } : {}),
    minOffcutWidth: clamp(r.minOffcutWidth, 0, 5000, d.minOffcutWidth),
    minOffcutHeight: clamp(r.minOffcutHeight, 0, 5000, d.minOffcutHeight),
    maxRuntimeMs: Math.round(clamp(r.maxRuntimeMs, 500, 120000, d.maxRuntimeMs)),
    searchWidth: Math.round(clamp(r.searchWidth, 1, 10, d.searchWidth)),
    costWeight: clamp(r.costWeight, 0, 1, d.costWeight),
    seed: Math.round(clamp(r.seed, 0, 2147483647, d.seed)),
  };
}

export function getSettings(db: Db): CuttingSettings {
  const r = row(db.prepare('SELECT value FROM app_settings WHERE key = ?').get('cutting'));
  if (!r) return DEFAULT_SETTINGS;
  try {
    return parseSettings(JSON.parse(str(r.value)));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(db: Db, raw: unknown): CuttingSettings {
  const s = parseSettings(raw);
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('cutting', JSON.stringify(s));
  return s;
}

// ---------------------------------------------------------------------------------------------
// Settings profiles
// ---------------------------------------------------------------------------------------------

const toProfile = (r: Row): SettingsProfileDto => ({
  id: num(r.id),
  name: str(r.name),
  settings: parseSettings(JSON.parse(str(r.settings))),
  updatedAt: str(r.updated_at),
});

export const listProfiles = (db: Db): SettingsProfileDto[] =>
  rows(db.prepare('SELECT * FROM setting_profiles ORDER BY name COLLATE NOCASE').all()).map(toProfile);

/** Saves the settings under `name`; an existing profile with the same name is updated. */
export function saveProfile(db: Db, rawName: unknown, rawSettings: unknown): SettingsProfileDto {
  const name = text(rawName, 'Profil adı', true)!.slice(0, 60);
  const settings = parseSettings(rawSettings);
  db.prepare(
    `INSERT INTO setting_profiles (name, settings, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
  ).run(name, JSON.stringify(settings), nowIso());
  return toProfile(row(db.prepare('SELECT * FROM setting_profiles WHERE name = ?').get(name))!);
}

export function deleteProfile(db: Db, id: number): void {
  db.prepare('DELETE FROM setting_profiles WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------------------------
// Custom paper formats
// ---------------------------------------------------------------------------------------------

const toPaper = (r: Row): CustomPaperDto => ({ id: num(r.id), name: str(r.name), width: num(r.width), height: num(r.height) });

export const listPapers = (db: Db): CustomPaperDto[] =>
  rows(db.prepare('SELECT * FROM custom_papers ORDER BY name').all()).map(toPaper);

export function savePaper(db: Db, raw: Partial<CustomPaperDto>, id?: number): CustomPaperDto {
  const name = text(raw.name, 'Format adı', true)!;
  const width = positive(raw.width, 'Genişlik');
  const height = positive(raw.height, 'Yükseklik');
  if (id === undefined) {
    const res = db.prepare('INSERT INTO custom_papers (name, width, height, created_at) VALUES (?, ?, ?, ?)').run(name, width, height, nowIso());
    return { id: Number(res.lastInsertRowid), name, width, height };
  }
  const res = db.prepare('UPDATE custom_papers SET name = ?, width = ?, height = ? WHERE id = ?').run(name, width, height, id);
  if (res.changes === 0) throw new HttpError(404, 'Format bulunamadı.');
  return { id, name, width, height };
}

export function deletePaper(db: Db, id: number): void {
  db.prepare('DELETE FROM custom_papers WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------------------------

const GRAINS: readonly StockGrain[] = ['none', 'width', 'height'];
const PIECE_GRAINS: readonly PieceGrain[] = ['any', 'width', 'height'];

const toStock = (r: Row): StockItemDto => ({
  id: num(r.id),
  kind: str(r.kind) as 'sheet' | 'offcut',
  name: str(r.name),
  formatName: strOrNull(r.format_name),
  width: num(r.width),
  height: num(r.height),
  quantity: num(r.quantity),
  unitCost: numOrNull(r.unit_cost),
  gsm: numOrNull(r.gsm),
  color: strOrNull(r.color),
  finish: strOrNull(r.finish),
  notes: strOrNull(r.notes),
  allowRotation: num(r.allow_rotation) === 1,
  grain: str(r.grain) as StockGrain,
  materialKey: str(r.material_key),
  status: str(r.status) as 'active' | 'excluded',
  sourceJobId: numOrNull(r.source_job_id),
  version: num(r.version),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export const listStock = (db: Db): StockItemDto[] =>
  rows(db.prepare('SELECT * FROM stock_items WHERE deleted_at IS NULL ORDER BY kind, name, width, height').all()).map(toStock);

export function getStock(db: Db, id: number): StockItemDto {
  const r = row(db.prepare('SELECT * FROM stock_items WHERE id = ? AND deleted_at IS NULL').get(id));
  if (!r) throw new HttpError(404, 'Stok kaydı bulunamadı.');
  return toStock(r);
}

function parseStockInput(raw: Partial<StockInput>): StockInput & { materialKey: string } {
  const name = text(raw.name, 'Kağıt adı', true)!;
  const gsm = optionalNonNegative(raw.gsm, 'Gramaj');
  const color = text(raw.color, 'Renk');
  const finish = text(raw.finish, 'Yüzey');
  return {
    kind: oneOf(raw.kind ?? 'sheet', ['sheet', 'offcut'] as const, 'Tür'),
    name,
    formatName: text(raw.formatName, 'Format'),
    width: positive(raw.width, 'Genişlik'),
    height: positive(raw.height, 'Yükseklik'),
    quantity: wholeNumber(raw.quantity, 'Adet'),
    unitCost: optionalNonNegative(raw.unitCost, 'Birim maliyet'),
    gsm,
    color,
    finish,
    notes: text(raw.notes, 'Not'),
    allowRotation: raw.allowRotation !== false,
    grain: oneOf(raw.grain ?? 'none', GRAINS, 'Lif yönü'),
    status: oneOf(raw.status ?? 'active', ['active', 'excluded'] as const, 'Durum'),
    materialKey: materialKeyOf({ name, gsm, color, finish }),
  };
}

const insertStock = (db: Db, s: StockInput & { materialKey: string }, sourceJobId: number | null): number => {
  const now = nowIso();
  const res = db
    .prepare(
      `INSERT INTO stock_items (kind, name, format_name, width, height, quantity, unit_cost, gsm, color, finish, notes,
        allow_rotation, grain, material_key, status, source_job_id, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(s.kind, s.name, s.formatName, s.width, s.height, s.quantity, s.unitCost, s.gsm, s.color, s.finish, s.notes, s.allowRotation ? 1 : 0, s.grain, s.materialKey, s.status, sourceJobId, now, now);
  return Number(res.lastInsertRowid);
};

export function createStock(db: Db, raw: Partial<StockInput>): StockItemDto {
  return getStock(db, insertStock(db, parseStockInput(raw), null));
}

export function updateStock(db: Db, id: number, raw: Partial<StockInput>): StockItemDto {
  const current = getStock(db, id);
  const s = parseStockInput({ ...current, ...raw });
  db.prepare(
    `UPDATE stock_items SET kind = ?, name = ?, format_name = ?, width = ?, height = ?, quantity = ?, unit_cost = ?, gsm = ?, color = ?,
       finish = ?, notes = ?, allow_rotation = ?, grain = ?, material_key = ?, status = ?, version = version + 1, updated_at = ? WHERE id = ?`,
  ).run(s.kind, s.name, s.formatName, s.width, s.height, s.quantity, s.unitCost, s.gsm, s.color, s.finish, s.notes, s.allowRotation ? 1 : 0, s.grain, s.materialKey, s.status, nowIso(), id);
  return getStock(db, id);
}

/** Soft delete: finished jobs keep their own snapshots, so nothing that references the row can break. */
export function deleteStock(db: Db, id: number): void {
  getStock(db, id);
  db.prepare('UPDATE stock_items SET deleted_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), id);
}

// ---------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------

function parseLine(raw: Partial<OrderLineDto>, index: number): OrderLineDto {
  const tag = `Satır ${index + 1}`;
  return {
    name: text(raw.name, `${tag}: ürün adı`, true)!,
    width: positive(raw.width, `${tag}: genişlik`),
    height: positive(raw.height, `${tag}: yükseklik`),
    quantity: wholeNumber(raw.quantity, `${tag}: adet`, 1),
    notes: text(raw.notes, `${tag}: not`),
    allowRotation: raw.allowRotation !== false,
    materialKey: text(raw.materialKey, 'Kağıt cinsi'),
    grain: oneOf(raw.grain ?? 'any', PIECE_GRAINS, 'Lif yönü'),
    minWidth: optionalNonNegative(raw.minWidth, `${tag}: min. genişlik`),
    minHeight: optionalNonNegative(raw.minHeight, `${tag}: min. yükseklik`),
  };
}

export function parseLines(raw: unknown): OrderLineDto[] {
  if (!Array.isArray(raw) || raw.length === 0) bad('Siparişte en az bir ürün satırı olmalıdır.');
  return (raw as Partial<OrderLineDto>[]).map(parseLine);
}

const toLine = (r: Row): OrderLineDto => ({
  id: num(r.id),
  name: str(r.name),
  width: num(r.width),
  height: num(r.height),
  quantity: num(r.quantity),
  notes: strOrNull(r.notes),
  allowRotation: num(r.allow_rotation) === 1,
  materialKey: strOrNull(r.material_key),
  grain: str(r.grain) as PieceGrain,
  minWidth: numOrNull(r.min_width),
  minHeight: numOrNull(r.min_height),
});

function loadOrder(db: Db, r: Row): OrderDto {
  const lines = rows(db.prepare('SELECT * FROM order_lines WHERE order_id = ? ORDER BY position').all(num(r.id))).map(toLine);
  return {
    id: num(r.id),
    name: str(r.name),
    notes: strOrNull(r.notes),
    status: str(r.status) as 'draft' | 'completed',
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
    lines,
  };
}

export const listOrders = (db: Db): OrderDto[] =>
  rows(db.prepare('SELECT * FROM orders ORDER BY updated_at DESC, id DESC').all()).map((r) => loadOrder(db, r));

export function getOrder(db: Db, id: number): OrderDto {
  const r = row(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
  if (!r) throw new HttpError(404, 'Sipariş bulunamadı.');
  return loadOrder(db, r);
}

function writeLines(db: Db, orderId: number, lines: OrderLineDto[]): void {
  db.prepare('DELETE FROM order_lines WHERE order_id = ?').run(orderId);
  const ins = db.prepare(
    `INSERT INTO order_lines (order_id, position, name, width, height, quantity, notes, allow_rotation, material_key, grain, min_width, min_height)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  lines.forEach((l, i) => ins.run(orderId, i, l.name, l.width, l.height, l.quantity, l.notes, l.allowRotation ? 1 : 0, l.materialKey, l.grain, l.minWidth, l.minHeight));
}

export function saveOrder(db: Db, raw: Partial<OrderInput>, id?: number): OrderDto {
  const name = text(raw.name, 'Sipariş adı', true)!;
  const notes = text(raw.notes, 'Not');
  const lines = parseLines(raw.lines);
  return transaction(db, () => {
    const now = nowIso();
    let orderId = id;
    if (orderId === undefined) {
      const res = db.prepare('INSERT INTO orders (name, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(name, notes, 'draft', now, now);
      orderId = Number(res.lastInsertRowid);
    } else {
      getOrder(db, orderId);
      db.prepare('UPDATE orders SET name = ?, notes = ?, updated_at = ? WHERE id = ?').run(name, notes, now, orderId);
    }
    writeLines(db, orderId, lines);
    return getOrder(db, orderId);
  });
}

export function deleteOrder(db: Db, id: number): void {
  getOrder(db, id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------------------------
// Optimisation runs (previews)
// ---------------------------------------------------------------------------------------------

/** Build the engine input from the order lines and the CURRENT usable stock. Does not mutate anything. */
export function buildOptimizationInput(db: Db, lines: OrderLineDto[], settings: CuttingSettings): { input: OptimizationInput; versions: Record<string, number> } {
  const stocks = listStock(db).filter((s) => s.status === 'active' && s.quantity > 0);
  const versions: Record<string, number> = {};
  const input: OptimizationInput = {
    settings,
    pieces: lines.map((l, i) => ({
      id: `L${i + 1}`,
      name: l.name,
      width: l.width,
      height: l.height,
      quantity: l.quantity,
      allowRotation: true, // rotation is not a user setting: every sheet and product may be turned 90°
      materialKey: l.materialKey,
      grain: l.grain,
    })),
    stocks: stocks.map((s) => {
      versions[`s${s.id}`] = s.version;
      return {
        id: `s${s.id}`,
        name: s.name + (s.formatName ? ` (${s.formatName})` : ''),
        width: s.width,
        height: s.height,
        quantity: s.quantity,
        unitCost: s.unitCost,
        allowRotation: true,
        grain: s.grain,
        materialKey: s.materialKey,
        kind: s.kind,
      };
    }),
  };
  return { input, versions };
}

export function saveRun(
  db: Db,
  args: { orderId: number | null; orderName: string; settings: CuttingSettings; input: OptimizationInput; versions: Record<string, number>; result: OptimizationResult },
): RunDto {
  const id = randomUUID();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO optimization_runs (id, order_id, order_name, settings, input, stock_versions, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, args.orderId, args.orderName, JSON.stringify(args.settings), JSON.stringify(args.input), JSON.stringify(args.versions), JSON.stringify(args.result), createdAt);
  return { id, createdAt, orderId: args.orderId, orderName: args.orderName, settings: args.settings, input: args.input, result: args.result, confirmedJobId: null };
}

export function getRun(db: Db, id: string): RunDto {
  const r = row(db.prepare('SELECT * FROM optimization_runs WHERE id = ?').get(id));
  if (!r) throw new HttpError(404, 'Optimizasyon sonucu bulunamadı.');
  return {
    id: str(r.id),
    createdAt: str(r.created_at),
    orderId: numOrNull(r.order_id),
    orderName: str(r.order_name),
    settings: JSON.parse(str(r.settings)) as CuttingSettings,
    input: JSON.parse(str(r.input)) as OptimizationInput,
    result: JSON.parse(str(r.result)) as OptimizationResult,
    confirmedJobId: numOrNull(r.confirmed_job_id),
  };
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

export interface OffcutLeaf {
  key: string;
  sheetIndex: number;
  leafIndex: number;
  width: number;
  height: number;
  quantity: number;
}

/** Offcut leaves of a plan, exactly as they exist in the cut trees (one entry per leaf, × sheet copies). */
export function offcutLeaves(plan: Plan): OffcutLeaf[] {
  const out: OffcutLeaf[] = [];
  plan.sheets.forEach((sheet, sheetIndex) => {
    collectRemnants(sheet.tree)
      .filter((n) => n.type === 'offcut')
      .forEach((n, leafIndex) => {
        out.push({ key: `${sheetIndex}:${leafIndex}`, sheetIndex, leafIndex, width: n.w, height: n.h, quantity: sheet.copies });
      });
  });
  return out;
}

const toOffcut = (r: Row): JobOffcutDto => ({
  id: num(r.id),
  sheetIndex: num(r.sheet_index),
  width: num(r.width),
  height: num(r.height),
  quantity: num(r.quantity),
  status: str(r.status) as JobOffcutDto['status'],
  stockItemId: numOrNull(r.stock_item_id),
  notes: strOrNull(r.notes),
});

export function confirmRun(db: Db, runId: string, req: ConfirmRequest): JobDto {
  return transaction(db, () => {
    const run = getRun(db, runId);
    if (run.confirmedJobId !== null) throw new HttpError(409, 'Bu optimizasyon sonucu zaten onaylandı; stok ikinci kez düşülemez.');
    const plan = run.result.plans.find((p) => p.id === req.planId);
    if (!plan) throw new HttpError(404, 'Seçilen plan bulunamadı.');
    if (plan.sheets.length === 0) throw new HttpError(400, 'Kesilecek tabaka içermeyen bir plan onaylanamaz.');

    const violations = validatePlan(plan, run.input);
    if (violations.length > 0) throw new HttpError(422, `Plan geometrik olarak geçersiz: ${violations[0]}`);

    const versions = JSON.parse(str(row(db.prepare('SELECT stock_versions FROM optimization_runs WHERE id = ?').get(runId))?.stock_versions)) as Record<string, number>;
    const sourceStocks = new Map<string, StockItemDto>();
    for (const [stockId, needed] of Object.entries(plan.totals.sheetsByStock)) {
      const id = Number(stockId.slice(1));
      const current = db.prepare('SELECT * FROM stock_items WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!current) throw new HttpError(409, 'Plandaki bir stok kaydı silinmiş. Lütfen optimizasyonu yeniden çalıştırın.');
      const stock = toStock(current as Row);
      if (stock.version !== versions[stockId]) throw new HttpError(409, `"${stock.name}" stok kaydı optimizasyondan sonra değiştirildi. Lütfen yeniden hesaplayın.`);
      if (stock.status !== 'active') throw new HttpError(409, `"${stock.name}" artık kullanıma kapalı.`);
      if (stock.quantity < needed) throw new HttpError(409, `"${stock.name}" için yeterli stok yok (gerekli ${needed}, mevcut ${stock.quantity}).`);
      sourceStocks.set(stockId, stock);
    }

    const t = plan.totals;
    const now = nowIso();
    const res = db
      .prepare(
        `INSERT INTO jobs (run_id, order_id, order_name, settings, input, plan, sheet_count, utilization, piece_area, stock_area, waste_area,
           offcut_area, cuts, cost, fulfilled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(runId, run.orderId, run.orderName, JSON.stringify(run.settings), JSON.stringify(run.input), JSON.stringify(plan), t.sheetCount, t.utilization, t.pieceArea, t.stockArea, t.wasteArea, t.offcutArea, t.cuts, t.cost, plan.fulfilled ? 1 : 0, now);
    const jobId = Number(res.lastInsertRowid);

    for (const [stockId, needed] of Object.entries(plan.totals.sheetsByStock)) {
      const id = Number(stockId.slice(1));
      const upd = db.prepare('UPDATE stock_items SET quantity = quantity - ?, version = version + 1, updated_at = ? WHERE id = ? AND quantity >= ?').run(needed, now, id, needed);
      if (upd.changes !== 1) throw new HttpError(409, 'Stok güncellenemedi; işlem geri alındı.');
      db.prepare('INSERT INTO job_consumption (job_id, stock_item_id, quantity) VALUES (?, ?, ?)').run(jobId, id, needed);
    }

    const approved = new Set(req.approvedOffcuts);
    for (const leaf of offcutLeaves(plan)) {
      const source = sourceStocks.get(plan.sheets[leaf.sheetIndex]!.stockId)!;
      const wanted = approved.has(leaf.key);
      let stockItemId: number | null = null;
      if (wanted) stockItemId = addOffcutToStock(db, source, leaf.width, leaf.height, leaf.quantity, jobId);
      db.prepare(
        'INSERT INTO job_offcuts (job_id, sheet_index, leaf_index, width, height, quantity, status, stock_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(jobId, leaf.sheetIndex, leaf.leafIndex, leaf.width, leaf.height, leaf.quantity, wanted ? 'added' : 'pending', stockItemId);
    }

    db.prepare('UPDATE optimization_runs SET confirmed_job_id = ? WHERE id = ?').run(jobId, runId);
    if (run.orderId !== null) db.prepare("UPDATE orders SET status = 'completed', updated_at = ? WHERE id = ?").run(now, run.orderId);
    return getJob(db, jobId);
  });
}

function addOffcutToStock(db: Db, source: StockItemDto, width: number, height: number, quantity: number, jobId: number): number {
  return insertStock(
    db,
    {
      kind: 'offcut',
      name: source.name,
      formatName: null,
      width,
      height,
      quantity,
      unitCost: null,
      gsm: source.gsm,
      color: source.color,
      finish: source.finish,
      notes: `İş #${jobId} artığı`,
      allowRotation: source.allowRotation,
      grain: source.grain,
      status: 'active',
      materialKey: source.materialKey,
    },
    jobId,
  );
}

export function getJob(db: Db, id: number): JobDto {
  const r = row(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
  if (!r) throw new HttpError(404, 'İş bulunamadı.');
  const offcuts = rows(db.prepare('SELECT * FROM job_offcuts WHERE job_id = ? ORDER BY sheet_index, leaf_index').all(id)).map(toOffcut);
  return {
    id,
    orderId: numOrNull(r.order_id),
    orderName: str(r.order_name),
    createdAt: str(r.created_at),
    settings: JSON.parse(str(r.settings)) as CuttingSettings,
    input: JSON.parse(str(r.input)) as OptimizationInput,
    plan: JSON.parse(str(r.plan)) as Plan,
    offcuts,
  };
}

export const listJobs = (db: Db): JobSummaryDto[] =>
  rows(
    db
      .prepare(
        'SELECT id, order_name, created_at, sheet_count, utilization, piece_area, stock_area, waste_area, offcut_area, cuts, cost, fulfilled FROM jobs ORDER BY id DESC',
      )
      .all(),
  ).map((r) => ({
    id: num(r.id),
    orderName: str(r.order_name),
    createdAt: str(r.created_at),
    sheetCount: num(r.sheet_count),
    utilization: num(r.utilization),
    pieceArea: num(r.piece_area),
    stockArea: num(r.stock_area),
    wasteArea: num(r.waste_area),
    offcutArea: num(r.offcut_area),
    cuts: num(r.cuts),
    cost: numOrNull(r.cost),
    fulfilled: num(r.fulfilled) === 1,
  }));

/** Add a pending offcut of a confirmed job to the inventory (idempotent: a second call is rejected). */
export function addJobOffcut(db: Db, jobId: number, offcutId: number, notes: string | null): JobDto {
  return transaction(db, () => {
    const job = getJob(db, jobId);
    const off = row(db.prepare('SELECT * FROM job_offcuts WHERE id = ? AND job_id = ?').get(offcutId, jobId));
    if (!off) throw new HttpError(404, 'Artık parça bulunamadı.');
    if (str(off.status) !== 'pending') throw new HttpError(409, 'Bu artık parça zaten işlendi.');
    const stockId = job.plan.sheets[num(off.sheet_index)]!.stockId;
    const sourceRow = row(db.prepare('SELECT * FROM stock_items WHERE id = ?').get(Number(stockId.slice(1))));
    if (!sourceRow) throw new HttpError(409, 'Kaynak stok kaydı bulunamadı.');
    const id = addOffcutToStock(db, toStock(sourceRow), num(off.width), num(off.height), num(off.quantity), jobId);
    if (notes) db.prepare('UPDATE stock_items SET notes = ? WHERE id = ?').run(notes, id);
    db.prepare("UPDATE job_offcuts SET status = 'added', stock_item_id = ? WHERE id = ?").run(id, offcutId);
    return getJob(db, jobId);
  });
}

export function discardJobOffcut(db: Db, jobId: number, offcutId: number): JobDto {
  const off = row(db.prepare('SELECT status FROM job_offcuts WHERE id = ? AND job_id = ?').get(offcutId, jobId));
  if (!off) throw new HttpError(404, 'Artık parça bulunamadı.');
  if (str(off.status) !== 'pending') throw new HttpError(409, 'Bu artık parça zaten işlendi.');
  db.prepare("UPDATE job_offcuts SET status = 'discarded' WHERE id = ?").run(offcutId);
  return getJob(db, jobId);
}

// ---------------------------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------------------------

export const RESET_CONFIRMATION = 'TUM-VERILERI-SIL';

/** Irreversibly deletes ALL application data (stock, offcuts, orders, jobs, profiles, settings) in one transaction. */
export function resetAllData(db: Db, confirmation: unknown): void {
  if (confirmation !== RESET_CONFIRMATION) throw new HttpError(400, 'Onay ifadesi eksik veya hatalı; hiçbir veri silinmedi.');
  transaction(db, () => {
    for (const table of [
      'job_offcuts',
      'job_consumption',
      'jobs',
      'optimization_runs',
      'order_lines',
      'orders',
      'stock_items',
      'custom_papers',
      'setting_profiles',
      'app_settings',
    ]) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.exec('DELETE FROM sqlite_sequence');
  });
}
