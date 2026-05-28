import type { Interval } from './market';

/**
 * MA cross alert: fires when the chosen price source crosses the moving average from
 * below (BUY) or above (SELL). We deliberately keep the surface narrow — the goal is
 * for traders to wire production-grade alerts in <30s without reading a manual.
 *
 * Detection rules (server-side):
 *   - Only CLOSED candles trigger. Provisional/forming candles are ignored to avoid
 *     duplicate fires when a price pokes through the MA and pulls back.
 *   - Crossover is defined relative to the PREVIOUS closed bar's source vs MA. A bar
 *     where (prev.source <= prev.ma) && (cur.source > cur.ma) is a BUY; the inverse
 *     is a SELL. Equality on the prior bar is allowed so a flat-line tag-then-break
 *     still fires.
 *   - Each fire is deduped per (alertId, bar.openTime) so reconnects/re-emits don't
 *     spam Telegram.
 */

export type MaType = 'sma' | 'ema' | 'rma' | 'wma';
export type MaSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';

export interface MaCrossAlertConfig {
  /**
   * Primary moving average. In **single-MA mode** (the default), the engine fires when
   * the chosen price source crosses this MA. In **dual-MA mode** (when `crossWith` is
   * set), this MA is the "fast" leg and the cross is detected between the two MAs.
   */
  ma: {
    type: MaType;
    length: number;
    source: MaSource;
  };
  /**
   * Optional second MA. When present, the alert switches to dual-MA-crossover mode:
   *
   *   BUY  = `ma` (fast) crosses ABOVE `crossWith` (slow)
   *   SELL = `ma` (fast) crosses BELOW `crossWith` (slow)
   *
   * Both MAs use the same `source` as `ma.source` so the comparison is apples-to-apples.
   */
  crossWith?: {
    type: MaType;
    length: number;
  };
  /**
   * Optional RSI gate evaluated AT THE CROSSOVER BAR. When set, the engine fires only
   * if RSI(length) satisfies the side-specific threshold:
   *
   *   BUY  fires only when RSI <= buyBelow
   *   SELL fires only when RSI >= sellAbove
   *
   * Common setups:
   *   - RSI(14) < 35 / > 65 — gentle filter, fires often
   *   - RSI(6)  < 25 / > 75 — strict reversal confirmation, fires rarely
   *
   * The RSI value at the trigger bar is surfaced in the Telegram message so the user
   * can see what passed the filter.
   */
  rsiFilter?: {
    length: number;
    buyBelow: number;
    sellAbove: number;
  };
  /** Label text shown on the chart at the crossover bar. */
  labels: {
    buy: string;
    sell: string;
  };
  /** Delivery channels. */
  delivery: {
    web: boolean;
    telegram: boolean;
    /**
     * Optional id of the saved Telegram bot to use for delivery. When omitted, the
     * engine picks the user's first enabled bot. Lets users route different alert
     * groups to different bots (e.g. swing → Default bot, scalp → Scalp bot).
     */
    telegramBotId?: string;
    /**
     * When true, the alert opens a virtual paper-trade on every fire. Reverse fires
     * close + flip. No real orders — pure book-keeping in `paper_trades`. Lets users
     * see what their alert would have made in real time before wiring it to MT5.
     */
    paper?: boolean;
  };
  /**
   * IANA timezone for the formatted timestamp in the Telegram message,
   * e.g. "UTC", "Asia/Kolkata", "America/New_York".
   */
  timezone: string;
  /**
   * Visual styling for the on-chart line + labels. Optional — defaults applied client-side.
   */
  style?: {
    lineColor?: string;
    lineWidth?: number;
    buyColor?: string;
    sellColor?: string;
    /** Color of the slow MA in dual-MA mode. */
    slowLineColor?: string;
  };
}

export interface AlertDefinition {
  id: string;
  userId: string;
  /** "ma_cross" — we intentionally version this so future detectors don't collide. */
  type: 'ma_cross';
  symbol: string;
  interval: Interval;
  enabled: boolean;
  config: MaCrossAlertConfig;
  createdAt: number;
  updatedAt: number;
  /** Set after the first fire so the UI can show "last fired at …". */
  lastFiredAt?: number;
}

export interface AlertEvent {
  id: string;
  alertId: string;
  userId: string;
  side: 'buy' | 'sell';
  symbol: string;
  interval: Interval;
  /** Bar's openTime — the bar that triggered the cross. */
  barTime: number;
  /** Close price (or chosen source) at the crossover bar. */
  price: number;
  /** MA value at the same bar. */
  maValue: number;
  /** When the alert engine emitted the event (server clock). */
  firedAt: number;
  /** Human-readable label baked at fire time (so renaming the alert later won't rewrite history). */
  label: string;
  /** Telegram send outcome — `null` if delivery was disabled. */
  telegram?: 'sent' | 'failed' | 'disabled' | null;
  /** Optional error message if telegram delivery failed. */
  telegramError?: string;
  /** RSI value at the trigger bar — only set when `rsiFilter` is configured. */
  rsiValue?: number;
}

export interface TelegramConfig {
  /** True if a bot token has been saved server-side. The actual token is never returned to the client. */
  configured: boolean;
  /** Last 4 chars of bot token, for visual confirmation. */
  botTokenSuffix?: string;
  chatId?: string;
  /** Master switch — disables ALL telegram delivery while still keeping config. */
  enabled: boolean;
  updatedAt?: number;
}

/**
 * Paper trade record — virtual position opened/closed by the alert engine. Live
 * (still-open) positions have `status='open'` and `exitPrice`/`exitTime` unset.
 */
export interface PaperTrade {
  id: string;
  alertId: string;
  userId: string;
  symbol: string;
  interval: Interval;
  side: 'buy' | 'sell';
  status: 'open' | 'closed';
  entryTime: number;
  entryPrice: number;
  exitTime?: number;
  exitPrice?: number;
  /** Realised P&L in percent — null while open. */
  pnlPercent?: number;
  /** Bars held — null while open. */
  bars?: number;
}

export interface PaperSummary {
  alertId: string;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalReturnPct: number;
  openPosition?: PaperTrade;
}

/**
 * Multi-bot record returned by the API. Tokens themselves never leave the server; the
 * client only ever sees a 4-char suffix for visual confirmation.
 */
export interface TelegramBot {
  id: string;
  label: string;
  /** Last 4 chars of the bot token, for "saved · ••••fi4Q" displays. */
  botTokenSuffix: string;
  chatId: string;
  enabled: boolean;
  /** Convenience: bot username from `getMe`, populated when the route enriches the row. */
  botUsername?: string;
  createdAt: number;
  updatedAt: number;
}

/* WS message shape (AlertFiredMessage) is exported from ./ws to keep all
 * wire-protocol unions in one place. */
