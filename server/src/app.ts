import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import type { AppConfig } from './config.js';
import { createPrismaClient } from './lib/prisma.js';
import { ApiError, errorHandler } from './lib/errors.js';
import { requireTrustedJson } from './middleware/request-security.js';
import { SESSION_LIFETIME_MS } from './middleware/auth.js';
import { authRouter, COOKIE_SCOPE, SESSION_COOKIE_NAME } from './routes/auth.js';
import { inquiriesRouter } from './routes/inquiries.js';

export function createApp(config: AppConfig) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  // Include authentication, origin and JSON-parser failures in the cache policy.
  app.use('/api', (_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  // Liveness only; no database query.
  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
  app.use('/api', requireTrustedJson(config.trustedOrigins));
  app.use(express.json({ limit: '32kb' }));
  const schemaName = new URL(config.databaseUrl).searchParams.get('schema') ?? 'public';
  const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });
  pool.on('error', () => console.error('Session database connection failed.'));
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool, schemaName, tableName: 'session', createTableIfMissing: false,
    disableTouch: true,
    errorLog: () => console.error('Session persistence failed.'),
  });
  const prisma = createPrismaClient(config.databaseUrl);
  app.use('/api', session({
    name: SESSION_COOKIE_NAME,
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    cookie: { ...COOKIE_SCOPE, maxAge: SESSION_LIFETIME_MS, secure: config.production ? true : 'auto' },
  }));
  app.use('/api/auth', authRouter(prisma));
  app.use('/api/inquiries', inquiriesRouter(prisma));
  app.use((_request, _response, next) => next(new ApiError(404, 'NOT_FOUND', 'Endpoint not found.')));
  app.use(errorHandler);
  return {
    app,
    async close() {
      await store.close();
      await Promise.all([pool.end(), prisma.$disconnect()]);
    },
  };
}
