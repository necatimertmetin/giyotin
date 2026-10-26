import { Worker } from 'node:worker_threads';
import { optimize, type OptimizationInput, type OptimizationResult } from '../src/engine';

/** Runs an optimisation; rejects when `signal` is aborted. */
export type Optimizer = (input: OptimizationInput, signal: AbortSignal) => Promise<OptimizationResult>;

/** Runs on the calling thread (used by tests). */
export const inlineOptimizer: Optimizer = (input, signal) =>
  new Promise((resolve, reject) => {
    try {
      const result = optimize(input, {
        cancel: {
          get cancelled() {
            return signal.aborted;
          },
        },
      });
      resolve(result);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });

/** Runs in a worker thread so the HTTP server stays responsive; aborting terminates the worker. */
export const workerOptimizer: Optimizer = (input, signal) =>
  new Promise((resolve, reject) => {
    const ext = import.meta.url.endsWith('.ts') ? 'ts' : 'mjs';
    const worker = new Worker(new URL(`./optimizeWorker.${ext}`, import.meta.url), { workerData: input });
    const onAbort = (): void => {
      void worker.terminate();
      reject(new Error('Optimizasyon iptal edildi.'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (result: OptimizationResult) => {
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    });
    worker.once('error', (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    worker.once('exit', (code) => {
      signal.removeEventListener('abort', onAbort);
      if (code !== 0) reject(new Error(`Optimizasyon işlemi beklenmedik şekilde sonlandı (${code}).`));
    });
  });
