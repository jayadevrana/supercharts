import { parseBrokerSymbol } from './broker-symbol';

/**
 * GW-7 arm surface (client) — pure form → payload logic for arming a SuperTrend flip automation
 * on a Kite instrument. The UI (`automation-arm-dialog.tsx`) is a thin shell over this; the shape
 * mirrors the `POST /api/broker/automation/supertrend` zod schema so what validates here is exactly
 * what the route accepts. No React, no IO — unit-tested in `tests/automation-arm.test.ts`.
 */

export type ArmProduct = 'mis' | 'cnc' | 'nrml';

export interface ArmForm {
  /** Chart interval the SuperTrend runs on. */
  interval: string;
  /** ATR length (SuperTrend). */
  atrLength: number;
  /** ATR multiplier (band width). */
  multiplier: number;
  /** Target position size after a flip (positive integer). */
  quantity: number;
  /** Kite product: intraday / delivery / carry-forward derivatives. */
  product: ArmProduct;
  /** Max automated flips per day for EACH leg. `null` = unlimited (still kill-switch gated). */
  maxTradesPerDay: number | null;
  /** Send a Telegram note on each flip. */
  telegram: boolean;
}

/** Intervals the arm surface offers — a sensible SuperTrend-flip subset of the full catalog. */
export const ARM_INTERVALS = ['5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;

/** POST body for `/api/broker/automation/supertrend` (matches the route's armSchema). */
export interface ArmPayload {
  symbol: string;
  interval: string;
  atrLength: number;
  multiplier: number;
  tradingSymbol: string;
  exchange: string;
  quantity: number;
  product: ArmProduct;
  maxTradesPerDay?: number;
  telegram: boolean;
}

export type ArmValidation =
  | { ok: true; payload: ArmPayload }
  | { ok: false; errors: string[] };

/** Default form for a fresh arm: the owner's SuperTrend-flip defaults (atr 10 × mult 3). */
export function defaultArmForm(paneInterval?: string): ArmForm {
  const interval = paneInterval && (ARM_INTERVALS as readonly string[]).includes(paneInterval) ? paneInterval : '1d';
  return {
    interval,
    atrLength: 10,
    multiplier: 3,
    quantity: 1,
    product: 'mis',
    maxTradesPerDay: 5,
    telegram: true,
  };
}

/**
 * Validate the arm form against the active pane's chart symbol and derive the broker trading
 * symbol/exchange from the KITE id. Returns the exact POST payload on success, or every problem at
 * once so the form can list them.
 */
export function validateArmForm(symbolId: string, form: ArmForm): ArmValidation {
  const ref = parseBrokerSymbol(symbolId);
  const errors: string[] = [];
  if (!ref) errors.push('Open a Zerodha (KITE:) instrument on this pane to arm an automation.');
  if (!(ARM_INTERVALS as readonly string[]).includes(form.interval)) errors.push('Choose a chart interval.');
  if (!Number.isInteger(form.atrLength) || form.atrLength < 1) errors.push('ATR length must be a whole number ≥ 1.');
  if (!(form.multiplier > 0)) errors.push('Multiplier must be greater than 0.');
  if (!Number.isInteger(form.quantity) || form.quantity < 1) errors.push('Quantity must be a whole number ≥ 1.');
  if (form.maxTradesPerDay !== null && (!Number.isInteger(form.maxTradesPerDay) || form.maxTradesPerDay < 1)) {
    errors.push('Max trades/day must be a whole number ≥ 1, or leave it blank for unlimited.');
  }
  if (errors.length > 0 || !ref) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      symbol: symbolId,
      interval: form.interval,
      atrLength: form.atrLength,
      multiplier: form.multiplier,
      tradingSymbol: ref.tradingSymbol,
      exchange: ref.exchange,
      quantity: form.quantity,
      product: form.product,
      ...(form.maxTradesPerDay !== null ? { maxTradesPerDay: form.maxTradesPerDay } : {}),
      telegram: form.telegram,
    },
  };
}

/** One armed pair as returned by `GET /api/broker/automation`. */
export interface ArmedAutomation {
  automationId: string;
  symbol: string;
  interval: string;
  enabled: boolean;
  atrLength: number | null;
  multiplier: number | null;
  brokerOrder: {
    broker: string;
    tradingSymbol: string;
    exchange: string;
    quantity: number;
    product: string;
    maxTradesPerDay?: number | null;
  } | null;
  buy: { id: string; enabled: boolean } | null;
  sell: { id: string; enabled: boolean } | null;
}

/** One-line human summary of an armed automation for the list. */
export function describeAutomation(a: ArmedAutomation): string {
  const st = a.atrLength != null && a.multiplier != null ? `SuperTrend(${a.atrLength}×${a.multiplier})` : 'SuperTrend';
  const bo = a.brokerOrder;
  const instrument = bo ? `${bo.tradingSymbol} ${bo.exchange}` : a.symbol;
  const size = bo ? `${bo.quantity} ${bo.product.toUpperCase()}` : null;
  const cap = bo?.maxTradesPerDay ? `max ${bo.maxTradesPerDay}/day` : 'no cap';
  const legs = a.buy && a.sell ? 'both legs' : a.buy ? 'buy leg only' : a.sell ? 'sell leg only' : 'no legs';
  return [st, instrument, `${a.interval} · flip`, size, cap, legs].filter((x): x is string => Boolean(x)).join(' · ');
}
