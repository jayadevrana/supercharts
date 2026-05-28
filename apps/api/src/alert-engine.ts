import type {
  AlertDefinition,
  AlertEvent,
  Candle,
  Interval,
  MaCrossAlertConfig,
} from '@supercharts/types';
import type { IngestionContext } from '@supercharts/ingestion';
import { computeMaCross, pickSource, rsi as rsiSeries } from '@supercharts/chart-core/pure';
import { nanoid } from 'nanoid';
import type { AppDB } from './db';
import { sendTelegramMessage, type TelegramSender } from './telegram';

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
}

export class AlertEngine {
  private readonly db: AppDB;
  private readonly ctx: IngestionContext;
  private readonly broadcast: WebBroadcaster;
  private readonly telegram: TelegramSender;
  private subs = new Map<string, ActiveSubscription>();

  constructor(opts: AlertEngineOptions) {
    this.db = opts.db;
    this.ctx = opts.ctx;
    this.broadcast = opts.broadcast;
    this.telegram = opts.telegram ?? sendTelegramMessage;
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
      if (row.type !== 'ma_cross') continue;
      const alert: AlertDefinition = {
        id: row.id,
        userId: row.userId,
        symbol: row.symbol,
        interval: row.interval as Interval,
        type: 'ma_cross',
        enabled: row.enabled === 1,
        config: JSON.parse(row.config) as MaCrossAlertConfig,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastFiredAt: row.lastFiredAt ?? undefined,
      };
      this.subscribe(alert);
    }
  }

  /** Add or replace a subscription. */
  subscribe(alert: AlertDefinition): void {
    if (!alert.enabled) {
      this.unsubscribe(alert.id);
      return;
    }
    this.unsubscribe(alert.id);
    // Acquire the underlying market data so the candle store has data to compute MA.
    this.ctx.subscriptions.acquire({ symbol: alert.symbol, kind: 'candles', interval: alert.interval });

    const off = this.ctx.bus.onSymbol('candle', alert.symbol, (e) => {
      if (e.interval !== alert.interval) return;
      if (!e.data.isClosed) return;
      // Skip if we've already fired on this bar (cheap in-memory check; the DB unique
      // constraint is the hard floor below).
      if (alert.lastFiredAt !== undefined && e.data.openTime <= alert.lastFiredAt) return;
      this.evaluate(alert, e.data).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[alert-engine] evaluate failed', { alertId: alert.id, err });
      });
    });

    this.subs.set(alert.id, { alert, off });
  }

  unsubscribe(alertId: string): void {
    const sub = this.subs.get(alertId);
    if (!sub) return;
    sub.off();
    this.ctx.subscriptions.release({ symbol: sub.alert.symbol, kind: 'candles', interval: sub.alert.interval });
    this.subs.delete(alertId);
  }

  shutdown(): void {
    for (const id of this.subs.keys()) this.unsubscribe(id);
  }

  /** Run the detector for one just-closed candle. */
  private async evaluate(alert: AlertDefinition, justClosed: Candle): Promise<void> {
    // We need at least (length + 2) closed candles for a stable cross check.
    const needed = alert.config.ma.length + 5;
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
          // Note: rsiValue isn't persisted to alert_events yet — the value lives in
          // the in-memory event we broadcast. Add a column if/when the history view
          // needs it.
          null,
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

    // Broadcast to web (toast + chart marker) regardless of telegram config.
    if (alert.config.delivery.web) {
      this.broadcast(alert.userId, event);
    }

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
      try {
        await this.telegram({ botToken: cfg.botToken, chatId: cfg.chatId, text });
        this.markTelegram(event.id, 'sent');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.markTelegram(event.id, 'failed', msg);
      }
    }
  }

  private markTelegram(eventId: string, status: 'sent' | 'failed' | 'disabled', errorMsg?: string): void {
    this.db.raw
      .prepare('UPDATE alert_events SET telegram = ?, telegram_error = ? WHERE id = ?')
      .run(status, errorMsg ?? null, eventId);
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
