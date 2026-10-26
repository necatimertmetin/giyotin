import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Optimizer } from './optimizeRunner';
import { buildRoutes } from './routes';
import type { Db } from './schema';
import { HttpError } from './services';

export interface AppOptions {
  db: Db;
  optimizer: Optimizer;
  /** Directory with the built client; when it exists it is served with an SPA fallback. */
  staticDir?: string;
}

export function createApp({ db, optimizer, staticDir }: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) return reply.status(error.status).send({ message: error.message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ message: 'İstek geçersiz.' });
    console.error(error);
    return reply.status(500).send({ message: 'Beklenmeyen bir sunucu hatası oluştu.' });
  });

  for (const route of buildRoutes(db, optimizer)) {
    app.route({
      method: route.method,
      url: route.path,
      handler: async (req, reply) => {
        // The client went away (e.g. pressed "İptal") before the response was written.
        const controller = new AbortController();
        let done = false;
        reply.raw.on('close', () => {
          if (!done) controller.abort();
        });
        try {
          const result = await route.handler({ params: req.params as Record<string, string>, body: req.body, signal: controller.signal });
          return reply.status(result.status).send(result.body);
        } finally {
          done = true;
        }
      },
    });
  }

  if (staticDir && existsSync(staticDir)) {
    void app.register(fastifyStatic, { root: resolve(staticDir) });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ message: 'Bulunamadı.' });
    });
  }
  return app;
}
