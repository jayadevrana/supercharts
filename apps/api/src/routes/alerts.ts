import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import type { AlertDefinition, AlertEvent, Interval, MaCrossAlertConfig } from '@supercharts/types';
import { INTERVALS, INTERVAL_MS as INTERVAL_TO_MS, SYMBOL_CATALOG } from '@supercharts/types';
import type { IngestionContext } from '@supercharts/ingestion';
import type { AlertEngine } from '../alert-engine';
import { discoverTelegramChats, getTelegramBotInfo, sendTelegramMessage } from '../telegram';
import { runMaCrossBacktest } from '../backtester';
import { runOptimizer, type OptimizeRequest } from '../optimizer';
import { runWalkForward, type WalkForwardRequest } from '../walk-forward';

const INTERVAL_SET = new Set<Interval>(INTERVALS);

const maCrossConfigSchema = z.object({
  ma: z.object({
    type: z.enum(['sma', 'ema', 'rma', 'wma']),
    length: z.coerce.number().int().min(2).max(500),
    source: z.enum(['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4']),
  }),
  crossWith: z
    .object({
      type: z.enum(['sma', 'ema', 'rma', 'wma']),
      length: z.coerce.number().int().min(2).max(500),
    })
    .optional(),
  rsiFilter: z
    .object({
      length: z.coerce.number().int().min(2).max(100),
      buyBelow: z.coerce.number().min(0).max(100),
      sellAbove: z.coerce.number().min(0).max(100),
    })
    .optional(),
  labels: z.object({
    buy: z.string().min(1).max(32).default('BUY'),
    sell: z.string().min(1).max(32).default('SELL'),
  }),
  delivery: z.object({
    web: z.boolean().default(true),
    telegram: z.boolean().default(false),
    telegramBotId: z.string().optional(),
  }),
  timezone: z.string().min(2).max(40).default('UTC'),
  style: z
    .object({
      lineColor: z.string().optional(),
      lineWidth: z.number().optional(),
      buyColor: z.string().optional(),
      sellColor: z.string().optional(),
      slowLineColor: z.string().optional(),
    })
    .optional(),
});

const alertCreateSchema = z.object({
  symbol: z.string().min(1),
  interval: z.string().refine((v) => INTERVAL_SET.has(v as Interval)),
  type: z.literal('ma_cross'),
  enabled: z.boolean().default(true),
  config: maCrossConfigSchema,
});

const alertUpdateSchema = z.object({
  symbol: z.string().min(1).optional(),
  interval: z.string().refine((v) => INTERVAL_SET.has(v as Interval)).optional(),
  enabled: z.boolean().optional(),
  config: maCrossConfigSchema.optional(),
});

const telegramConfigSchema = z.object({
  botToken: z.string().min(20).max(120),
  chatId: z.string().min(1).max(64),
  enabled: z.boolean().default(true),
});

const telegramBotCreateSchema = z.object({
  label: z.string().min(1).max(64),
  botToken: z.string().min(20).max(120),
  chatId: z.string().min(1).max(64),
  enabled: z.boolean().default(true),
});

const telegramBotUpdateSchema = z.object({
  label: z.string().min(1).max(64).optional(),
  botToken: z.string().min(20).max(120).optional(),
  chatId: z.string().min(1).max(64).optional(),
  enabled: z.boolean().optional(),
});

interface TelegramBotRow {
  id: string;
  label: string;
  botToken: string;
  chatId: string;
  enabled: number;
  createdAt: number;
  updatedAt: number;
}

interface TelegramConfigRow {
  botToken: string;
  chatId: string;
  enabled: number;
  updatedAt: number;
}

function rowToAlert(r: {
  id: string; userId: string; symbol: string; interval: string; type: string; config: string;
  enabled: number; lastFiredAt: number | null; createdAt: number; updatedAt: number;
}): AlertDefinition {
  return {
    id: r.id,
    userId: r.userId,
    symbol: r.symbol,
    interval: r.interval as Interval,
    type: r.type as 'ma_cross',
    enabled: r.enabled === 1,
    config: JSON.parse(r.config) as MaCrossAlertConfig,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastFiredAt: r.lastFiredAt ?? undefined,
  };
}

export function alertRoutes(
  fastify: FastifyInstance,
  db: AppDB,
  engine: AlertEngine,
  ctx: IngestionContext,
): void {
  /* ─── List alerts ─── */
  fastify.get('/api/alerts', async (req) => {
    const user = getUser(req, db);
    const rows = db.raw
      .prepare(
        `SELECT id, user_id as userId, symbol_id as symbol, interval, type, config,
                enabled, last_fired_at as lastFiredAt, created_at as createdAt, updated_at as updatedAt
         FROM alerts WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .all(user.id) as Array<{
      id: string; userId: string; symbol: string; interval: string; type: string;
      config: string; enabled: number; lastFiredAt: number | null;
      createdAt: number; updatedAt: number;
    }>;
    return { items: rows.map(rowToAlert) };
  });

  /* ─── Create alert ─── */
  fastify.post('/api/alerts', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = alertCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }
    const id = nanoid();
    const now = Date.now();
    db.raw
      .prepare(
        `INSERT INTO alerts (id, user_id, symbol_id, interval, type, config, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.id,
        parsed.data.symbol,
        parsed.data.interval,
        parsed.data.type,
        JSON.stringify(parsed.data.config),
        parsed.data.enabled ? 1 : 0,
        now,
        now,
      );
    const alert: AlertDefinition = {
      id,
      userId: user.id,
      symbol: parsed.data.symbol,
      interval: parsed.data.interval as Interval,
      type: 'ma_cross',
      enabled: parsed.data.enabled,
      config: parsed.data.config as MaCrossAlertConfig,
      createdAt: now,
      updatedAt: now,
    };
    if (alert.enabled) engine.subscribe(alert);
    return alert;
  });

  /* ─── Update alert ─── */
  fastify.put('/api/alerts/:id', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const parsed = alertUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }
    const now = Date.now();
    const existing = db.raw
      .prepare(
        `SELECT id, user_id as userId, symbol_id as symbol, interval, type, config,
                enabled, last_fired_at as lastFiredAt, created_at as createdAt, updated_at as updatedAt
         FROM alerts WHERE id = ? AND user_id = ?`,
      )
      .get(id, user.id) as
      | {
          id: string; userId: string; symbol: string; interval: string; type: string;
          config: string; enabled: number; lastFiredAt: number | null;
          createdAt: number; updatedAt: number;
        }
      | undefined;
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const next: AlertDefinition = {
      id: existing.id,
      userId: existing.userId,
      symbol: parsed.data.symbol ?? existing.symbol,
      interval: (parsed.data.interval ?? existing.interval) as Interval,
      type: 'ma_cross',
      enabled: parsed.data.enabled ?? existing.enabled === 1,
      config: (parsed.data.config ?? JSON.parse(existing.config)) as MaCrossAlertConfig,
      createdAt: existing.createdAt,
      updatedAt: now,
      lastFiredAt: existing.lastFiredAt ?? undefined,
    };
    db.raw
      .prepare(
        `UPDATE alerts SET symbol_id = ?, interval = ?, config = ?, enabled = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(next.symbol, next.interval, JSON.stringify(next.config), next.enabled ? 1 : 0, now, id, user.id);
    // Always re-subscribe so the engine picks up the new config (or unsubscribes when disabled).
    engine.subscribe(next);
    return next;
  });

  /**
   * Bulk-subscribe: create the same MA-cross alert across every catalog symbol that
   * doesn't already have one at this (interval, type) tuple. Idempotent — running it
   * twice never duplicates, never overwrites custom alerts the user already tuned.
   *
   * Returns the count of created vs. skipped so the UI can show a meaningful toast.
   */
  fastify.post('/api/alerts/bulk-subscribe', async (req, reply) => {
    const user = getUser(req, db);
    const schema = z.object({
      interval: z.string().refine((v) => INTERVAL_SET.has(v as Interval)),
      config: maCrossConfigSchema,
      /** Optional override — defaults to the full catalog. */
      symbols: z.array(z.string()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }
    const targets = parsed.data.symbols ?? SYMBOL_CATALOG.map((s) => s.id);
    // Pull every existing alert so we can skip duplicates without N round-trips.
    const existing = db.raw
      .prepare(
        `SELECT symbol_id as symbol, interval, type FROM alerts WHERE user_id = ?`,
      )
      .all(user.id) as Array<{ symbol: string; interval: string; type: string }>;
    const dupKey = (s: string, i: string, t: string): string => `${s}|${i}|${t}`;
    const have = new Set(existing.map((r) => dupKey(r.symbol, r.interval, r.type)));
    const created: AlertDefinition[] = [];
    const skipped: string[] = [];
    const now = Date.now();
    const insertStmt = db.raw.prepare(
      `INSERT INTO alerts (id, user_id, symbol_id, interval, type, config, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const sym of targets) {
      if (have.has(dupKey(sym, parsed.data.interval, 'ma_cross'))) {
        skipped.push(sym);
        continue;
      }
      const id = nanoid();
      insertStmt.run(
        id,
        user.id,
        sym,
        parsed.data.interval,
        'ma_cross',
        JSON.stringify(parsed.data.config),
        1,
        now,
        now,
      );
      const alert: AlertDefinition = {
        id,
        userId: user.id,
        symbol: sym,
        interval: parsed.data.interval as Interval,
        type: 'ma_cross',
        enabled: true,
        config: parsed.data.config as MaCrossAlertConfig,
        createdAt: now,
        updatedAt: now,
      };
      created.push(alert);
      engine.subscribe(alert);
    }
    return { created: created.length, skipped: skipped.length, items: created };
  });

  /* ─── Toggle enabled ─── */
  fastify.post('/api/alerts/:id/toggle', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const row = db.raw
      .prepare(
        `SELECT id, user_id as userId, symbol_id as symbol, interval, type, config,
                enabled, last_fired_at as lastFiredAt, created_at as createdAt, updated_at as updatedAt
         FROM alerts WHERE id = ? AND user_id = ?`,
      )
      .get(id, user.id) as
      | {
          id: string; userId: string; symbol: string; interval: string; type: string;
          config: string; enabled: number; lastFiredAt: number | null;
          createdAt: number; updatedAt: number;
        }
      | undefined;
    if (!row) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const nowEnabled = row.enabled === 1 ? 0 : 1;
    db.raw.prepare('UPDATE alerts SET enabled = ?, updated_at = ? WHERE id = ?').run(nowEnabled, Date.now(), id);
    const alert = rowToAlert({ ...row, enabled: nowEnabled });
    engine.subscribe(alert);
    return alert;
  });

  /* ─── Delete alert ─── */
  fastify.delete('/api/alerts/:id', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').run(id, user.id);
    db.raw.prepare('DELETE FROM alert_events WHERE alert_id = ? AND user_id = ?').run(id, user.id);
    engine.unsubscribe(id);
    return { ok: true };
  });

  /* ─── Backtest ─── */
  // Loads the alert's symbol+interval history from the candle store (fetching from
  // the provider when the cache is sparse), then runs `runMaCrossBacktest`. Results
  // are NOT persisted — backtests are cheap to recompute and live in the UI.
  fastify.post('/api/alerts/:id/backtest', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const row = db.raw
      .prepare(
        `SELECT id, user_id as userId, symbol_id as symbol, interval, type, config,
                enabled, last_fired_at as lastFiredAt, created_at as createdAt, updated_at as updatedAt
         FROM alerts WHERE id = ? AND user_id = ?`,
      )
      .get(id, user.id) as
      | {
          id: string; userId: string; symbol: string; interval: string; type: string;
          config: string; enabled: number; lastFiredAt: number | null;
          createdAt: number; updatedAt: number;
        }
      | undefined;
    if (!row) {
      reply.code(404);
      return { error: 'not_found' };
    }
    if (row.type !== 'ma_cross') {
      reply.code(400);
      return { error: 'unsupported_alert_type', message: 'Only ma_cross alerts can be backtested in v1.' };
    }
    const alertCfg: MaCrossAlertConfig = JSON.parse(row.config) as MaCrossAlertConfig;
    const interval = row.interval as Interval;
    const symbol = row.symbol;

    // Pull whatever is already in cache, then top up from the provider if we have
    // fewer than `desired` bars. Bounded so a single backtest can't blow the cache.
    const desired = 1000;
    let candles = ctx.candleStore.query(symbol, interval, undefined, undefined, desired);
    if (candles.length < desired) {
      const provider = resolveProvider(symbol, ctx);
      if (provider) {
        try {
          const now = Date.now();
          // Pull a window that's roughly `desired × stepMs` long.
          const intervalMs = INTERVAL_TO_MS[interval] ?? 60_000;
          const from = now - desired * intervalMs;
          const fetched = await provider.fetchHistoricalCandles(symbol, interval, from, now, desired);
          for (const c of fetched) ctx.candleStore.upsert(symbol, interval, c);
          candles = ctx.candleStore.query(symbol, interval, undefined, undefined, desired);
        } catch (err) {
          // Don't fail the backtest just because the provider blipped — run with what we have.
          // eslint-disable-next-line no-console
          console.warn('[backtest] candle fetch failed, running on cache:', err);
        }
      }
    }

    if (candles.length === 0) {
      reply.code(400);
      return { error: 'no_data', message: 'No candles available for this symbol/interval yet.' };
    }

    const result = runMaCrossBacktest(candles, alertCfg, interval);
    return {
      alertId: id,
      symbol,
      interval,
      barsTested: candles.length,
      first: candles[0]!.openTime,
      last: candles[candles.length - 1]!.openTime,
      ...result,
    };
  });

  /* ─── Optimizer ─── */
  // Grid sweep over MA fast/slow lengths (and RSI thresholds when the base config has
  // an rsiFilter). Reuses the same candle window as backtest. Returns top-N combos
  // ranked by composite Sharpe-minus-drawdown score.
  fastify.post('/api/alerts/:id/optimize', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const row = db.raw
      .prepare(
        `SELECT id, user_id as userId, symbol_id as symbol, interval, type, config
         FROM alerts WHERE id = ? AND user_id = ?`,
      )
      .get(id, user.id) as
      | { id: string; userId: string; symbol: string; interval: string; type: string; config: string }
      | undefined;
    if (!row) {
      reply.code(404);
      return { error: 'not_found' };
    }
    if (row.type !== 'ma_cross') {
      reply.code(400);
      return { error: 'unsupported_alert_type' };
    }
    const base = JSON.parse(row.config) as MaCrossAlertConfig;
    const interval = row.interval as Interval;
    const desired = 1000;
    let candles = ctx.candleStore.query(row.symbol, interval, undefined, undefined, desired);
    if (candles.length < desired) {
      const provider = resolveProvider(row.symbol, ctx);
      if (provider) {
        try {
          const now = Date.now();
          const intervalMs = INTERVAL_TO_MS[interval] ?? 60_000;
          const from = now - desired * intervalMs;
          const fetched = await provider.fetchHistoricalCandles(row.symbol, interval, from, now, desired);
          for (const c of fetched) ctx.candleStore.upsert(row.symbol, interval, c);
          candles = ctx.candleStore.query(row.symbol, interval, undefined, undefined, desired);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[optimize] candle fetch failed, running on cache:', err);
        }
      }
    }
    if (candles.length === 0) {
      reply.code(400);
      return { error: 'no_data' };
    }
    const sweep = (req.body ?? {}) as OptimizeRequest;
    const result = runOptimizer(candles, base, interval, sweep);
    return {
      alertId: id,
      symbol: row.symbol,
      interval,
      barsTested: candles.length,
      ...result,
    };
  });

  /* ─── Paper trading queries ─── */
  // List virtual trades for a single alert (open one first, then most-recent closed).
  fastify.get('/api/alerts/:id/paper-trades', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const own = db.raw
      .prepare('SELECT 1 FROM alerts WHERE id = ? AND user_id = ?')
      .get(id, user.id);
    if (!own) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 50), 500);
    const rows = db.raw
      .prepare(
        `SELECT id, alert_id as alertId, user_id as userId, symbol, interval, side, status,
                entry_time as entryTime, entry_price as entryPrice,
                exit_time as exitTime, exit_price as exitPrice,
                pnl_percent as pnlPercent, bars
         FROM paper_trades
         WHERE alert_id = ? AND user_id = ?
         ORDER BY status = 'open' DESC, entry_time DESC
         LIMIT ?`,
      )
      .all(id, user.id, limit);
    return { items: rows };
  });

  /** Aggregate paper-trading summary across every alert the user has paper-flagged. */
  fastify.get('/api/alerts/paper/summary', async (req) => {
    const user = getUser(req, db);
    const rows = db.raw
      .prepare(
        `SELECT alert_id as alertId,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closedTrades,
                SUM(CASE WHEN status = 'closed' AND pnl_percent > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN status = 'closed' AND pnl_percent <= 0 THEN 1 ELSE 0 END) as losses,
                COALESCE(SUM(CASE WHEN status = 'closed' THEN pnl_percent ELSE 0 END), 0) as totalReturnPct
         FROM paper_trades
         WHERE user_id = ?
         GROUP BY alert_id`,
      )
      .all(user.id) as Array<{
      alertId: string;
      closedTrades: number;
      wins: number;
      losses: number;
      totalReturnPct: number;
    }>;
    const openRows = db.raw
      .prepare(
        `SELECT id, alert_id as alertId, user_id as userId, symbol, interval, side,
                entry_time as entryTime, entry_price as entryPrice
         FROM paper_trades WHERE user_id = ? AND status = 'open'`,
      )
      .all(user.id) as Array<{
      id: string; alertId: string; userId: string; symbol: string; interval: string;
      side: 'buy' | 'sell'; entryTime: number; entryPrice: number;
    }>;
    const openByAlert = new Map(openRows.map((r) => [r.alertId, r]));
    return {
      items: rows.map((r) => ({
        alertId: r.alertId,
        closedTrades: r.closedTrades,
        wins: r.wins,
        losses: r.losses,
        winRate: r.closedTrades > 0 ? r.wins / r.closedTrades : 0,
        totalReturnPct: r.totalReturnPct,
        openPosition: openByAlert.get(r.alertId)
          ? { ...openByAlert.get(r.alertId)!, status: 'open' as const }
          : undefined,
      })),
    };
  });

  // Force-close every still-open paper position for an alert (or wipe history with
  // ?wipe=1). Helpful when the user wants to reset after parameter changes.
  fastify.post('/api/alerts/:id/paper/reset', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const wipe = (req.query as { wipe?: string }).wipe === '1';
    if (wipe) {
      db.raw
        .prepare('DELETE FROM paper_trades WHERE alert_id = ? AND user_id = ?')
        .run(id, user.id);
    } else {
      db.raw
        .prepare(
          `UPDATE paper_trades SET status = 'closed', exit_time = ?, exit_price = entry_price,
             pnl_percent = 0
           WHERE alert_id = ? AND user_id = ? AND status = 'open'`,
        )
        .run(Date.now(), id, user.id);
    }
    return { ok: true };
  });

  /* ─── Walk-forward analysis ─── */
  // Rolling train/test windows. On each train slice, run the optimizer; lock the
  // winning config; apply it to the immediately-following test slice; accumulate
  // out-of-sample equity. Robustness = oosSharpe / meanTrainSharpe (≈1 generalises).
  fastify.post('/api/alerts/:id/walk-forward', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const row = db.raw
      .prepare(
        `SELECT id, symbol_id as symbol, interval, type, config FROM alerts WHERE id = ? AND user_id = ?`,
      )
      .get(id, user.id) as
      | { id: string; symbol: string; interval: string; type: string; config: string }
      | undefined;
    if (!row) {
      reply.code(404);
      return { error: 'not_found' };
    }
    if (row.type !== 'ma_cross') {
      reply.code(400);
      return { error: 'unsupported_alert_type' };
    }
    const base = JSON.parse(row.config) as MaCrossAlertConfig;
    const interval = row.interval as Interval;

    // Walk-forward needs more history than a single backtest. Pull ~1500 bars so we
    // get several train/test windows even at the default 250/60 split.
    const desired = 1500;
    let candles = ctx.candleStore.query(row.symbol, interval, undefined, undefined, desired);
    if (candles.length < desired) {
      const provider = resolveProvider(row.symbol, ctx);
      if (provider) {
        try {
          const now = Date.now();
          const intervalMs = INTERVAL_TO_MS[interval] ?? 60_000;
          const from = now - desired * intervalMs;
          const fetched = await provider.fetchHistoricalCandles(row.symbol, interval, from, now, desired);
          for (const c of fetched) ctx.candleStore.upsert(row.symbol, interval, c);
          candles = ctx.candleStore.query(row.symbol, interval, undefined, undefined, desired);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[walk-forward] candle fetch failed, running on cache:', err);
        }
      }
    }
    if (candles.length === 0) {
      reply.code(400);
      return { error: 'no_data' };
    }
    const wf = (req.body ?? {}) as WalkForwardRequest;
    const result = runWalkForward(candles, base, interval, wf);
    return {
      alertId: id,
      symbol: row.symbol,
      interval,
      barsTested: candles.length,
      ...result,
    };
  });

  /* ─── Recent events / history ─── */
  fastify.get('/api/alerts/events', async (req) => {
    const user = getUser(req, db);
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 50), 500);
    const rows = db.raw
      .prepare(
        `SELECT id, alert_id as alertId, user_id as userId, side, symbol, interval,
                bar_time as barTime, price, ma_value as maValue, label, fired_at as firedAt,
                telegram, telegram_error as telegramError
         FROM alert_events WHERE user_id = ? ORDER BY fired_at DESC LIMIT ?`,
      )
      .all(user.id, limit) as AlertEvent[];
    return { items: rows };
  });

  /** Delete a single fire log entry. */
  fastify.delete('/api/alerts/events/:id', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM alert_events WHERE id = ? AND user_id = ?').run(id, user.id);
    return { ok: true };
  });

  /**
   * Wipe the entire fire history for this user. The optional `alertId` query param
   * scopes the wipe to one alert; without it, every event the user owns is removed.
   * The alerts themselves remain enabled — only the log is cleared.
   */
  fastify.delete('/api/alerts/events', async (req) => {
    const user = getUser(req, db);
    const alertId = (req.query as { alertId?: string }).alertId;
    if (alertId) {
      db.raw
        .prepare('DELETE FROM alert_events WHERE user_id = ? AND alert_id = ?')
        .run(user.id, alertId);
    } else {
      db.raw.prepare('DELETE FROM alert_events WHERE user_id = ?').run(user.id);
    }
    return { ok: true };
  });

  /* ─── Telegram config ─── */
  fastify.get('/api/alerts/telegram', async (req) => {
    const user = getUser(req, db);
    const row = db.raw
      .prepare(
        'SELECT bot_token as botToken, chat_id as chatId, enabled, updated_at as updatedAt FROM telegram_configs WHERE user_id = ?',
      )
      .get(user.id) as TelegramConfigRow | undefined;
    if (!row) return { configured: false, enabled: false };
    return {
      configured: true,
      enabled: row.enabled === 1,
      botTokenSuffix: row.botToken.slice(-4),
      chatId: row.chatId,
      updatedAt: row.updatedAt,
    };
  });

  fastify.post('/api/alerts/telegram', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = telegramConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }
    // Validate the token actually works before saving — much better UX than a silent
    // failure on first fire.
    try {
      await getTelegramBotInfo(parsed.data.botToken);
    } catch (err) {
      reply.code(400);
      return {
        error: 'telegram_token_invalid',
        message: err instanceof Error ? err.message : 'invalid_bot_token',
      };
    }
    const now = Date.now();
    db.raw
      .prepare(
        `INSERT INTO telegram_configs (user_id, bot_token, chat_id, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           bot_token = excluded.bot_token,
           chat_id   = excluded.chat_id,
           enabled   = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(user.id, parsed.data.botToken, parsed.data.chatId, parsed.data.enabled ? 1 : 0, now);
    return {
      configured: true,
      enabled: parsed.data.enabled,
      botTokenSuffix: parsed.data.botToken.slice(-4),
      chatId: parsed.data.chatId,
      updatedAt: now,
    };
  });

  fastify.delete('/api/alerts/telegram', async (req) => {
    const user = getUser(req, db);
    db.raw.prepare('DELETE FROM telegram_configs WHERE user_id = ?').run(user.id);
    return { ok: true };
  });

  /**
   * Auto-detect chat ID via `getUpdates`. Accepts either the bot token in the body
   * (for the "Save" form, before credentials are persisted) OR uses the saved token
   * when the body is empty (so users can re-detect later without re-typing).
   */
  fastify.post('/api/alerts/telegram/discover-chat', async (req, reply) => {
    const user = getUser(req, db);
    const body = (req.body ?? {}) as { botToken?: string };
    let botToken = body.botToken;
    if (!botToken) {
      const row = db.raw
        .prepare('SELECT bot_token as botToken FROM telegram_configs WHERE user_id = ?')
        .get(user.id) as { botToken: string } | undefined;
      botToken = row?.botToken;
    }
    if (!botToken) {
      reply.code(400);
      return { error: 'no_bot_token' };
    }
    try {
      const chats = await discoverTelegramChats(botToken);
      if (chats.length === 0) {
        reply.code(404);
        return {
          error: 'no_chats_yet',
          message:
            'Open Telegram and send any message (e.g. /start) to your bot first, then try again.',
        };
      }
      return { chats };
    } catch (err) {
      reply.code(400);
      return {
        error: 'telegram_discover_failed',
        message: err instanceof Error ? err.message : 'unknown',
      };
    }
  });

  fastify.post('/api/alerts/telegram/test', async (req, reply) => {
    const user = getUser(req, db);
    const row = db.raw
      .prepare(
        'SELECT bot_token as botToken, chat_id as chatId FROM telegram_configs WHERE user_id = ?',
      )
      .get(user.id) as { botToken: string; chatId: string } | undefined;
    if (!row) {
      reply.code(400);
      return { error: 'telegram_not_configured' };
    }
    try {
      await sendTelegramMessage({
        botToken: row.botToken,
        chatId: row.chatId,
        text: '✅ <b>SuperCharts</b> · test message\nYour Telegram alert channel is live.',
      });
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: 'telegram_send_failed', message: err instanceof Error ? err.message : 'unknown' };
    }
  });

  /* ─── Multi-bot CRUD ─── */
  // List all bots for this user. Tokens never leak — only a 4-char suffix surfaces.
  fastify.get('/api/alerts/telegram/bots', async (req) => {
    const user = getUser(req, db);
    const rows = db.raw
      .prepare(
        `SELECT id, label, bot_token as botToken, chat_id as chatId, enabled,
                created_at as createdAt, updated_at as updatedAt
         FROM telegram_bots WHERE user_id = ? ORDER BY created_at ASC`,
      )
      .all(user.id) as TelegramBotRow[];
    return {
      items: rows.map((r) => ({
        id: r.id,
        label: r.label,
        botTokenSuffix: r.botToken.slice(-4),
        chatId: r.chatId,
        enabled: r.enabled === 1,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  });

  fastify.post('/api/alerts/telegram/bots', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = telegramBotCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }
    // Validate the token via getMe before saving — catches typos at write time so the
    // user finds out immediately, not on the first crossover fire days later.
    try {
      await getTelegramBotInfo(parsed.data.botToken);
    } catch (err) {
      reply.code(400);
      return {
        error: 'telegram_token_invalid',
        message: err instanceof Error ? err.message : 'invalid_bot_token',
      };
    }
    const id = `tb_${nanoid(12)}`;
    const now = Date.now();
    db.raw
      .prepare(
        `INSERT INTO telegram_bots (id, user_id, label, bot_token, chat_id, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, user.id, parsed.data.label, parsed.data.botToken, parsed.data.chatId, parsed.data.enabled ? 1 : 0, now, now);
    return {
      id,
      label: parsed.data.label,
      botTokenSuffix: parsed.data.botToken.slice(-4),
      chatId: parsed.data.chatId,
      enabled: parsed.data.enabled,
      createdAt: now,
      updatedAt: now,
    };
  });

  fastify.put('/api/alerts/telegram/bots/:id', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const parsed = telegramBotUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }
    const existing = db.raw
      .prepare(
        `SELECT id, label, bot_token as botToken, chat_id as chatId, enabled,
                created_at as createdAt, updated_at as updatedAt
         FROM telegram_bots WHERE id = ? AND user_id = ?`,
      )
      .get(id, user.id) as TelegramBotRow | undefined;
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const next = {
      label: parsed.data.label ?? existing.label,
      botToken: parsed.data.botToken ?? existing.botToken,
      chatId: parsed.data.chatId ?? existing.chatId,
      enabled: parsed.data.enabled ?? existing.enabled === 1,
    };
    if (parsed.data.botToken && parsed.data.botToken !== existing.botToken) {
      try {
        await getTelegramBotInfo(parsed.data.botToken);
      } catch (err) {
        reply.code(400);
        return {
          error: 'telegram_token_invalid',
          message: err instanceof Error ? err.message : 'invalid_bot_token',
        };
      }
    }
    const now = Date.now();
    db.raw
      .prepare(
        `UPDATE telegram_bots SET label = ?, bot_token = ?, chat_id = ?, enabled = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(next.label, next.botToken, next.chatId, next.enabled ? 1 : 0, now, id, user.id);
    return {
      id,
      label: next.label,
      botTokenSuffix: next.botToken.slice(-4),
      chatId: next.chatId,
      enabled: next.enabled,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
  });

  fastify.delete('/api/alerts/telegram/bots/:id', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM telegram_bots WHERE id = ? AND user_id = ?').run(id, user.id);
    return { ok: true };
  });

  fastify.post('/api/alerts/telegram/bots/:id/test', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const row = db.raw
      .prepare(
        'SELECT label, bot_token as botToken, chat_id as chatId FROM telegram_bots WHERE id = ? AND user_id = ?',
      )
      .get(id, user.id) as { label: string; botToken: string; chatId: string } | undefined;
    if (!row) {
      reply.code(404);
      return { error: 'not_found' };
    }
    try {
      await sendTelegramMessage({
        botToken: row.botToken,
        chatId: row.chatId,
        text: `✅ <b>SuperCharts</b> · ${row.label}\nThis bot is wired correctly and will receive alerts.`,
      });
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: 'telegram_send_failed', message: err instanceof Error ? err.message : 'unknown' };
    }
  });

  /** Auto-detect chat ID for a bot token that hasn't been saved yet (used by Add Bot flow). */
  fastify.post('/api/alerts/telegram/bots/discover-chat', async (req, reply) => {
    const body = (req.body ?? {}) as { botToken?: string };
    if (!body.botToken) {
      reply.code(400);
      return { error: 'no_bot_token' };
    }
    try {
      const chats = await discoverTelegramChats(body.botToken);
      if (chats.length === 0) {
        reply.code(404);
        return {
          error: 'no_chats_yet',
          message:
            'Open Telegram and send any message (e.g. /start) to your bot first, then try again.',
        };
      }
      return { chats };
    } catch (err) {
      reply.code(400);
      return {
        error: 'telegram_discover_failed',
        message: err instanceof Error ? err.message : 'unknown',
      };
    }
  });
}

// Mirror of the routes/market.ts helper. Kept inline so this module is self-contained
// against the ingestion provider map.
function resolveProvider(symbol: string, ctx: IngestionContext) {
  const venue = symbol.split(':')[0]?.toLowerCase();
  if (!venue) return null;
  switch (venue) {
    case 'binance':
      return ctx.providers.binance;
    case 'oanda':
      return ctx.providers.oanda;
    case 'mock':
      return ctx.providers.mock;
    default:
      return null;
  }
}
