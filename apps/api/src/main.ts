import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocketPlugin from '@fastify/websocket';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { bootstrapIngestion } from '@supercharts/ingestion';
import { openDB } from './db';
import { marketRoutes } from './routes/market';
import { scannerRoutes } from './routes/scanner';
import { drawingRoutes } from './routes/drawings';
import { layoutRoutes } from './routes/layouts';
import { scriptRoutes } from './routes/scripts';
import { oandaRoutes } from './routes/oanda';
import { watchlistRoutes } from './routes/watchlists';
import { newsRoutes } from './routes/news';
import { calendarRoutes } from './routes/calendar';
import { customDataRoutes, seedCustomDatasets } from './routes/custom-data';
import { webhookRoutes } from './routes/webhooks';
import { shareRoutes } from './routes/share';
import { broadcastRoutes } from './routes/broadcast';
import { billingRoutes } from './routes/billing';
import { alertRoutes } from './routes/alerts';
import { preferenceRoutes } from './routes/preferences';
import { mt5Routes } from './routes/mt5';
import { signalRoutes } from './routes/signals';
import { indicatorRoutes } from './routes/indicators';
import { futuresRoutes } from './routes/futures';
import { registerWebSocketGateway } from './ws-gateway';
import { registerDemoGuard } from './demo-guard';
import { createDrawdownBreaker } from './dd-breaker';
import { breakerRoutes } from './routes/breaker';
import { sendTelegramMessage } from './telegram';
import { MT5Store, startMT5Bridge, createIntentRouter } from './mt5';
import { createSignalRunner } from './mt5/signal-runner';
import type { SignalRecipe, Interval } from '@supercharts/types';
import { AlertEngine } from './alert-engine';
import { loadEnvFile } from './env';

loadEnvFile();

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

  // Read-only demo guard (no-op unless DEMO_MODE is set). Runs before every route, so it
  // must be registered before the route plugins below.
  registerDemoGuard(app, process.env);

  const db = openDB(process.env);
  // If the user connected OANDA via the in-app wizard, those saved (already-verified) creds
  // drive the live forex feed — overriding env. Otherwise bootstrap falls back to env → Yahoo.
  const oandaRow = db.raw
    .prepare('SELECT api_token, account_id, oanda_env FROM oanda_credentials ORDER BY verified_at DESC LIMIT 1')
    .get() as { api_token: string; account_id: string; oanda_env: string } | undefined;
  const ingestionEnv = oandaRow
    ? { ...process.env, OANDA_API_TOKEN: oandaRow.api_token, OANDA_ACCOUNT_ID: oandaRow.account_id, OANDA_ENV: oandaRow.oanda_env }
    : process.env;
  const ingestion = await bootstrapIngestion(ingestionEnv);

  // Re-seed any user-imported CSV datasets (Phase 3 #14) into the live candle store so the
  // CUSTOM: symbols chart immediately after a restart.
  const seededDatasets = seedCustomDatasets(db, ingestion);
  if (seededDatasets > 0) app.log.info(`[custom-data] seeded ${seededDatasets} dataset(s)`);

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
  // Max-drawdown breaker (#10): halts signal recipes when the day's paper P&L breaches the
  // limit. P&L source is swappable; today it's the paper book (realised closed-today % +
  // open unrealized %). Halting only ADDS a skip gate — recipes are never deleted.
  const computeDailyPnlPct = (dayStart: number): number => {
    const realised = (
      db.raw
        .prepare(
          `SELECT COALESCE(SUM(pnl_percent), 0) v FROM paper_trades
           WHERE status = 'closed' AND pnl_percent IS NOT NULL AND exit_time >= ?`,
        )
        .get(dayStart) as { v: number }
    ).v;
    const opens = db.raw
      .prepare(`SELECT symbol, interval, side, entry_price as entryPrice FROM paper_trades WHERE status = 'open'`)
      .all() as { symbol: string; interval: string; side: 'buy' | 'sell'; entryPrice: number }[];
    let unreal = 0;
    for (const o of opens) {
      const c = ingestion.candleStore.query(o.symbol, o.interval as Interval, undefined, undefined, 1);
      const last = c[c.length - 1];
      if (!last || o.entryPrice <= 0) continue;
      unreal +=
        o.side === 'buy'
          ? ((last.close - o.entryPrice) / o.entryPrice) * 100
          : ((o.entryPrice - last.close) / o.entryPrice) * 100;
    }
    return realised + unreal;
  };
  const ddBreaker = createDrawdownBreaker({
    computeDailyPnlPct,
    limitPct: Number(process.env.DD_LIMIT_PCT ?? 5),
    enabled: process.env.DD_BREAKER_ENABLED !== 'false',
    onTrip: (status) => {
      app.log.warn(`[breaker] tripped — ${status.reason}`);
      try {
        const bot = db.raw
          .prepare(
            `SELECT bot_token as botToken, chat_id as chatId FROM telegram_bots
             WHERE enabled = 1 ORDER BY created_at ASC LIMIT 1`,
          )
          .get() as { botToken: string; chatId: string } | undefined;
        if (bot) {
          void sendTelegramMessage({
            botToken: bot.botToken,
            chatId: bot.chatId,
            text: `🛑 <b>Max-drawdown breaker tripped</b>\nDaily P&amp;L ${status.dailyPnlPct.toFixed(2)}% ≤ −${status.limitPct}% limit. New automation paused until manual resume or the next UTC day.`,
          });
        }
      } catch (err) {
        app.log.error({ err }, '[breaker] alert send failed');
      }
    },
  });

  const signalRunner = createSignalRunner({
    ingestion,
    router: intentRouter,
    store: mt5Store,
    shouldHalt: () => ddBreaker.isHalted(),
  });
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
  scannerRoutes(app, ingestion);
  drawingRoutes(app, db);
  layoutRoutes(app, db);
  scriptRoutes(app, db);
  oandaRoutes(app, db);
  watchlistRoutes(app, db);
  newsRoutes(app, db, process.env);
  calendarRoutes(app);
  customDataRoutes(app, db, ingestion);
  webhookRoutes(app, db);
  shareRoutes(app, db);
  broadcastRoutes(app, db);
  billingRoutes(app, db, process.env);
  preferenceRoutes(app, db);
  mt5Routes(app, db, mt5Store, intentRouter);
  signalRoutes(app, db, signalRunner);
  indicatorRoutes(app, db);
  futuresRoutes(app);
  const wsBroadcaster = registerWebSocketGateway(app, ingestion, mt5Store);

  // Alert engine — needs the WS broadcaster, so register routes AFTER the gateway is up.
  const alertEngine = new AlertEngine({
    db,
    ctx: ingestion,
    broadcast: (userId, event) => wsBroadcaster.broadcastAlertFired(userId, event),
  });
  alertEngine.load();
  alertRoutes(app, db, alertEngine, ingestion);
  breakerRoutes(app, db, ddBreaker);

  // Poll the breaker so it trips + auto-resets at the UTC boundary even without traffic.
  const breakerTimer = setInterval(() => {
    try {
      ddBreaker.check();
    } catch (err) {
      app.log.error({ err }, '[breaker] check failed');
    }
  }, 60_000);

  app.addHook('onClose', async () => {
    clearInterval(breakerTimer);
    alertEngine.shutdown();
    signalRunner.shutdown();
    await mt5Bridge.close();
  });

  await app.listen({ host: HOST, port: PORT });
  app.log.info(`SuperCharts API listening on ${HOST}:${PORT}`);
}

start().catch((err) => {
   
  console.error('[api] fatal', err);
  process.exit(1);
});
