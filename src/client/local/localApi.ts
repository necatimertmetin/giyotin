import initSqlJs, { type Database } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { buildRoutes, matchRoute, type Route } from '../../../server/routes';
import { initSchema } from '../../../server/schema';
import { HttpError } from '../../../server/services';
import type { Optimizer } from '../../../server/optimizeRunner';
import type { OptimizationResult } from '../../engine';
import { adaptSqlJs } from './sqlAdapter';

/**
 * Browser-only backend (GitHub Pages build): the same route handlers as the server run in-process on an
 * sql.js (SQLite compiled to WebAssembly) database, which is saved to IndexedDB after every change.
 */

const IDB_NAME = 'giyotin';
const IDB_STORE = 'files';
const IDB_KEY = 'database';

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB açılamadı.'));
  });
}

async function loadBytes(): Promise<Uint8Array | null> {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Okunamadı.'));
    });
  } catch {
    return null;
  }
}

async function saveBytes(bytes: Uint8Array): Promise<void> {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Kaydedilemedi.'));
  });
}

const browserOptimizer: Optimizer = (input, signal) =>
  new Promise<OptimizationResult>((resolve, reject) => {
    const worker = new Worker(new URL('./optimizeWorker.ts', import.meta.url), { type: 'module' });
    const onAbort = (): void => {
      worker.terminate();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<OptimizationResult>) => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      reject(new Error(event.message || 'Optimizasyon çalışamadı.'));
    };
    worker.postMessage(input);
  });

interface Ctx {
  routes: Route[];
  persistSoon: () => void;
  prune: () => void;
}

let ctxPromise: Promise<Ctx> | null = null;

async function init(): Promise<Ctx> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await loadBytes();
  const raw: Database = saved ? new SQL.Database(saved) : new SQL.Database();
  raw.run('PRAGMA foreign_keys = ON');
  const db = adaptSqlJs(raw);
  initSchema(db);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = (): void => {
    // export() reopens the database, which resets pragmas.
    const bytes = raw.export();
    raw.run('PRAGMA foreign_keys = ON');
    void saveBytes(bytes);
  };
  persist();

  return {
    routes: buildRoutes(db, browserOptimizer),
    persistSoon: () => {
      clearTimeout(timer);
      timer = setTimeout(persist, 300);
    },
    // Unconfirmed previews pile up; keep the latest few so the stored database stays small.
    prune: () => {
      db.exec(
        `DELETE FROM optimization_runs WHERE confirmed_job_id IS NULL AND id NOT IN
           (SELECT id FROM optimization_runs WHERE confirmed_job_id IS NULL ORDER BY created_at DESC LIMIT 8)`,
      );
    },
  };
}

export async function localRequest<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  ctxPromise ??= init();
  const ctx = await ctxPromise;
  const found = matchRoute(ctx.routes, method, url.split('?')[0]!);
  if (!found) throw new Error('Bulunamadı.');
  const abort = signal ?? new AbortController().signal;
  try {
    const result = await found.route.handler({ params: found.params, body, signal: abort });
    if (abort.aborted) throw new DOMException('Aborted', 'AbortError');
    if (result.status >= 400) throw new Error((result.body as { message?: string } | undefined)?.message ?? 'İstek başarısız oldu.');
    if (method !== 'GET') {
      if (url === '/api/optimize') ctx.prune();
      ctx.persistSoon();
    }
    return result.body as T;
  } catch (error) {
    if (error instanceof HttpError) throw new Error(error.message);
    if (error instanceof DOMException) throw error;
    console.error(error);
    throw error instanceof Error ? error : new Error('Beklenmeyen bir hata oluştu.');
  }
}
