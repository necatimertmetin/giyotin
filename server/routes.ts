import type { ConfirmRequest, OptimizeRequest } from '../src/shared/api';
import type { Optimizer } from './optimizeRunner';
import type { Db } from './schema';
import * as svc from './services';

/**
 * The API as a plain route table. Fastify registers these on the server; the browser-only build calls the very
 * same handlers in-process (see src/client/local), so both builds share one implementation.
 */
export interface RouteRequest {
  params: Record<string, string>;
  body: unknown;
  signal: AbortSignal;
}

export interface RouteResult {
  status: number;
  body?: unknown;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: (req: RouteRequest) => Promise<RouteResult> | RouteResult;
}

const idParam = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new svc.HttpError(400, 'Geçersiz kimlik.');
  return n;
};

const ok = (body: unknown): RouteResult => ({ status: 200, body });
const created = (body: unknown): RouteResult => ({ status: 201, body });
const noContent = (): RouteResult => ({ status: 204 });

export function buildRoutes(db: Db, optimizer: Optimizer): Route[] {
  const b = <T>(req: RouteRequest): T => (req.body ?? {}) as T;

  return [
    // Papers & settings
    { method: 'GET', path: '/api/papers', handler: () => ok(svc.listPapers(db)) },
    { method: 'POST', path: '/api/papers', handler: (r) => created(svc.savePaper(db, r.body as never)) },
    { method: 'PUT', path: '/api/papers/:id', handler: (r) => ok(svc.savePaper(db, r.body as never, idParam(r.params.id))) },
    { method: 'DELETE', path: '/api/papers/:id', handler: (r) => (svc.deletePaper(db, idParam(r.params.id)), noContent()) },
    { method: 'GET', path: '/api/settings', handler: () => ok(svc.getSettings(db)) },
    { method: 'PUT', path: '/api/settings', handler: (r) => ok(svc.saveSettings(db, r.body)) },

    // Settings profiles
    { method: 'GET', path: '/api/profiles', handler: () => ok(svc.listProfiles(db)) },
    {
      method: 'POST',
      path: '/api/profiles',
      handler: (r) => {
        const body = b<{ name?: unknown; settings?: unknown }>(r);
        return created(svc.saveProfile(db, body.name, body.settings));
      },
    },
    { method: 'DELETE', path: '/api/profiles/:id', handler: (r) => (svc.deleteProfile(db, idParam(r.params.id)), noContent()) },

    // Danger zone
    { method: 'POST', path: '/api/admin/reset', handler: (r) => (svc.resetAllData(db, b<{ confirm?: unknown }>(r).confirm), noContent()) },

    // Stock
    { method: 'GET', path: '/api/stock', handler: () => ok(svc.listStock(db)) },
    { method: 'POST', path: '/api/stock', handler: (r) => created(svc.createStock(db, r.body as never)) },
    { method: 'PUT', path: '/api/stock/:id', handler: (r) => ok(svc.updateStock(db, idParam(r.params.id), r.body as never)) },
    { method: 'DELETE', path: '/api/stock/:id', handler: (r) => (svc.deleteStock(db, idParam(r.params.id)), noContent()) },

    // Orders
    { method: 'GET', path: '/api/orders', handler: () => ok(svc.listOrders(db)) },
    { method: 'GET', path: '/api/orders/:id', handler: (r) => ok(svc.getOrder(db, idParam(r.params.id))) },
    { method: 'POST', path: '/api/orders', handler: (r) => created(svc.saveOrder(db, r.body as never)) },
    { method: 'PUT', path: '/api/orders/:id', handler: (r) => ok(svc.saveOrder(db, r.body as never, idParam(r.params.id))) },
    { method: 'DELETE', path: '/api/orders/:id', handler: (r) => (svc.deleteOrder(db, idParam(r.params.id)), noContent()) },

    // Optimisation preview: never mutates stock.
    {
      method: 'POST',
      path: '/api/optimize',
      handler: async (r) => {
        const body = b<Partial<OptimizeRequest>>(r);
        const lines = svc.parseLines(body.lines);
        const settings = svc.parseSettings(body.settings);
        const { input, versions } = svc.buildOptimizationInput(db, lines, settings);
        const orderName = body.orderId ? svc.getOrder(db, body.orderId).name : 'Adsız sipariş';
        try {
          const result = await optimizer(input, r.signal);
          return ok(svc.saveRun(db, { orderId: body.orderId ?? null, orderName, settings, input, versions, result }));
        } catch (error) {
          if (r.signal.aborted) return { status: 499, body: { message: 'Optimizasyon iptal edildi.' } };
          throw error;
        }
      },
    },
    { method: 'GET', path: '/api/runs/:id', handler: (r) => ok(svc.getRun(db, r.params.id!)) },
    {
      method: 'POST',
      path: '/api/runs/:id/confirm',
      handler: (r) => {
        const body = b<Partial<ConfirmRequest>>(r);
        if (typeof body.planId !== 'string') throw new svc.HttpError(400, 'Plan seçilmedi.');
        const approved = Array.isArray(body.approvedOffcuts) ? body.approvedOffcuts.filter((x): x is string => typeof x === 'string') : [];
        return created(svc.confirmRun(db, r.params.id!, { planId: body.planId, approvedOffcuts: approved }));
      },
    },

    // Jobs / history
    { method: 'GET', path: '/api/jobs', handler: () => ok(svc.listJobs(db)) },
    { method: 'GET', path: '/api/jobs/:id', handler: (r) => ok(svc.getJob(db, idParam(r.params.id))) },
    {
      method: 'POST',
      path: '/api/jobs/:id/offcuts/:offcutId/add',
      handler: (r) => {
        const notes = b<{ notes?: unknown }>(r).notes;
        return ok(svc.addJobOffcut(db, idParam(r.params.id), idParam(r.params.offcutId), typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 500) : null));
      },
    },
    { method: 'POST', path: '/api/jobs/:id/offcuts/:offcutId/discard', handler: (r) => ok(svc.discardJobOffcut(db, idParam(r.params.id), idParam(r.params.offcutId))) },
  ];
}

/** Find the route for a request line such as `PUT /api/stock/3`; `params` holds the `:name` segments. */
export function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const fits = pattern.every((seg, i) => {
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = decodeURIComponent(parts[i]!);
        return true;
      }
      return seg === parts[i];
    });
    if (fits) return { route, params };
  }
  return null;
}
