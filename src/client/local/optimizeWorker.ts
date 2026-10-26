import { optimize, type OptimizationInput } from '../../engine';

/** Browser worker: runs the optimiser off the UI thread (the browser-only build has no server). */
self.onmessage = (event: MessageEvent<OptimizationInput>): void => {
  (self as unknown as Worker).postMessage(optimize(event.data));
};
