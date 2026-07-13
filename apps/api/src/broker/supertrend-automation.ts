/**
 * GW-7 FINAL-DELIVERY builder — turn a SuperTrend + Kite-instrument config into the ARMED alert
 * pair the owner runs on ANY Kite instrument (stock / option / future / MCX).
 *
 * A SuperTrend flip strategy is inherently two-sided, but an indicator alert carries a single
 * `side` and a single condition set, and the GW-7 executor decides the flip direction from the
 * fired `event.side`. So one armed strategy = a PAIR of indicator alerts sharing ONE
 * `delivery.brokerOrder`:
 *
 *   - BUY leg  → SuperTrend `direction` crosses ABOVE 0 (regime flips −1 → +1) → executor goes LONG.
 *   - SELL leg → SuperTrend `direction` crosses BELOW 0 (regime flips +1 → −1) → executor goes SHORT.
 *
 * The GW-7 `alert-order-executor` then flips the position (close the opposite side first, open the
 * new one; idempotent when already in that direction), gated by the kill-switch + per-alert daily
 * cap. This module is PURE + TESTED so the arm-able surface (route/UI, next increment) is a thin
 * shell over pinned semantics — no broker, alert engine, or Fastify needed to prove it.
 *
 * Nothing here places an order or mutates state; it only constructs the alert-create payloads that
 * the existing, audited `POST /api/alerts` (indicator type) validates and persists.
 */

import type {
  IndicatorAlertConfig,
  IndicatorInstance,
  Interval,
  SignalCondition,
} from '@supercharts/types';

export interface SupertrendAutomationParams {
  /** SuperCharts symbol id the alert watches, e.g. 'KITE:NSE:RELIANCE'. */
  symbol: string;
  /** Chart interval the SuperTrend runs on, e.g. '15m', '1h', '1d'. */
  interval: Interval;
  /** ATR length (SuperTrend). Default 10. Must be an integer ≥ 1. */
  atrLength?: number;
  /** ATR multiplier (band width). Default 3. Must be > 0. */
  multiplier?: number;

  // ---- Kite order (what actually trades on a flip) ----
  broker?: 'kite';
  /** Broker trading symbol, e.g. 'RELIANCE', 'NIFTY24JUL24000CE'. NOT the SuperCharts id. */
  tradingSymbol: string;
  /** Broker exchange, e.g. 'NSE' | 'BSE' | 'NFO' | 'MCX'. */
  exchange: string;
  /** Target position size after a flip (lots × lot-size for F&O/MCX). Positive integer. */
  quantity: number;
  /** Product code: intraday (MIS), delivery (CNC), or carry-forward derivatives (NRML). */
  product: 'mis' | 'cnc' | 'nrml';
  /** Max automated flips per UTC day for EACH leg (safety cap). Omitted → unlimited (still kill-switch gated). */
  maxTradesPerDay?: number;

  // ---- Delivery ----
  /** Send a Telegram note on each flip. Default true. */
  telegram?: boolean;
  /** Saved Telegram bot id to route through. Omitted → the user's first enabled bot. */
  telegramBotId?: string;
  /** IANA timezone for the Telegram timestamp. Default 'Asia/Kolkata' (Kite = India). */
  timezone?: string;
  /**
   * SuperTrend indicator instance id both legs reference. Omitted → a stable id derived from the
   * params. Callers rarely set this; it exists so a UI can keep the id stable across edits.
   */
  instanceId?: string;
}

/** One arm-able leg — exactly the `POST /api/alerts` (type:'indicator') create payload. */
export interface SupertrendAutomationLeg {
  symbol: string;
  interval: Interval;
  type: 'indicator';
  enabled: boolean;
  config: IndicatorAlertConfig;
}

export interface SupertrendAutomationPair {
  /** Flip-to-LONG leg. */
  buy: SupertrendAutomationLeg;
  /** Flip-to-SHORT leg. */
  sell: SupertrendAutomationLeg;
}

function requirePositiveInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`buildSupertrendAutomation: ${label} must be a positive integer (got ${value})`);
  }
  return value;
}

/**
 * Build the armed BUY + SELL indicator-alert pair for a SuperTrend flip strategy on one Kite
 * instrument. Throws on invalid inputs — a bad order config must never reach the arming route.
 */
export function buildSupertrendAutomation(params: SupertrendAutomationParams): SupertrendAutomationPair {
  const atrLength = requirePositiveInt(params.atrLength ?? 10, 'atrLength');
  const multiplier = params.multiplier ?? 3;
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error(`buildSupertrendAutomation: multiplier must be > 0 (got ${multiplier})`);
  }
  const quantity = requirePositiveInt(params.quantity, 'quantity');

  const tradingSymbol = params.tradingSymbol.trim();
  const exchange = params.exchange.trim();
  if (!tradingSymbol) throw new Error('buildSupertrendAutomation: tradingSymbol is required');
  if (!exchange) throw new Error('buildSupertrendAutomation: exchange is required');

  const broker = params.broker ?? 'kite';
  const telegram = params.telegram ?? true;
  const timezone = params.timezone ?? 'Asia/Kolkata';
  // Stable, collision-resistant id shared by both legs so the runner computes SuperTrend once
  // per leg and the condition's `indicator` field resolves.
  const instanceId =
    params.instanceId ?? `st_${atrLength}_${String(multiplier).replace('.', 'p')}`;

  const indicatorSpec: IndicatorInstance = {
    id: instanceId,
    type: 'supertrend',
    name: `Supertrend ${multiplier}×${atrLength}`,
    paneId: 'price',
    inputs: { atrLength, multiplier },
    style: {},
    visible: true,
    locked: false,
  };

  const brokerOrder = {
    broker,
    tradingSymbol,
    exchange,
    quantity,
    product: params.product,
    ...(params.maxTradesPerDay !== undefined
      ? { maxTradesPerDay: requirePositiveInt(params.maxTradesPerDay, 'maxTradesPerDay') }
      : {}),
  } as const;

  const delivery = {
    web: true,
    telegram,
    ...(params.telegramBotId ? { telegramBotId: params.telegramBotId } : {}),
    brokerOrder,
  };

  const flipCondition = (operator: 'crosses_above' | 'crosses_below'): SignalCondition => ({
    type: 'indicator_compare',
    indicator: instanceId,
    channel: 'direction',
    operator,
    right: { kind: 'constant', value: 0 },
  });

  const leg = (side: 'buy' | 'sell'): SupertrendAutomationLeg => {
    const flipWord = side === 'buy' ? 'UP → long' : 'DOWN → short';
    const config: IndicatorAlertConfig = {
      logic: 'all',
      conditions: [flipCondition(side === 'buy' ? 'crosses_above' : 'crosses_below')],
      indicatorSpecs: [indicatorSpec],
      side,
      label: `SuperTrend(${multiplier}, ${atrLength}) flip ${flipWord}`,
      delivery: { ...delivery },
      timezone,
    };
    return { symbol: params.symbol, interval: params.interval, type: 'indicator', enabled: true, config };
  };

  return { buy: leg('buy'), sell: leg('sell') };
}
