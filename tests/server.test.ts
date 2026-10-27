import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app';
import { openDb, type Db } from '../server/db';
import { inlineOptimizer } from '../server/optimizeRunner';
import { DEFAULT_SETTINGS } from '../src/engine';
import type { JobDto, OrderLineDto, RunDto, StockItemDto } from '../src/shared/api';

let db: Db;
let app: FastifyInstance;

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, optimizer: inlineOptimizer });
});

const settings = { ...DEFAULT_SETTINGS, kerf: 3, minOffcutWidth: 100, minOffcutHeight: 100, maxRuntimeMs: 10000 };

const stockBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'sheet',
  name: 'Kuşe 135 gr',
  formatName: null,
  width: 700,
  height: 1000,
  quantity: 5,
  unitCost: 8,
  gsm: 135,
  color: 'Beyaz',
  finish: null,
  notes: null,
  allowRotation: true,
  grain: 'none',
  status: 'active',
  ...over,
});

const line = (over: Partial<OrderLineDto> = {}): OrderLineDto => ({
  name: 'Flyer',
  width: 100,
  height: 150,
  quantity: 60,
  notes: null,
  allowRotation: true,
  materialKey: null,
  grain: 'any',
  minWidth: null,
  minHeight: null,
  ...over,
});

async function json<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, expected = [200, 201, 204]): Promise<T> {
  const res = await app.inject({ method, url, payload: payload as never });
  if (!expected.includes(res.statusCode)) throw new Error(`${method} ${url} -> ${res.statusCode}: ${res.body}`);
  return (res.body ? JSON.parse(res.body) : null) as T;
}

const status = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<number> =>
  (await app.inject({ method, url, payload: payload as never })).statusCode;

const optimize = (lines: OrderLineDto[]): Promise<RunDto> => json<RunDto>('POST', '/api/optimize', { orderId: null, lines, settings });

describe('stock API', () => {
  it('creates, edits, lists and soft-deletes stock', async () => {
    const created = await json<StockItemDto>('POST', '/api/stock', stockBody());
    expect(created.materialKey).toBe('kuşe 135 gr|135|beyaz|');
    const edited = await json<StockItemDto>('PUT', `/api/stock/${created.id}`, { quantity: 9 });
    expect(edited.quantity).toBe(9);
    expect(edited.version).toBe(created.version + 1);
    await json('DELETE', `/api/stock/${created.id}`);
    expect(await json<StockItemDto[]>('GET', '/api/stock')).toHaveLength(0);
  });

  it('rejects invalid dimensions and quantities with a Turkish message', async () => {
    expect(await status('POST', '/api/stock', stockBody({ width: 0 }))).toBe(400);
    expect(await status('POST', '/api/stock', stockBody({ height: -5 }))).toBe(400);
    expect(await status('POST', '/api/stock', stockBody({ quantity: 1.5 }))).toBe(400);
    const res = await app.inject({ method: 'POST', url: '/api/stock', payload: stockBody({ width: 0 }) as never });
    expect(JSON.parse(res.body).message).toContain('Genişlik');
  });

  it('validates order lines', async () => {
    expect(await status('POST', '/api/optimize', { lines: [line({ width: 0 })], settings })).toBe(400);
    expect(await status('POST', '/api/optimize', { lines: [], settings })).toBe(400);
  });
});

describe('preview vs confirmation', () => {
  it('a preview never changes stock', async () => {
    await json('POST', '/api/stock', stockBody());
    const before = await json<StockItemDto[]>('GET', '/api/stock');
    const run = await optimize([line()]);
    expect(run.result.plans.length).toBeGreaterThan(0);
    expect(await json<StockItemDto[]>('GET', '/api/stock')).toEqual(before);
    expect(await json<unknown[]>('GET', '/api/jobs')).toHaveLength(0);
  });

  it('confirming consumes the planned stock exactly once', async () => {
    const s = await json<StockItemDto>('POST', '/api/stock', stockBody({ quantity: 5 }));
    const run = await optimize([line()]);
    const plan = run.result.plans[0]!;
    const used = plan.totals.sheetsByStock[`s${s.id}`]!;
    const job = await json<JobDto>('POST', `/api/runs/${run.id}/confirm`, { planId: plan.id, approvedOffcuts: [] });
    expect(job.plan.id).toBe(plan.id);
    const after = await json<StockItemDto[]>('GET', '/api/stock');
    expect(after.find((x) => x.id === s.id)!.quantity).toBe(5 - used);

    // Double confirmation is refused and does not consume again.
    expect(await status('POST', `/api/runs/${run.id}/confirm`, { planId: plan.id, approvedOffcuts: [] })).toBe(409);
    expect((await json<StockItemDto[]>('GET', '/api/stock')).find((x) => x.id === s.id)!.quantity).toBe(5 - used);
  });

  it('refuses to confirm when the stock was edited after the preview', async () => {
    const s = await json<StockItemDto>('POST', '/api/stock', stockBody());
    const run = await optimize([line()]);
    await json('PUT', `/api/stock/${s.id}`, { width: 650 });
    expect(await status('POST', `/api/runs/${run.id}/confirm`, { planId: run.result.plans[0]!.id, approvedOffcuts: [] })).toBe(409);
  });

  it('rolls the whole confirmation back when a later step fails', async () => {
    const a = await json<StockItemDto>('POST', '/api/stock', stockBody({ name: 'Kağıt A', width: 300, height: 300, quantity: 1 }));
    const b = await json<StockItemDto>('POST', '/api/stock', stockBody({ name: 'Kağıt B', width: 301, height: 301, quantity: 1 }));
    // 5 pieces of 140×140: two fit on a 300×300 sheet (kerf 3 → 2×2 = 4 per sheet) so both stocks get used.
    const run = await optimize([line({ name: 'Büyük', width: 140, height: 140, quantity: 8 })]);
    const plan = run.result.plans.find((p) => Object.keys(p.totals.sheetsByStock).length === 2) ?? run.result.plans[0]!;
    expect(Object.keys(plan.totals.sheetsByStock).length).toBe(2);

    db.exec(`CREATE TRIGGER fail_b BEFORE UPDATE ON stock_items WHEN OLD.id = ${b.id} BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    expect(await status('POST', `/api/runs/${run.id}/confirm`, { planId: plan.id, approvedOffcuts: [] })).toBe(500);

    const after = await json<StockItemDto[]>('GET', '/api/stock');
    expect(after.find((x) => x.id === a.id)!.quantity).toBe(1);
    expect(after.find((x) => x.id === b.id)!.quantity).toBe(1);
    expect(await json<unknown[]>('GET', '/api/jobs')).toHaveLength(0);
    db.exec('DROP TRIGGER fail_b');
    // Nothing was marked confirmed, so a retry succeeds.
    expect(await status('POST', `/api/runs/${run.id}/confirm`, { planId: plan.id, approvedOffcuts: [] })).toBe(201);
  });
});

describe('offcut lifecycle', () => {
  it('stores offcuts as pending, adds them to the inventory and reuses them in the next job', async () => {
    const sheet = await json<StockItemDto>('POST', '/api/stock', stockBody({ width: 700, height: 500, quantity: 1 }));
    const run = await optimize([line({ name: 'Poster', width: 300, height: 300, quantity: 1 })]);
    const plan = run.result.plans[0]!;
    const job = await json<JobDto>('POST', `/api/runs/${run.id}/confirm`, { planId: plan.id, approvedOffcuts: [] });
    expect(job.offcuts.length).toBeGreaterThan(0);
    expect(job.offcuts.every((o) => o.status === 'pending')).toBe(true);
    expect((await json<StockItemDto[]>('GET', '/api/stock')).filter((x) => x.kind === 'offcut')).toHaveLength(0);

    const biggest = [...job.offcuts].sort((x, y) => y.width * y.height - x.width * x.height)[0]!;
    const after = await json<JobDto>('POST', `/api/jobs/${job.id}/offcuts/${biggest.id}/add`, {});
    const added = after.offcuts.find((o) => o.id === biggest.id)!;
    expect(added.status).toBe('added');
    expect(await status('POST', `/api/jobs/${job.id}/offcuts/${biggest.id}/add`, {})).toBe(409);

    const stock = await json<StockItemDto[]>('GET', '/api/stock');
    const offcut = stock.find((x) => x.id === added.stockItemId)!;
    expect(offcut.kind).toBe('offcut');
    expect(offcut.sourceJobId).toBe(job.id);
    expect(offcut.materialKey).toBe(sheet.materialKey);
    expect([offcut.width, offcut.height]).toEqual([biggest.width, biggest.height]);

    // Next job: only the offcut is large enough for the new order, the sheet stock is gone.
    const run2 = await optimize([line({ name: 'Kart', width: 90, height: 50, quantity: 4 })]);
    const plan2 = run2.result.plans[0]!;
    expect(plan2.fulfilled).toBe(true);
    expect(plan2.totals.sheetsByStock[`s${offcut.id}`]).toBe(1);
    const job2 = await json<JobDto>('POST', `/api/runs/${run2.id}/confirm`, { planId: plan2.id, approvedOffcuts: [] });
    expect(job2.id).not.toBe(job.id);
    expect((await json<StockItemDto[]>('GET', '/api/stock')).find((x) => x.id === offcut.id)!.quantity).toBe(0);
  });

  it('adds approved offcuts during confirmation and can discard the rest', async () => {
    await json('POST', '/api/stock', stockBody({ width: 700, height: 500, quantity: 1 }));
    const run = await optimize([line({ name: 'Poster', width: 300, height: 300, quantity: 1 })]);
    const plan = run.result.plans[0]!;
    const job = await json<JobDto>('POST', `/api/runs/${run.id}/confirm`, { planId: plan.id, approvedOffcuts: ['0:0'] });
    expect(job.offcuts[0]!.status).toBe('added');
    const pending = job.offcuts.find((o) => o.status === 'pending');
    if (pending) {
      const discarded = await json<JobDto>('POST', `/api/jobs/${job.id}/offcuts/${pending.id}/discard`, {});
      expect(discarded.offcuts.find((o) => o.id === pending.id)!.status).toBe('discarded');
    }
  });

  it('does not use excluded offcuts and different materials are never mixed', async () => {
    await json('POST', '/api/stock', stockBody({ kind: 'offcut', width: 300, height: 200, quantity: 1, status: 'excluded' }));
    await json('POST', '/api/stock', stockBody({ kind: 'offcut', name: 'Başka kağıt', gsm: 90, width: 300, height: 200, quantity: 1 }));
    const kuse = await json<StockItemDto>('POST', '/api/stock', stockBody({ width: 1000, height: 1000, quantity: 1 }));
    const run = await optimize([line({ name: 'Kart', width: 100, height: 100, quantity: 1, materialKey: kuse.materialKey })]);
    const used = Object.keys(run.result.plans[0]!.totals.sheetsByStock);
    expect(used).toEqual([`s${kuse.id}`]);
  });
});

describe('history integrity', () => {
  it('keeps the original plan after the stock record is edited or deleted', async () => {
    const s = await json<StockItemDto>('POST', '/api/stock', stockBody());
    const run = await optimize([line()]);
    const job = await json<JobDto>('POST', `/api/runs/${run.id}/confirm`, { planId: run.result.plans[0]!.id, approvedOffcuts: [] });
    await json('PUT', `/api/stock/${s.id}`, { width: 500, height: 500, name: 'Başka bir şey' });
    await json('DELETE', `/api/stock/${s.id}`);
    const again = await json<JobDto>('GET', `/api/jobs/${job.id}`);
    expect(again.plan).toEqual(job.plan);
    expect(again.input.stocks[0]!.width).toBe(700);
    const list = await json<Array<{ id: number }>>('GET', '/api/jobs');
    expect(list.map((j) => j.id)).toEqual([job.id]);
  });
});

describe('settings and papers', () => {
  it('persists cutting settings with clamping', async () => {
    const saved = await json<typeof settings>('PUT', '/api/settings', { ...settings, kerf: 2.5, searchWidth: 99 });
    expect(saved.kerf).toBe(2.5);
    expect(saved.searchWidth).toBe(10);
    expect((await json<typeof settings>('GET', '/api/settings')).kerf).toBe(2.5);
  });

  it('saves settings profiles, updates by name and deletes them', async () => {
    const a = await json<{ id: number; name: string; settings: typeof settings }>('POST', '/api/profiles', { name: 'Hassas', settings: { ...settings, kerf: 2 } });
    expect(a.settings.kerf).toBe(2);
    const b = await json<{ id: number; settings: typeof settings }>('POST', '/api/profiles', { name: 'Hassas', settings: { ...settings, kerf: 4, edgeMargin: 5 } });
    expect(b.id).toBe(a.id);
    const list = await json<Array<{ name: string; settings: typeof settings }>>('GET', '/api/profiles');
    expect(list).toHaveLength(1);
    expect(list[0]!.settings).toMatchObject({ kerf: 4, edgeMargin: 5 });
    expect(await status('POST', '/api/profiles', { name: '  ', settings })).toBe(400);
    await json('DELETE', `/api/profiles/${a.id}`);
    expect(await json<unknown[]>('GET', '/api/profiles')).toHaveLength(0);
  });

  it('wipes the whole database only with the exact confirmation', async () => {
    const stock = await json<StockItemDto>('POST', '/api/stock', stockBody());
    const run = await optimize([line()]);
    await json('POST', `/api/runs/${run.id}/confirm`, { planId: run.result.plans[0]!.id, approvedOffcuts: ['0:0'] });
    await json('POST', '/api/profiles', { name: 'Hassas', settings });
    await json('POST', '/api/orders', { name: 'S', notes: null, lines: [line()] });

    expect(await status('POST', '/api/admin/reset', {})).toBe(400);
    expect(await status('POST', '/api/admin/reset', { confirm: 'evet' })).toBe(400);
    expect((await json<StockItemDto[]>('GET', '/api/stock')).length).toBeGreaterThan(0);

    expect(await status('POST', '/api/admin/reset', { confirm: 'TUM-VERILERI-SIL' })).toBe(204);
    expect(await json<unknown[]>('GET', '/api/stock')).toHaveLength(0);
    expect(await json<unknown[]>('GET', '/api/jobs')).toHaveLength(0);
    expect(await json<unknown[]>('GET', '/api/orders')).toHaveLength(0);
    expect(await json<unknown[]>('GET', '/api/profiles')).toHaveLength(0);
    // The database is usable again and ids restart.
    const again = await json<StockItemDto>('POST', '/api/stock', stockBody());
    expect(again.id).toBe(stock.id);
  });

  it('manages custom paper formats', async () => {
    const p = await json<{ id: number; name: string }>('POST', '/api/papers', { name: 'Özel 50×70', width: 500, height: 700 });
    expect(await json<unknown[]>('GET', '/api/papers')).toHaveLength(1);
    await json('PUT', `/api/papers/${p.id}`, { name: 'Özel 50×71', width: 500, height: 710 });
    await json('DELETE', `/api/papers/${p.id}`);
    expect(await json<unknown[]>('GET', '/api/papers')).toHaveLength(0);
  });
});
