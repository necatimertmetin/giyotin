import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { openDb } from './db';
import { workerOptimizer } from './optimizeRunner';
import { seedIfEmpty } from './seed';

const root = resolve(dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.ts') ? '..' : '../..');
const dbPath = process.env.DB_PATH ?? resolve(root, 'data', 'giyotin.db');
const port = Number(process.env.PORT ?? 3001);

const db = openDb(dbPath);
if (process.env.SEED !== '0') seedIfEmpty(db);

const app = createApp({ db, optimizer: workerOptimizer, staticDir: resolve(root, 'dist', 'client') });
app
  .listen({ port, host: process.env.HOST ?? '0.0.0.0' })
  .then(() => console.log(`Giyotin Kesim sunucusu hazır: http://localhost:${port}  (veritabanı: ${dbPath})`))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
