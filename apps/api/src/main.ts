import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocketPlugin from '@fastify/websocket';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { bootstrapIngestion } from '@supercharts/ingestion';
import { openDB } from './db';
import { marketRoutes } from './routes/market';
import { drawingRoutes } from './routes/drawings';
import { layoutRoutes } from './routes/layouts';
import { watchlistRoutes } from './routes/watchlists';
import { newsRoutes } from './routes/news';
import { billingRoutes } from './routes/billing';
import { alertRoutes } from './routes/alerts';
import { preferenceRoutes } from './routes/preferences';
import { mt5Routes } from './routes/mt5';
import { signalRoutes } from './routes/signals';
import { indicatorRoutes } from './routes/indicators';
import { registerWebSocketGateway } from './ws-gateway';
import { MT5Store, startMT5Bridge, createIntentRouter } from './mt5';
import { createSignalRunner } from './mt5/signal-runner';
import type { SignalRecipe } from '@supercharts/types';
import { AlertEngine } from './alert-engine';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '127.0.0.1';
const MT5_BRIDGE_PORT = Number(process.env.MT5_BRIDGE_PORT ?? 7878);
// MT5 EAs typically connect from the same host; default loopback. Set MT5_BRIDGE_HOST
// to 0.0.0.0 only when the bridge must accept connections from other machines.
const MT5_BRIDGE_HOST = process.env.MT5_BRIDGE_HOST ?? '127.0.0.1';

async function start(): Promise<void> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 4 * 1024 * 1024,
  });

  // Pin allowed origins. Default to NEXT_PUBLIC_APP_URL; allow extra comma-separated
  // origins via CORS_ORIGINS for staging/preview deploys. Reflecting any origin with
  // `credentials: true` is a CSRF foot-gun, so we never do that here.
  const allowedOrigins = new Set<string>(
    [
      process.env.NEXT_PUBLIC_APP_URL,
      ...(process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()) ?? []),
    ].filter((s): s is string => Boolean(s && s.length > 0)),
  );
  await app.register(cors, {
    origin: (origin, cb) => {
      // Server-to-server / curl / same-origin (no Origin header) → allow.
      if (!origin) return cb(null, true);
      if (allowedOrigins.size === 0 || allowedOrigins.has(origin)) return cb(null, true);
      return cb(new Error(`origin_not_allowed:${origin}`), false);
    },
    credentials: true,
  });
  await app.register(cookie);
  // Global rate limit is intentionally generous; the Stripe webhook is exempt so
  // upstream retries are never dropped.
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/api/billing/webhook'),
  });
  await app.register(websocketPlugin, {
    options: {
      maxPayload: 1024 * 1024,
    },
  });

  const db = openDB(process.env);
  const ingestion = await bootstrapIngestion(process.env);

  // Warm popular markets so the first user gets data instantly.
  for (const symbol of ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT']) {
    ingestion.subscriptions.acquire({ symbol, kind: 'candles', interval: '1m' });
    ingestion.subscriptions.acquire({ symbol, kind: 'trades' });
    ingestion.subscriptions.acquire({ symbol, kind: 'orderbook' });
  }

  // MT5 bridge + intent router + signal runner
  const mt5Store = new MT5Store();
  const mt5Bridge = await startMT5Bridge({
    port: MT5_BRIDGE_PORT,
    host: MT5_BRIDGE_HOST,
    store: mt5Store,
    log: (msg, level = 'info') => app.log[level](msg),
  });
  const intentRouter = createIntentRouter({ bridge: mt5Bridge, store: mt5Store });
  mt5Store.on('event', (e) => {
    if (e.kind === 'tick') intentRouter.onTick(e.accountId, e.tick);
    if (e.kind === 'positions')
      intentRouter.onPositionsSnapshot(e.accountId, e.positions);
  });
  const signalRunner = createSignalRunner({ ingestion, router: intentRouter, store: mt5Store });
  const recipeRows = db.raw
    .prepare(
      'SELECT id, user_id, account_id, symbol, interval, enabled, name, payload, created_at, updated_at FROM signal_recipes WHERE enabled = 1',
    )
    .all() as Array<{
    id: string; user_id: string; account_id: string; symbol: string; interval: string;
    enabled: number; name: string; payload: string; created_at: number; updated_at: number;
  }>;
  const recipes: SignalRecipe[] = recipeRows.map((row) => {
    const payload = JSON.parse(row.payload) as Pick<
      SignalRecipe,
      'logic' | 'conditions' | 'actions' | 'maxTradesPerDay' | 'maxDailyDrawdownPercent'
    >;
    return {
      ...payload,
      id: row.id,
      userId: row.user_id,
      accountId: row.account_id,
      symbol: row.symbol,
      interval: row.interval,
      enabled: row.enabled === 1,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  signalRunner.load(recipes);

  app.get('/api/health', async () => ({
    ok: true,
    serverTime: Date.now(),
    providers: ingestion.subscriptions.health(),
    mt5BridgePort: MT5_BRIDGE_PORT,
  }));

  marketRoutes(app, ingestion);
  drawingRoutes(app, db);
  layoutRoutes(app, db);
  watchlistRoutes(app, db);
  newsRoutes(app, db, process.env);
  billingRoutes(app, db, process.env);
  preferenceRoutes(app, db);
  mt5Routes(app, db, mt5Store, intentRouter);
  signalRoutes(app, db, signalRunner);
  indicatorRoutes(app, db);
  const wsBroadcaster = registerWebSocketGateway(app, ingestion, mt5Store);

  // Alert engine — needs the WS broadcaster, so register routes AFTER the gateway is up.
  const alertEngine = new AlertEngine({
    db,
    ctx: ingestion,
    broadcast: (userId, event) => wsBroadcaster.broadcastAlertFired(userId, event),
  });
  alertEngine.load();
  alertRoutes(app, db, alertEngine);

  app.addHook('onClose', async () => {
    alertEngine.shutdown();
    signalRunner.shutdown();
    await mt5Bridge.close();
  });

  await app.listen({ host: HOST, port: PORT });
  app.log.info(`SuperCharts API listening on ${HOST}:${PORT}`);
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[api] fatal', err);
  process.exit(1);
});
