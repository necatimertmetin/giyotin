import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `vite build --mode pages` produces the browser-only build for GitHub Pages (served under /giyotin/).
export default defineConfig(({ mode }) => ({
  root: 'src/client',
  base: mode === 'pages' ? '/giyotin/' : '/',
  plugins: [react()],
  build: {
    outDir: mode === 'pages' ? '../../dist/pages' : '../../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
  server: { port: 5173, proxy: { '^/api/': 'http://localhost:3001' } },
  preview: { port: 3222 },
}));
