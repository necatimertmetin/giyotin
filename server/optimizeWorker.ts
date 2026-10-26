import { parentPort, workerData } from 'node:worker_threads';
import { optimize, type OptimizationInput } from '../src/engine';

if (parentPort) parentPort.postMessage(optimize(workerData as OptimizationInput));
