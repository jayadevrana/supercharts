/**
 * Risk + sizing math. All numbers are in MT5 units: lots, points, account
 * currency. `pip` here is the human-trader pip (10 points for 5-digit forex,
 * 1 point for 2/3-digit forex like JPY pairs, 1 point for metals at 3
 * digits, etc.).
 */

import type { MT5AccountSnapshot, MT5SymbolInfo, OrderIntent } from '@supercharts/types';

export interface SizingResolution {
  volumeLots: number;
  riskAccountCurrency: number;
  reason: string;
}

/** Convert a price distance to pips for a given symbol. */
export function priceDistanceToPips(distance: number, sym: MT5SymbolInfo): number {
  const point = sym.point > 0 ? sym.point : 0.00001;
  // Pip is 10 points for 5-digit / 3-digit pairs, else 1 point.
  const pointsPerPip = sym.digits === 5 || sym.digits === 3 ? 10 : 1;
  return Math.abs(distance) / (point * pointsPerPip);
}

/** Convert pips to absolute price delta. */
export function pipsToPriceDelta(pips: number, sym: MT5SymbolInfo): number {
  const point = sym.point > 0 ? sym.point : 0.00001;
  const pointsPerPip = sym.digits === 5 || sym.digits === 3 ? 10 : 1;
  return pips * pointsPerPip * point;
}

export function resolveSizing(
  intent: OrderIntent,
  sym: MT5SymbolInfo,
  account: MT5AccountSnapshot | null,
): SizingResolution {
  const step = sym.volumeStep > 0 ? sym.volumeStep : 0.01;
  const minV = sym.volumeMin > 0 ? sym.volumeMin : 0.01;
  const maxV = sym.volumeMax > 0 ? sym.volumeMax : 100;
  const clampVol = (v: number): number => {
    const stepped = Math.round(v / step) * step;
    return Math.max(minV, Math.min(maxV, stepped));
  };
  if (intent.sizing.mode === 'fixed_lots') {
    return {
      volumeLots: clampVol(intent.sizing.lots),
      riskAccountCurrency: 0,
      reason: 'fixed_lots',
    };
  }
  const slPips = intent.sizing.slPips;
  if (!slPips || slPips <= 0) {
    return { volumeLots: minV, reason: 'sl_pips_required_for_risk_mode', riskAccountCurrency: 0 };
  }
  // tickValue is the currency per 1 tick (one minimum price increment) per 1 lot.
  const pointsPerPip = sym.digits === 5 || sym.digits === 3 ? 10 : 1;
  const ticksPerPip = sym.tickSize > 0 ? (pointsPerPip * sym.point) / sym.tickSize : pointsPerPip;
  const valuePerPipPerLot = (sym.tickValue > 0 ? sym.tickValue : 1) * ticksPerPip;
  if (valuePerPipPerLot <= 0) {
    return { volumeLots: minV, reason: 'invalid_tick_value', riskAccountCurrency: 0 };
  }
  let riskAmount = 0;
  if (intent.sizing.mode === 'risk_percent') {
    const equity = account?.equity ?? account?.balance ?? 0;
    riskAmount = (equity * intent.sizing.percent) / 100;
  } else if (intent.sizing.mode === 'cash_risk') {
    riskAmount = intent.sizing.amount;
  }
  if (riskAmount <= 0) {
    return { volumeLots: minV, reason: 'risk_amount_zero', riskAccountCurrency: 0 };
  }
  const rawLots = riskAmount / (valuePerPipPerLot * slPips);
  return {
    volumeLots: clampVol(rawLots),
    riskAccountCurrency: riskAmount,
    reason: intent.sizing.mode,
  };
}

/** Resolve absolute SL/TP prices from either price or pips. */
export function resolveStops(
  intent: OrderIntent,
  sym: MT5SymbolInfo,
  /** The reference entry — market price for market orders, the resting price otherwise. */
  refPrice: number,
): { sl: number; tp: number } {
  let sl = 0;
  let tp = 0;
  if (intent.sl?.price && intent.sl.price > 0) {
    sl = intent.sl.price;
  } else if (intent.sl?.pips && intent.sl.pips > 0) {
    const delta = pipsToPriceDelta(intent.sl.pips, sym);
    sl = intent.side === 'buy' ? refPrice - delta : refPrice + delta;
  }
  if (intent.tp?.price && intent.tp.price > 0) {
    tp = intent.tp.price;
  } else if (intent.tp?.pips && intent.tp.pips > 0) {
    const delta = pipsToPriceDelta(intent.tp.pips, sym);
    tp = intent.side === 'buy' ? refPrice + delta : refPrice - delta;
  }
  return { sl, tp };
}

export interface RiskCheckResult {
  ok: boolean;
  reason?: string;
}

export interface RiskLimits {
  /** Reject orders that would exceed this many open positions on the account. */
  maxOpenPositions?: number;
  /** Reject if equity < this fraction of balance (drawdown brake). */
  minEquityFraction?: number;
  /** Hard cap on lots per single order. */
  maxLotsPerOrder?: number;
}

export function checkRisk(
  intent: OrderIntent,
  sym: MT5SymbolInfo,
  account: MT5AccountSnapshot | null,
  sizing: SizingResolution,
  openPositions: number,
  limits: RiskLimits = {},
): RiskCheckResult {
  if (limits.maxOpenPositions && openPositions >= limits.maxOpenPositions) {
    return { ok: false, reason: `max_open_positions_${limits.maxOpenPositions}` };
  }
  if (limits.maxLotsPerOrder && sizing.volumeLots > limits.maxLotsPerOrder) {
    return { ok: false, reason: `max_lots_per_order_${limits.maxLotsPerOrder}` };
  }
  if (limits.minEquityFraction && account && account.balance > 0) {
    const f = account.equity / account.balance;
    if (f < limits.minEquityFraction) {
      return { ok: false, reason: `equity_below_threshold_${limits.minEquityFraction}` };
    }
  }
  if (intent.partials && intent.partials.length > 0) {
    const sum = intent.partials.reduce((a, p) => a + (p.fraction ?? 0), 0);
    if (sum > 1.0001) return { ok: false, reason: 'partials_sum_exceeds_1' };
    for (const leg of intent.partials) {
      if (leg.fraction <= 0 || leg.fraction > 1) {
        return { ok: false, reason: 'partial_fraction_out_of_range' };
      }
    }
  }
  void sym;
  return { ok: true };
}
