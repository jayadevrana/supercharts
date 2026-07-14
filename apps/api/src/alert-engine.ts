import type {
  AlertDefinition,
  AlertEvent,
  Candle,
  IndicatorAlertConfig,
  IndicatorAlertDefinition,
  Interval,
  MaCrossAlertConfig,
  MaCrossAlertDefinition,
} from '@supercharts/types';
import type { IngestionContext } from '@supercharts/ingestion';
import { INTERVAL_MS } from '@supercharts/types';
import { computeMaCross, pickSource, rsi as rsiSeries } from '@supercharts/chart-core/pure';
import { nanoid } from 'nanoid';
import { collectIndicatorRefs, evaluateConditionSet } from './signal-eval';
import type { AlertOrderExecutor } from './broker/alert-order-executor';
import type { AppDB } from './db';
import {
  sendTelegramMessage,
  sendTelegramPhoto,
  type TelegramSender,
  type TelegramPhotoSender,
} from './telegram';
import { renderMaCrossChart } from './alert-chart';

/**
 * Server-side MA cross alert engine.
 *
 * Lifecycle:
 *   - `load()` reads all enabled alerts and starts a per-alert subscriber.
 *   - When a candle event lands for the alert's (symbol, interval) AND the candle is
 *     closed AND the bar's openTime is newer than the alert's lastFiredAt, we run the
 *     crossover check against the latest N+1 candles from the candleStore.
 *   - On a fire: persist to `alert_events`, send Telegram (if configured), broadcast
 *     to the user's WS connections, update `alerts.last_fired_at`.
 *
 * Dedup contract: `alert_events.UNIQUE (alert_id, bar_time)` is the hard floor. Even
 * if the process restarts mid-fire, the unique constraint guarantees the operator
 * never receives a duplicate Telegram for the same bar.
 */

export type WebBroadcaster = (userId: string, event: AlertEvent) => void;

interface ActiveSubscription {
  alert: AlertDefinition;
  off: () => void;
}

export interface AlertEngineOptions {
  db: AppDB;
  ctx: IngestionContext;
  broadcast: WebBroadcaster;
  /** Override the telegram sender for tests. */
  telegram?: TelegramSender;
  /** Override the telegram photo sender for tests. */
  telegramPhoto?: TelegramPhotoSender;
  /**
   * GW-7 broker-order automation. When present, an alert carrying a `delivery.brokerOrder` config
   * routes a position-flip market order through the audited broker pipeline on each fire. Omitted
   * (the default / test path) → the engine never touches a broker, so legacy alerts are untouched.
   */
  brokerOrderExecutor?: AlertOrderExecutor;
}

export class AlertEngine {
  private readonly db: AppDB;
  private readonly ctx: IngestionContext;
  private readonly broadcast: WebBroadcaster;
  private readonly telegram: TelegramSender;
  private readonly telegramPhoto: TelegramPhotoSender;
  private readonly brokerOrderExecutor?: AlertOrderExecutor;
  private subs = new Map<string, ActiveSubscription>();
  /** Alert ids that should be active. Guards the async backfill→listen race. */
  private wanted = new Set<string>();

  constructor(opts: AlertEngineOptions) {
    this.db = opts.db;
    this.ctx = opts.ctx;
    this.broadcast = opts.broadcast;
    this.telegram = opts.telegram ?? sendTelegramMessage;
    this.telegramPhoto = opts.telegramPhoto ?? sendTelegramPhoto;
    this.brokerOrderExecutor = opts.brokerOrderExecutor;
  }

  /**
   * GW-7 fire-and-forget broker automation. Mirrors Telegram delivery: fully isolated so a broker
   * failure can never break the alert fire, the paper book, or the live feed. Only runs when the
   * alert opted into `delivery.brokerOrder` AND an executor is wired (prod). Errors are logged.
   */
  private automateBrokerOrder(
    alert: AlertDefinition,
    event: AlertEvent,
    placedVia: 'alert' | 'indicator',
  ): void {
    const brokerOrder = alert.config.delivery.brokerOrder;
    if (!brokerOrder || !this.brokerOrderExecutor) return;
    // GW-7 polish (b): send an order-fill Telegram note ONLY when the alert opted into Telegram
    // delivery — the fill note rides the user's existing choice, so it's never a surprise message.
    const notify = alert.config.delivery.telegram
      ? { telegramBotId: alert.config.delivery.telegramBotId }
      : undefined;
    void this.brokerOrderExecutor
      .execute({ userId: alert.userId, alertId: alert.id, side: event.side, config: brokerOrder, placedVia, notify })
      .then((outcome) => {
        if (outcome.status === 'error') {

          console.error('[alert-engine] broker order failed', { alertId: alert.id, outcome });
        }
      })
      .catch((err) => {

        console.error('[alert-engine] broker order executor threw', { alertId: alert.id, err });
      });
  }

  /** Boot from DB: subscribe every enabled alert. */
  load(): void {
    const rows = this.db.raw
      .prepare(
        `SELECT id, user_id as userId, symbol_id as symbol, interval, type, config,
                enabled, last_fired_at as lastFiredAt, created_at as createdAt, updated_at as updatedAt
         FROM alerts WHERE enabled = 1`,
      )
      .all() as Array<{
      id: string; userId: string; symbol: string; interval: string; type: string;
      config: string; enabled: number; lastFiredAt: number | null;
      createdAt: number; updatedAt: number;
    }>;
    for (const row of rows) {
      const base = {
        id: row.id,
        userId: row.userId,
        symbol: row.symbol,
        interval: row.interval as Interval,
        enabled: row.enabled === 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastFiredAt: row.lastFiredAt ?? undefined,
      };
      if (row.type === 'ma_cross') {
        this.subscribe({ ...base, type: 'ma_cross', config: JSON.parse(row.config) as MaCrossAlertConfig });
      } else if (row.type === 'indicator') {
        this.subscribe({ ...base, type: 'indicator', config: JSON.parse(row.config) as IndicatorAlertConfig });
      }
      // Unknown types are ignored — forward-compatible with future detectors.
    }
  }

  /** Add or replace a subscription. */
  subscribe(alert: AlertDefinition): void {
    if (!alert.enabled) {
      this.unsubscribe(alert.id);
      return;
    }
    this.unsubscribe(alert.id);
    this.wanted.add(alert.id);
    // Acquire the underlying market-data stream so candles flow into the store.
    this.ctx.subscriptions.acquire({ symbol: alert.symbol, kind: 'candles', interval: alert.interval });
    // Backfill history + seed the watermark BEFORE wiring the listener so we never
    // replay pre-existing crosses as live alerts (the cold-start flood bug). Until
    // init resolves, no candle events are processed for this alert.
    if (alert.type === 'indicator') void this.initIndicatorSubscription(alert);
    else void this.initSubscription(alert);
  }

  /**
   * One-time per-subscription init:
   *   1. Backfill enough closed bars into the store so the MAs are computed on real
   *      history, not the handful a poll has accumulated (garbage-cross bug).
   *   2. Seed `lastFiredAt` to the newest stored bar so ONLY bars that close AFTER we
   *      start watching can fire. This kills the boot flood (81 events/sec) where the
   *      Yahoo poll emitted a batch of recent bars and each replayed as a "live" cross.
   *   3. Wire the candle listener.
   */
  private async initSubscription(alert: MaCrossAlertDefinition): Promise<void> {
    const longestMa = Math.max(alert.config.ma.length, alert.config.crossWith?.length ?? 0);
    const want = Math.max(longestMa * 3 + 50, 150);
    try {
      const have = this.ctx.candleStore.query(alert.symbol, alert.interval, undefined, undefined, want);
      if (have.length < want) {
        const provider = this.resolveProvider(alert.symbol);
        if (provider) {
          const now = Date.now();
          const stepMs = INTERVAL_MS[alert.interval] ?? 60_000;
          const bars = await provider.fetchHistoricalCandles(
            alert.symbol,
            alert.interval,
            now - want * stepMs,
            now,
            want,
          );
          for (const c of bars) this.ctx.candleStore.upsert(alert.symbol, alert.interval, c);
        }
      }
    } catch (err) {
       
      console.warn('[alert-engine] backfill failed, seeding from cache only', { alertId: alert.id, err });
    }

    // The subscription may have been removed/replaced while we awaited the backfill —
    // bail without wiring a listener if so.
    if (!this.wanted.has(alert.id)) return;

    // Seed the watermark to the newest bar currently in the store. Never lower a
    // persisted lastFiredAt (so a real prior fire still dedups across restarts).
    const recent = this.ctx.candleStore.query(alert.symbol, alert.interval, undefined, undefined, 2);
    const newestOpen = recent.length ? recent[recent.length - 1]!.openTime : 0;
    alert.lastFiredAt = Math.max(alert.lastFiredAt ?? 0, newestOpen);

    const off = this.ctx.bus.onSymbol('candle', alert.symbol, (e) => {
      if (e.interval !== alert.interval) return;
      if (!e.data.isClosed) return;
      // Only fire on bars strictly newer than the watermark — no replay.
      if (alert.lastFiredAt !== undefined && e.data.openTime <= alert.lastFiredAt) return;
      this.evaluate(alert, e.data).catch((err) => {
         
        console.error('[alert-engine] evaluate failed', { alertId: alert.id, err });
      });
    });
    this.subs.set(alert.id, { alert, off });
  }

  /** Resolve the data provider for a symbol by venue prefix. */
  private resolveProvider(symbol: string) {
    const venue = symbol.split(':')[0]?.toLowerCase();
    if (venue === 'binance') return this.ctx.providers.binance;
    if (venue === 'oanda') return this.ctx.providers.oanda;
    if (venue === 'mock') return this.ctx.providers.mock;
    return null;
  }

  unsubscribe(alertId: string): void {
    this.wanted.delete(alertId);
    const sub = this.subs.get(alertId);
    if (!sub) return;
    sub.off();
    this.ctx.subscriptions.release({ symbol: sub.alert.symbol, kind: 'candles', interval: sub.alert.interval });
    this.subs.delete(alertId);
  }

  shutdown(): void {
    for (const id of this.subs.keys()) this.unsubscribe(id);
  }

  /** Run the MA-cross detector for one just-closed candle. */
  private async evaluate(alert: MaCrossAlertDefinition, justClosed: Candle): Promise<void> {
    // Need enough closed candles for BOTH legs to warm up. Size off the longer of the
    // fast/slow MA lengths — using only ma.length under-fed the slow EMA on dual-MA
    // alerts with a long slow leg (e.g. EMA(50)/EMA(200)) and produced garbage crosses.
    const longestMa = Math.max(alert.config.ma.length, alert.config.crossWith?.length ?? 0);
    const needed = longestMa * 3 + 5;
    const recent = this.ctx.candleStore.query(
      alert.symbol,
      alert.interval,
      undefined,
      undefined,
      Math.max(needed, 100),
    );
    if (recent.length < 2) return;

    // Make sure the just-closed candle is included in the slice. The store update is
    // synchronous in the bus chain, so this is normally fine, but defensive: append if
    // the cache snapshot lags behind by one bar.
    if (recent[recent.length - 1]!.openTime !== justClosed.openTime) {
      recent.push(justClosed);
    }

    // Pass through `crossWith` so dual-MA alerts (e.g. EMA 5 × EMA 10) compare the two
    // MAs instead of the price-vs-MA. The detector switches modes based on this field.
    const { ma, crosses } = computeMaCross(recent, {
      ...alert.config.ma,
      crossWith: alert.config.crossWith,
    });
    if (crosses.length === 0) return;
    const last = crosses[crosses.length - 1]!;
    // Only fire if the crossover is on the bar that just closed.
    if (last.time !== justClosed.openTime) return;

    const side: 'buy' | 'sell' = last.side;
    const sourcePrice = pickSource(justClosed, alert.config.ma.source);
    const maValue = ma[ma.length - 1]!;
    const label = side === 'buy' ? alert.config.labels.buy : alert.config.labels.sell;

    // Optional RSI gate. Computed only when configured so we don't pay the cost
    // on every cross for the (common) gate-less alerts.
    let rsiValue: number | undefined;
    if (alert.config.rsiFilter) {
      const closes = recent.map((c) => c.close);
      const series = rsiSeries(closes, alert.config.rsiFilter.length);
      const v = series[series.length - 1];
      if (!Number.isFinite(v!)) return; // warmup window — don't fire
      rsiValue = v!;
      if (side === 'buy' && rsiValue > alert.config.rsiFilter.buyBelow) return;
      if (side === 'sell' && rsiValue < alert.config.rsiFilter.sellAbove) return;
    }

    const event: AlertEvent = {
      id: nanoid(),
      alertId: alert.id,
      userId: alert.userId,
      side,
      symbol: alert.symbol,
      interval: alert.interval,
      barTime: justClosed.openTime,
      price: sourcePrice,
      maValue,
      label,
      firedAt: Date.now(),
      telegram: alert.config.delivery.telegram ? null : 'disabled',
      rsiValue,
    };

    // Persist first — the DB unique index is the dedup floor.
    try {
      this.db.raw
        .prepare(
          `INSERT INTO alert_events
             (id, alert_id, user_id, side, symbol, interval, bar_time, price, ma_value, label, fired_at, telegram)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.alertId,
          event.userId,
          event.side,
          event.symbol,
          event.interval,
          event.barTime,
          event.price,
          event.maValue,
          event.label,
          event.firedAt,
          // Persist the initial telegram status ('disabled' for web-only alerts, null
          // when a send is pending). markTelegram() overwrites with sent/failed after
          // the actual send attempt. (rsiValue is intentionally not persisted yet.)
          event.telegram ?? null,
        );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint/i.test(msg)) {
        // Already fired for this bar. Stay idempotent.
        return;
      }
      throw err;
    }
    alert.lastFiredAt = event.barTime;
    this.db.raw
      .prepare('UPDATE alerts SET last_fired_at = ?, updated_at = ? WHERE id = ?')
      .run(event.barTime, Date.now(), alert.id);

    // Paper-trading book-keeping: open a virtual position on every fire; if a prior
    // position is still open for this alert, close + flip it first. Pure book-keeping
    // — no MT5 round-trip — so it stays consistent across restarts.
    if (alert.config.delivery.paper) {
      this.bookPaperTrade(alert, event);
    }

    // Broadcast to web (toast + chart marker) regardless of telegram config.
    if (alert.config.delivery.web) {
      this.broadcast(alert.userId, event);
    }

    // GW-7: opt-in broker-order automation (position flip). Fire-and-forget, fully gated.
    this.automateBrokerOrder(alert, event, 'alert');

    // Telegram delivery — prefer the explicitly-chosen bot id, fall back to the
    // user's first enabled telegram_bots row, fall back further to the legacy
    // singleton telegram_configs row for backwards compat.
    if (alert.config.delivery.telegram) {
      const chosenId = alert.config.delivery.telegramBotId;
      let cfg:
        | { botToken: string; chatId: string; enabled: number }
        | undefined;
      if (chosenId) {
        cfg = this.db.raw
          .prepare(
            'SELECT bot_token as botToken, chat_id as chatId, enabled FROM telegram_bots WHERE id = ? AND user_id = ?',
          )
          .get(chosenId, alert.userId) as
          | { botToken: string; chatId: string; enabled: number }
          | undefined;
      }
      if (!cfg) {
        cfg = this.db.raw
          .prepare(
            `SELECT bot_token as botToken, chat_id as chatId, enabled FROM telegram_bots
             WHERE user_id = ? AND enabled = 1 ORDER BY created_at ASC LIMIT 1`,
          )
          .get(alert.userId) as
          | { botToken: string; chatId: string; enabled: number }
          | undefined;
      }
      if (!cfg) {
        // Legacy singleton fallback.
        cfg = this.db.raw
          .prepare(
            'SELECT bot_token as botToken, chat_id as chatId, enabled FROM telegram_configs WHERE user_id = ?',
          )
          .get(alert.userId) as
          | { botToken: string; chatId: string; enabled: number }
          | undefined;
      }
      if (!cfg || cfg.enabled !== 1) {
        this.markTelegram(event.id, 'disabled');
        return;
      }
      const text = formatTelegramMessage(event, alert.config);
      // Render the crossover chart so each alert is self-proving — the trader sees the
      // exact bar that crossed (same `computeMaCross` math as the fire). Rendering is
      // best-effort: any failure degrades to a text-only send so an alert is never lost.
      let photo: Buffer | null = null;
      try {
        const providerId = this.resolveProvider(alert.symbol)?.id;
        photo = renderMaCrossChart({
          symbol: alert.symbol,
          interval: alert.interval,
          candles: recent,
          ma: { ...alert.config.ma, crossWith: alert.config.crossWith },
          cross: { index: last.index, side, price: sourcePrice, time: justClosed.openTime },
          labels: alert.config.labels,
          rsiValue,
          sourceNote: providerId ? providerId[0]!.toUpperCase() + providerId.slice(1) : undefined,
        });
      } catch (err) {
         
        console.warn('[alert-engine] chart render failed; sending text only', { alertId: alert.id, err });
      }
      try {
        if (photo) {
          await this.telegramPhoto({ botToken: cfg.botToken, chatId: cfg.chatId, photo, caption: text });
        } else {
          await this.telegram({ botToken: cfg.botToken, chatId: cfg.chatId, text });
        }
        this.markTelegram(event.id, 'sent');
      } catch (err) {
        // Photo upload failed — try a plain text send before marking the alert failed.
        if (photo) {
          try {
            await this.telegram({ botToken: cfg.botToken, chatId: cfg.chatId, text });
            this.markTelegram(event.id, 'sent');
            return;
          } catch {
            /* fall through to failed below */
          }
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.markTelegram(event.id, 'failed', msg);
      }
    }
  }

  /* ─── Indicator-condition alerts (M5) ─── */

  /** Per-subscription init for an indicator alert — backfill, watermark, listen. Mirrors the
   *  ma_cross init but sizes history off the largest referenced indicator length. */
  private async initIndicatorSubscription(alert: IndicatorAlertDefinition): Promise<void> {
    const lengths = (alert.config.indicatorSpecs ?? []).flatMap((s) =>
      Object.values(s.inputs).filter((v): v is number => typeof v === 'number'),
    );
    const maxLen = lengths.length ? Math.max(...lengths) : 50;
    const want = Math.max(maxLen * 3 + 50, 200);
    try {
      const have = this.ctx.candleStore.query(alert.symbol, alert.interval, undefined, undefined, want);
      if (have.length < want) {
        const provider = this.resolveProvider(alert.symbol);
        if (provider) {
          const now = Date.now();
          const stepMs = INTERVAL_MS[alert.interval] ?? 60_000;
          const bars = await provider.fetchHistoricalCandles(
            alert.symbol,
            alert.interval,
            now - want * stepMs,
            now,
            want,
          );
          for (const c of bars) this.ctx.candleStore.upsert(alert.symbol, alert.interval, c);
        }
      }
    } catch (err) {

      console.warn('[alert-engine] indicator backfill failed, seeding from cache only', { alertId: alert.id, err });
    }
    if (!this.wanted.has(alert.id)) return;
    const recent = this.ctx.candleStore.query(alert.symbol, alert.interval, undefined, undefined, 2);
    const newestOpen = recent.length ? recent[recent.length - 1]!.openTime : 0;
    alert.lastFiredAt = Math.max(alert.lastFiredAt ?? 0, newestOpen);
    const off = this.ctx.bus.onSymbol('candle', alert.symbol, (e) => {
      if (e.interval !== alert.interval) return;
      if (!e.data.isClosed) return;
      if (alert.lastFiredAt !== undefined && e.data.openTime <= alert.lastFiredAt) return;
      this.evaluateIndicator(alert, e.data).catch((err) => {

        console.error('[alert-engine] indicator evaluate failed', { alertId: alert.id, err });
      });
    });
    this.subs.set(alert.id, { alert, off });
  }

  /** Evaluate an indicator alert's condition set on one just-closed candle; deliver on a fire. */
  private async evaluateIndicator(alert: IndicatorAlertDefinition, justClosed: Candle): Promise<void> {
    const cfg = alert.config;
    const recent = this.ctx.candleStore.query(alert.symbol, alert.interval, undefined, undefined, 500);
    if (recent.length < 2) return;
    if (recent[recent.length - 1]!.openTime !== justClosed.openTime) recent.push(justClosed);

    // Reuse the shared evaluator (same code the MT5 recipe runner uses) + @supercharts/indicators.
    const refs = collectIndicatorRefs(cfg.conditions);
    if (!evaluateConditionSet(cfg.conditions, cfg.logic, recent, refs, cfg.indicatorSpecs)) return;

    const price = justClosed.close;
    const event: AlertEvent = {
      id: nanoid(),
      alertId: alert.id,
      userId: alert.userId,
      side: cfg.side,
      symbol: alert.symbol,
      interval: alert.interval,
      barTime: justClosed.openTime,
      price,
      // No MA value for an indicator alert — store the close so the events table stays uniform.
      maValue: price,
      label: cfg.label,
      firedAt: Date.now(),
      telegram: cfg.delivery.telegram ? null : 'disabled',
    };

    try {
      this.db.raw
        .prepare(
          `INSERT INTO alert_events
             (id, alert_id, user_id, side, symbol, interval, bar_time, price, ma_value, label, fired_at, telegram)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id, event.alertId, event.userId, event.side, event.symbol, event.interval,
          event.barTime, event.price, event.maValue, event.label, event.firedAt, event.telegram ?? null,
        );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint/i.test(msg)) return; // already fired for this bar
      throw err;
    }
    alert.lastFiredAt = event.barTime;
    this.db.raw
      .prepare('UPDATE alerts SET last_fired_at = ?, updated_at = ? WHERE id = ?')
      .run(event.barTime, Date.now(), alert.id);

    if (cfg.delivery.paper) this.bookPaperTrade(alert, event);
    if (cfg.delivery.web) this.broadcast(alert.userId, event);

    // GW-7: opt-in broker-order automation (position flip). Fire-and-forget, fully gated.
    this.automateBrokerOrder(alert, event, 'indicator');

    if (cfg.delivery.telegram) {
      const botCfg = this.resolveTelegramBot(alert.userId, cfg.delivery.telegramBotId);
      if (!botCfg || botCfg.enabled !== 1) {
        this.markTelegram(event.id, 'disabled');
        return;
      }
      try {
        await this.telegram({ botToken: botCfg.botToken, chatId: botCfg.chatId, text: formatIndicatorTelegramMessage(event, cfg) });
        this.markTelegram(event.id, 'sent');
      } catch (err) {
        this.markTelegram(event.id, 'failed', err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** 3-tier Telegram bot resolution: explicit bot id → first enabled bot → legacy singleton. */
  private resolveTelegramBot(
    userId: string,
    botId?: string,
  ): { botToken: string; chatId: string; enabled: number } | undefined {
    let cfg: { botToken: string; chatId: string; enabled: number } | undefined;
    if (botId) {
      cfg = this.db.raw
        .prepare('SELECT bot_token as botToken, chat_id as chatId, enabled FROM telegram_bots WHERE id = ? AND user_id = ?')
        .get(botId, userId) as { botToken: string; chatId: string; enabled: number } | undefined;
    }
    if (!cfg) {
      cfg = this.db.raw
        .prepare(
          `SELECT bot_token as botToken, chat_id as chatId, enabled FROM telegram_bots
           WHERE user_id = ? AND enabled = 1 ORDER BY created_at ASC LIMIT 1`,
        )
        .get(userId) as { botToken: string; chatId: string; enabled: number } | undefined;
    }
    if (!cfg) {
      cfg = this.db.raw
        .prepare('SELECT bot_token as botToken, chat_id as chatId, enabled FROM telegram_configs WHERE user_id = ?')
        .get(userId) as { botToken: string; chatId: string; enabled: number } | undefined;
    }
    return cfg;
  }

  private markTelegram(eventId: string, status: 'sent' | 'failed' | 'disabled', errorMsg?: string): void {
    this.db.raw
      .prepare('UPDATE alert_events SET telegram = ?, telegram_error = ? WHERE id = ?')
      .run(status, errorMsg ?? null, eventId);
  }

  /**
   * Paper-trade book-keeping.
   *
   * Lifecycle per alert:
   *   - No open position → insert a fresh row in 'open' state at the event's price.
   *   - Opposite-side open position → close it (compute pnl%) and insert a new
   *     opposite position. Always at most one position per alert.
   *   - Same-side fire → no-op (the cross detector already filters re-entries; this
   *     guards against any scheduler quirk that double-fires the same direction).
   */
  private bookPaperTrade(alert: AlertDefinition, event: AlertEvent): void {
    const open = this.db.raw
      .prepare(
        `SELECT id, side, entry_price as entryPrice FROM paper_trades
         WHERE alert_id = ? AND status = 'open' ORDER BY entry_time DESC LIMIT 1`,
      )
      .get(alert.id) as { id: string; side: 'buy' | 'sell'; entryPrice: number } | undefined;
    if (open) {
      if (open.side === event.side) return;
      const pnl =
        open.side === 'buy'
          ? ((event.price - open.entryPrice) / open.entryPrice) * 100
          : ((open.entryPrice - event.price) / open.entryPrice) * 100;
      this.db.raw
        .prepare(
          `UPDATE paper_trades SET status = 'closed', exit_time = ?, exit_price = ?, pnl_percent = ?
           WHERE id = ?`,
        )
        .run(event.barTime, event.price, pnl, open.id);
    }
    this.db.raw
      .prepare(
        `INSERT INTO paper_trades (id, alert_id, user_id, symbol, interval, side, status, entry_time, entry_price)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(nanoid(), alert.id, alert.userId, alert.symbol, alert.interval, event.side, event.barTime, event.price);
  }
}

/* ─── Message formatting ─── */

function formatTelegramMessage(event: AlertEvent, cfg: MaCrossAlertConfig): string {
  const side = event.side === 'buy' ? '🟢 BUY' : '🔴 SELL';
  const label = event.label;
  const symbol = formatSymbolPretty(event.symbol);
  const price = formatPrice(event.price);
  // Dual-MA mode: describe both legs (e.g. "EMA(5) × EMA(10) on close"). Single-MA
  // mode keeps the original "EMA(20) on close" copy so existing alerts read the same.
  const maStr = cfg.crossWith
    ? `${cfg.ma.type.toUpperCase()}(${cfg.ma.length}) × ${cfg.crossWith.type.toUpperCase()}(${cfg.crossWith.length}) on ${cfg.ma.source}`
    : `${cfg.ma.type.toUpperCase()}(${cfg.ma.length}) on ${cfg.ma.source}`;
  const when = formatTime(event.barTime, cfg.timezone);
  const lines = [
    `<b>${side}</b> · ${escapeHtml(label)}`,
    `<b>${escapeHtml(symbol)}</b>  @  <code>${price}</code>`,
    `Triggered ${escapeHtml(when)}`,
    `<i>${escapeHtml(maStr)} · ${event.interval}</i>`,
  ];
  if (cfg.rsiFilter && event.rsiValue !== undefined) {
    const threshold = event.side === 'buy' ? `≤ ${cfg.rsiFilter.buyBelow}` : `≥ ${cfg.rsiFilter.sellAbove}`;
    lines.push(`<i>RSI(${cfg.rsiFilter.length}) = ${event.rsiValue.toFixed(1)} · gate ${threshold}</i>`);
  }
  return lines.join('\n');
}

/** Telegram copy for an indicator-condition alert (M5). Mirrors the ma_cross layout. */
function formatIndicatorTelegramMessage(event: AlertEvent, cfg: IndicatorAlertConfig): string {
  const side = event.side === 'buy' ? '🟢 BUY' : '🔴 SELL';
  const symbol = formatSymbolPretty(event.symbol);
  const price = formatPrice(event.price);
  const when = formatTime(event.barTime, cfg.timezone);
  return [
    `<b>${side}</b> · ${escapeHtml(cfg.label)}`,
    `<b>${escapeHtml(symbol)}</b>  @  <code>${price}</code>`,
    `Triggered ${escapeHtml(when)}`,
    `<i>indicator alert · ${event.interval}</i>`,
  ].join('\n');
}

function formatSymbolPretty(id: string): string {
  const [, raw] = id.split(':');
  if (!raw) return id;
  if (raw.includes('_')) return raw.replace(/_/g, ' / ');
  for (const q of ['USDT', 'USDC', 'USD', 'BTC', 'ETH']) {
    if (raw.endsWith(q)) return `${raw.slice(0, -q.length)} / ${q}`;
  }
  return raw;
}

function formatPrice(p: number): string {
  if (Math.abs(p) >= 1000) return p.toFixed(2);
  if (Math.abs(p) >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function formatTime(ms: number, timezone: string): string {
  const tz = normalizeTimezone(timezone);
  try {
    const d = new Date(ms);
    const fmt = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour12: false,
      timeZone: tz,
    });
    // en-GB returns "27 May 2026, 23:45" — exact match for the brief.
    return `${fmt.format(d)} ${tz === 'UTC' ? 'UTC' : timezone}`;
  } catch {
    // Fall back to UTC if the user passes an invalid zone.
    return `${new Date(ms).toISOString()} UTC`;
  }
}

const TZ_ALIASES: Record<string, string> = {
  UTC: 'UTC',
  IST: 'Asia/Kolkata',
  EST: 'America/New_York',
  PST: 'America/Los_Angeles',
  CST: 'America/Chicago',
  GMT: 'Etc/GMT',
  JST: 'Asia/Tokyo',
  AEST: 'Australia/Sydney',
};

function normalizeTimezone(tz: string): string {
  return TZ_ALIASES[tz.toUpperCase()] ?? tz;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
