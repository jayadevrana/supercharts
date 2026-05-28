import type { Candle } from '@supercharts/types';
import { atr } from '@supercharts/chart-core/pure';

/**
 * Position sizer v1.
 *
 * Pure helpers — given account state + risk parameters, return the lot size each
 * sizing mode would prescribe. Caller assembles the inputs (balance, pip value,
 * SL pips, historical win-rate / payoff / ATR) and picks the result they want.
 *
 * All math uses `lots` units; conversion to MT5 volume is the caller's job. The
 * helpers floor lots to the nearest 0.01 (a standard micro-lot step) so the result
 * is broker-orderable.
 *
 * Modes shipped:
 *   - fixed_lots:    constant — the legacy default
 *   - risk_percent:  `(balance × risk%) / (slPips × pipValue)`
 *   - cash_risk:     `riskAmount / (slPips × pipValue)`
 *   - kelly:         `f* = W − (1 − W) / R` where W = win-rate, R = avgWin / |avgLoss|
 *                    — scaled by a "fractional Kelly" safety factor (default 0.25)
 *                    so live trading stays below the theoretical optimum.
 *   - atr_scaled:    `riskAmount / (atrMultiplier × atr × pipValue)` — keeps risk
 *                    constant in $ when volatility changes (e.g. forex breakouts).
 */

const LOT_STEP = 0.01;

function floorToStep(value: number, step = LOT_STEP): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.floor(value / step) * step);
}

export interface SizerInputs {
  /** Account balance in account currency. */
  balance: number;
  /** Stop-loss distance in pips. Required for risk/cash/atr modes. */
  slPips?: number;
  /** Value of 1 pip per 1 lot in account currency (e.g. $10/pip for EURUSD standard lots). */
  pipValue?: number;
  /** Percent of balance at risk per trade. e.g. 1 = 1%. */
  riskPercent?: number;
  /** Fixed cash amount at risk per trade in account currency. */
  riskAmount?: number;
  /** Override fixed-lot size. */
  fixedLots?: number;
  /** Most-recent ATR value in price units (used by atr_scaled). */
  atrValue?: number;
  /** Multiplier on ATR for the SL distance (e.g. 1.5 × ATR). */
  atrMultiplier?: number;
  /** Historical win rate, 0..1. */
  winRate?: number;
  /** Mean winning trade in % (positive). */
  avgWinPct?: number;
  /** Mean losing trade in % (negative; we use abs). */
  avgLossPct?: number;
  /** Fractional Kelly safety scalar, default 0.25. */
  kellyFraction?: number;
}

export interface SizerResultRow {
  mode: 'fixed_lots' | 'risk_percent' | 'cash_risk' | 'kelly' | 'atr_scaled';
  lots: number;
  /** Cash at risk for this size (balance × riskPercent / 100 OR slPips × pipValue × lots). */
  riskAmount: number;
  /** Human-readable breakdown of the math. */
  formula: string;
  /** Set to a reason string when the mode can't produce a value with the inputs given. */
  unavailable?: string;
}

export interface SizerPreview {
  rows: SizerResultRow[];
}

export function previewSizing(inputs: SizerInputs): SizerPreview {
  const {
    balance,
    slPips,
    pipValue,
    riskPercent,
    riskAmount,
    fixedLots,
    atrValue,
    atrMultiplier,
    winRate,
    avgWinPct,
    avgLossPct,
    kellyFraction = 0.25,
  } = inputs;

  const rows: SizerResultRow[] = [];

  /* fixed_lots */
  if (fixedLots != null && fixedLots > 0) {
    const lots = floorToStep(fixedLots);
    const risk = slPips && pipValue ? slPips * pipValue * lots : 0;
    rows.push({
      mode: 'fixed_lots',
      lots,
      riskAmount: risk,
      formula: `${fixedLots} lots (fixed)`,
    });
  } else {
    rows.push({
      mode: 'fixed_lots',
      lots: 0,
      riskAmount: 0,
      formula: 'fixedLots not set',
      unavailable: 'set fixedLots',
    });
  }

  /* risk_percent */
  if (balance > 0 && riskPercent && riskPercent > 0 && slPips && pipValue) {
    const cash = (balance * riskPercent) / 100;
    const lots = floorToStep(cash / (slPips * pipValue));
    rows.push({
      mode: 'risk_percent',
      lots,
      riskAmount: cash,
      formula: `($${balance} × ${riskPercent}%) / (${slPips} pips × $${pipValue}/pip) = ${lots} lots`,
    });
  } else {
    rows.push({
      mode: 'risk_percent',
      lots: 0,
      riskAmount: 0,
      formula: 'needs balance + riskPercent + slPips + pipValue',
      unavailable: 'missing inputs',
    });
  }

  /* cash_risk */
  if (riskAmount && riskAmount > 0 && slPips && pipValue) {
    const lots = floorToStep(riskAmount / (slPips * pipValue));
    rows.push({
      mode: 'cash_risk',
      lots,
      riskAmount,
      formula: `$${riskAmount} / (${slPips} pips × $${pipValue}/pip) = ${lots} lots`,
    });
  } else {
    rows.push({
      mode: 'cash_risk',
      lots: 0,
      riskAmount: 0,
      formula: 'needs riskAmount + slPips + pipValue',
      unavailable: 'missing inputs',
    });
  }

  /* kelly */
  if (
    winRate != null &&
    winRate > 0 &&
    avgWinPct != null &&
    avgWinPct > 0 &&
    avgLossPct != null &&
    avgLossPct < 0
  ) {
    const W = winRate;
    const payoff = avgWinPct / Math.abs(avgLossPct);
    const fullKelly = W - (1 - W) / payoff;
    if (fullKelly > 0 && balance > 0 && slPips && pipValue) {
      const fractional = fullKelly * kellyFraction;
      const cash = balance * fractional;
      const lots = floorToStep(cash / (slPips * pipValue));
      rows.push({
        mode: 'kelly',
        lots,
        riskAmount: cash,
        formula:
          `f* = ${W.toFixed(2)} − (${(1 - W).toFixed(2)} / ${payoff.toFixed(2)}) = ` +
          `${fullKelly.toFixed(3)} (full Kelly); × ${kellyFraction} = ${fractional.toFixed(3)}; ` +
          `$${cash.toFixed(2)} / (${slPips} × $${pipValue}) = ${lots} lots`,
      });
    } else {
      rows.push({
        mode: 'kelly',
        lots: 0,
        riskAmount: 0,
        formula:
          fullKelly <= 0
            ? `f* = ${fullKelly.toFixed(3)} ≤ 0 — system has negative expectancy, do not size up`
            : 'needs balance + slPips + pipValue',
        unavailable: fullKelly <= 0 ? 'negative expectancy' : 'missing inputs',
      });
    }
  } else {
    rows.push({
      mode: 'kelly',
      lots: 0,
      riskAmount: 0,
      formula: 'needs winRate + avgWinPct + avgLossPct (from backtest)',
      unavailable: 'backtest first',
    });
  }

  /* atr_scaled */
  if (atrValue != null && atrValue > 0 && riskAmount && riskAmount > 0 && pipValue) {
    const mult = atrMultiplier ?? 1.5;
    const slPipsFromAtr = (atrValue * mult) / 0.0001; // assume 4-decimal forex pip; caller may override slPips
    const lots = floorToStep(riskAmount / (slPipsFromAtr * pipValue));
    rows.push({
      mode: 'atr_scaled',
      lots,
      riskAmount,
      formula:
        `SL = ${mult} × ATR(${atrValue.toFixed(5)}) = ${slPipsFromAtr.toFixed(1)} pips; ` +
        `$${riskAmount} / (${slPipsFromAtr.toFixed(1)} × $${pipValue}) = ${lots} lots`,
    });
  } else {
    rows.push({
      mode: 'atr_scaled',
      lots: 0,
      riskAmount: 0,
      formula: 'needs atrValue + riskAmount + pipValue',
      unavailable: 'needs ATR + risk amount',
    });
  }

  return { rows };
}

/**
 * Convenience helper for routes: compute the latest ATR(period) value over the
 * caller's candle window. Returns 0 when the series is shorter than `period`.
 */
export function latestAtr(candles: ReadonlyArray<Candle>, period = 14): number {
  if (candles.length < period + 1) return 0;
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const close = candles.map((c) => c.close);
  const series = atr(high, low, close, period);
  const v = series[series.length - 1];
  return Number.isFinite(v!) ? (v as number) : 0;
}
