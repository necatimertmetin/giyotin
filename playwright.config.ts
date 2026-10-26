import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3111;

// Every run gets its own database file; leftovers of earlier runs are removed when possible.
mkdirSync('data', { recursive: true });
for (const f of readdirSync('data')) {
  if (f.startsWith('e2e-')) {
    try {
      rmSync(`data/${f}`, { force: true });
    } catch {
      /* still locked by a running server; ignore */
    }
  }
}
const DB = `data/e2e-${process.pid}-${Date.now()}.db`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: { width: 1440, height: 900 } },
  projects: [
    { name: 'chromium', testIgnore: /pages\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // The browser-only build (GitHub Pages): no API server, data lives in the browser.
    { name: 'pages', testMatch: /pages\.spec/, use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3222/giyotin/', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: 'node dist/server/index.mjs',
      url: `http://localhost:${PORT}/api/settings`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { PORT: String(PORT), DB_PATH: DB, SEED: '0' },
    },
    {
      command: 'npx vite preview --mode pages --port 3222 --strictPort',
      url: 'http://localhost:3222/giyotin/',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
