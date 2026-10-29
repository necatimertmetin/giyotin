import initSqlJs from 'sql.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { adaptSqlJs } from '../src/client/local/sqlAdapter';
import { inlineOptimizer } from '../server/optimizeRunner';
import { buildRoutes, matchRoute, type Route } from '../server/routes';
import { initSchema, SCHEMA } from '../server/schema';
import { seedIfEmpty } from '../server/seed';
import { HttpError } from '../server/services';
import { DEFAULT_SETTINGS } from '../src/engine';
import type { JobDto, RunDto, StockItemDto } from '../src/shared/api';

/**
 * The browser-only (GitHub Pages) build runs the server's route handlers on sql.js. These tests drive the same
 * handlers through the sql.js adapter to prove the two backends behave alike.
 */
let routes: Route[];
let raw: InstanceType<Awaited<ReturnType<typeof initSqlJs>>['Database']>;

beforeEach(async () => {
  const SQL = await initSqlJs();
  raw = new SQL.Database();
  raw.run('PRAGMA foreign_keys = ON');
  raw.exec(SCHEMA);
  routes = buildRoutes(adaptSqlJs(raw), inlineOptimizer);
});

async function call<T = unknown>(method: string, url: string, body?: unknown, expected = [200, 201, 204]): Promise<T> {
  const found = matchRoute(routes, method, url);
  if (!found) throw new Error(`no route ${method} ${url}`);
  try {
    const res = await found.route.handler({ params: found.params, body, signal: new AbortController().signal });
    if (!expected.includes(res.status)) throw new Error(`${method} ${url} -> ${res.status}`);
    return res.body as T;
  } catch (error) {
    if (error instanceof HttpError && !expected.includes(error.status)) throw error;
    if (error instanceof HttpError) return { status: error.status } as T;
    throw error;
  }
}

const settings = { ...DEFAULT_SETTINGS, kerf: 3, maxRuntimeMs: 10000 };
const line = { name: 'Flyer', width: 100, height: 150, quantity: 60, notes: null, allowRotation: true, materialKey: null, grain: 'any', minWidth: null, minHeight: null };
const stockBody = { kind: 'sheet', name: 'Kuşe', formatName: null, width: 700, height: 500, quantity: 5, unitCost: 8, gsm: 135, color: 'Beyaz', finish: null, notes: null, allowRotation: true, grain: 'none', status: 'active' };

describe('routes on sql.js', () => {
  it('matches paths with parameters', () => {
    expect(matchRoute(routes, 'PUT', '/api/stock/12')?.params).toEqual({ id: '12' });
    expect(matchRoute(routes, 'POST', '/api/jobs/3/offcuts/9/add')?.params).toEqual({ id: '3', offcutId: '9' });
    expect(matchRoute(routes, 'GET', '/api/nope')).toBeNull();
  });

  it('runs the whole workflow: stock → preview (no change) → confirm → offcut → reuse → reset', async () => {
    const stock = await call<StockItemDto>('POST', '/api/stock', stockBody);
    expect(stock.materialKey).toBe('kuşe|135|beyaz|');

    const run = await call<RunDto>('POST', '/api/optimize', { orderId: null, lines: [line], settings });
    expect(run.result.plans.length).toBeGreaterThan(0);
    expect((await call<StockItemDto[]>('GET', '/api/stock'))[0]!.quantity).toBe(5);

    const plan = run.result.plans[0]!;
    const job = await call<JobDto>('POST', `/api/runs/${run.id}/confirm`, { planId: plan.id, approvedOffcuts: [] });
    expect((await call<StockItemDto[]>('GET', '/api/stock'))[0]!.quantity).toBe(5 - plan.totals.sheetCount);
    expect(job.offcuts.every((o) => o.status === 'pending')).toBe(true);

    // Double confirmation is refused.
    const again = await call<{ status: number }>('POST', `/api/runs/${run.id}/confirm`, { planId: plan.id, approvedOffcuts: [] }, [409]);
    expect(again.status).toBe(409);

    const biggest = [...job.offcuts].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
    const after = await call<JobDto>('POST', `/api/jobs/${job.id}/offcuts/${biggest.id}/add`, {});
    expect(after.offcuts.find((o) => o.id === biggest.id)!.status).toBe('added');
    expect((await call<StockItemDto[]>('GET', '/api/stock')).some((s) => s.kind === 'offcut')).toBe(true);

    await call('POST', '/api/admin/reset', { confirm: 'TUM-VERILERI-SIL' });
    expect(await call<unknown[]>('GET', '/api/stock')).toHaveLength(0);
    expect(await call<unknown[]>('GET', '/api/jobs')).toHaveLength(0);
  });

  it('deleting an order removes its lines through the foreign-key cascade', async () => {
    const order = await call<{ id: number }>('POST', '/api/orders', { name: 'S', notes: null, lines: [line, { ...line, name: 'B' }] });
    await call('DELETE', `/api/orders/${order.id}`);
    const left = raw.exec('SELECT COUNT(*) FROM order_lines')[0]!.values[0]![0];
    expect(left).toBe(0);
  });

  it('survives export / re-import of the database file (what IndexedDB persistence does)', async () => {
    await call('POST', '/api/stock', stockBody);
    const bytes = raw.export();
    raw.run('PRAGMA foreign_keys = ON');
    const SQL = await initSqlJs();
    const reopened = new SQL.Database(bytes);
    const routes2 = buildRoutes(adaptSqlJs(reopened), inlineOptimizer);
    const found = matchRoute(routes2, 'GET', '/api/stock')!;
    const res = await found.route.handler({ params: {}, body: undefined, signal: new AbortController().signal });
    expect((res.body as StockItemDto[]).map((s) => s.name)).toEqual(['Kuşe']);
  });

  it('seeds realistic sample data into an empty database', async () => {
    seedIfEmpty(adaptSqlJs(raw));
    const stock = await call<StockItemDto[]>('GET', '/api/stock');
    expect(stock.length).toBeGreaterThanOrEqual(5);
    const orders = await call<Array<{ lines: unknown[] }>>('GET', '/api/orders');
    expect(orders.length).toBe(2);
  });
});

describe('artwork previews', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('stores an image, keeps it on the order line and carries it into the run input', async () => {
    const art = await call<{ id: string; data: string }>('POST', '/api/artworks', { data: png });
    expect((await call<{ data: string }>('GET', `/api/artworks/${art.id}`)).data).toBe(png);

    const order = await call<{ id: number; lines: Array<{ artworkId: string | null }> }>('POST', '/api/orders', { name: 'Çizimli', notes: null, lines: [{ ...line, artworkId: art.id }, line] });
    expect(order.lines.map((l) => l.artworkId)).toEqual([art.id, null]);

    await call('POST', '/api/stock', stockBody);
    const run = await call<RunDto>('POST', '/api/optimize', { orderId: order.id, lines: order.lines, settings });
    expect(run.input.pieces.map((p) => p.artworkId)).toEqual([art.id, null]);
  });

  it('rejects anything that is not an image data URL and ignores malformed ids', async () => {
    expect((await call<{ status: number }>('POST', '/api/artworks', { data: 'javascript:alert(1)' }, [400])).status).toBe(400);
    expect((await call<{ status: number }>('POST', '/api/artworks', { data: 'data:image/svg+xml;base64,PHN2Zz4=' }, [400])).status).toBe(400);
    expect((await call<{ status: number }>('GET', '/api/artworks/00000000-0000-0000-0000-000000000000', undefined, [404])).status).toBe(404);
    const order = await call<{ lines: Array<{ artworkId: string | null }> }>('POST', '/api/orders', { name: 'X', notes: null, lines: [{ ...line, artworkId: '../etc' }] });
    expect(order.lines[0]!.artworkId).toBeNull();
  });

  it('adds the artwork column to databases from older releases', async () => {
    const SQL = await initSqlJs();
    const old = new SQL.Database();
    old.exec(SCHEMA.replace(',\n  artwork_id TEXT', ''));
    old.exec("INSERT INTO orders (name, status, created_at, updated_at) VALUES ('Eski', 'draft', 'x', 'x')");
    old.exec("INSERT INTO order_lines (order_id, position, name, width, height, quantity) VALUES (1, 0, 'Flyer', 100, 150, 5)");
    const db = adaptSqlJs(old);
    initSchema(db);
    initSchema(db); // idempotent
    routes = buildRoutes(db, inlineOptimizer);
    const orders = await call<Array<{ lines: Array<{ name: string; artworkId: string | null }> }>>('GET', '/api/orders');
    expect(orders[0]!.lines[0]).toMatchObject({ name: 'Flyer', artworkId: null });
  });
});
