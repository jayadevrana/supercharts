import type { Candle } from '@supercharts/types';
import { ema } from './ma';

export interface VWAPOptions {
  /** When `session`, VWAP resets at the start of each UTC day. */
  mode?: 'session' | 'cumulative';
}

export function vwap(candles: readonly Candle[], opts: VWAPOptions = {}): number[] {
  const mode = opts.mode ?? 'session';
  const out = new Array<number>(candles.length).fill(NaN);
  let cumPV = 0;
  let cumV = 0;
  let curDay = -1;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const dayIdx = Math.floor(c.openTime / 86_400_000);
    if (mode === 'session' && dayIdx !== curDay) {
      cumPV = 0;
      cumV = 0;
      curDay = dayIdx;
    }
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumV += c.volume;
    out[i] = cumV > 0 ? cumPV / cumV : NaN;
  }
  return out;
}

export function obv(candles: readonly Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(0);
  if (candles.length === 0) return out;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur = candles[i]!;
    if (cur.close > prev.close) out[i] = out[i - 1]! + cur.volume;
    else if (cur.close < prev.close) out[i] = out[i - 1]! - cur.volume;
    else out[i] = out[i - 1]!;
  }
  return out;
}

export interface ChaikinMoneyFlowOptions {
  length?: number;
}

export function cmf(candles: readonly Candle[], opts: ChaikinMoneyFlowOptions = {}): number[] {
  const len = opts.length ?? 20;
  const out = new Array<number>(candles.length).fill(NaN);
  const mfv = new Array<number>(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const range = c.high - c.low;
    const mult = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
    mfv[i] = mult * c.volume;
  }
  for (let i = len - 1; i < candles.length; i++) {
    let mfvSum = 0;
    let volSum = 0;
    for (let j = i - len + 1; j <= i; j++) {
      mfvSum += mfv[j]!;
      volSum += candles[j]!.volume;
    }
    out[i] = volSum === 0 ? 0 : mfvSum / volSum;
  }
  return out;
}

export interface VolumeOscillatorOptions {
  shortLength?: number;
  longLength?: number;
}

export function volumeOscillator(
  candles: readonly Candle[],
  opts: VolumeOscillatorOptions = {},
): number[] {
  const sLen = opts.shortLength ?? 5;
  const lLen = opts.longLength ?? 20;
  const vols = candles.map((c) => c.volume);
  const sShort = ema(vols, sLen);
  const sLong = ema(vols, lLen);
  const out = new Array<number>(vols.length).fill(NaN);
  for (let i = 0; i < vols.length; i++) {
    if (Number.isNaN(sShort[i]!) || Number.isNaN(sLong[i]!) || sLong[i] === 0) continue;
    out[i] = ((sShort[i]! - sLong[i]!) / sLong[i]!) * 100;
  }
  return out;
}

export interface RelativeVolumeOptions {
  length?: number;
}

/**
 * Relative Volume (RVOL) — current bar volume ÷ the average volume of the
 * prior `length` bars. >1 means this bar traded heavier than its recent
 * baseline; <1 lighter. The current bar is EXCLUDED from its own average so a
 * spike doesn't dampen its own ratio. Real on every symbol (crypto = traded
 * volume; FX via Yahoo = tick volume — still a valid relative measure).
 */
export function rvol(candles: readonly Candle[], opts: RelativeVolumeOptions = {}): number[] {
  const len = Math.max(1, Math.floor(opts.length ?? 20));
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length <= len) return out;
  // Average of the prior `len` bars (rolling window that ends at i-1).
  let windowSum = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i > len) windowSum -= candles[i - len - 1]!.volume;
    if (i >= 1) windowSum += candles[i - 1]!.volume;
    if (i >= len) {
      const avg = windowSum / len;
      out[i] = avg > 0 ? candles[i]!.volume / avg : NaN;
    }
  }
  return out;
}

export interface VWAPBandsOptions {
  /** When `session`, VWAP + bands reset at the start of each UTC day. */
  mode?: 'session' | 'cumulative';
  /** Inner band width in volume-weighted standard deviations. */
  multiplier1?: number;
  /** Outer band width in volume-weighted standard deviations. */
  multiplier2?: number;
}

export interface VWAPBandsResult {
  vwap: number[];
  upper1: number[];
  lower1: number[];
  upper2: number[];
  lower2: number[];
}

/**
 * VWAP with volume-weighted standard-deviation bands (±1σ / ±2σ by default).
 * σ² is the running volume-weighted variance of typical price about the VWAP:
 * E[v·tp²]/E[v] − VWAP². Session mode resets at the UTC day boundary, matching
 * the plain `vwap()` here. Candle-derived → real on every symbol & timeframe.
 */
export function vwapBands(candles: readonly Candle[], opts: VWAPBandsOptions = {}): VWAPBandsResult {
  const mode = opts.mode ?? 'session';
  const k1 = opts.multiplier1 ?? 1;
  const k2 = opts.multiplier2 ?? 2;
  const n = candles.length;
  const res: VWAPBandsResult = {
    vwap: new Array<number>(n).fill(NaN),
    upper1: new Array<number>(n).fill(NaN),
    lower1: new Array<number>(n).fill(NaN),
    upper2: new Array<number>(n).fill(NaN),
    lower2: new Array<number>(n).fill(NaN),
  };
  let cumPV = 0;
  let cumV = 0;
  let cumPV2 = 0;
  let curDay = -1;
  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    const dayIdx = Math.floor(c.openTime / 86_400_000);
    if (mode === 'session' && dayIdx !== curDay) {
      cumPV = 0;
      cumV = 0;
      cumPV2 = 0;
      curDay = dayIdx;
    }
    const tp = (c.high + c.low + c.close) / 3;
    cumPV += tp * c.volume;
    cumPV2 += tp * tp * c.volume;
    cumV += c.volume;
    if (cumV <= 0) continue;
    const vw = cumPV / cumV;
    const variance = Math.max(0, cumPV2 / cumV - vw * vw);
    const sd = Math.sqrt(variance);
    res.vwap[i] = vw;
    res.upper1[i] = vw + k1 * sd;
    res.lower1[i] = vw - k1 * sd;
    res.upper2[i] = vw + k2 * sd;
    res.lower2[i] = vw - k2 * sd;
  }
  return res;
}

export interface InitialBalanceOptions {
  /** Length of the initial-balance window from each session open, in minutes. */
  ibMinutes?: number;
}

export interface InitialBalanceResult {
  ibHigh: number[];
  ibLow: number[];
  ibMid: number[];
}

/**
 * Initial Balance — the high/low range established in the first `ibMinutes`
 * (default 60) of each session, drawn as flat reference levels across that
 * whole session. Sessions are UTC days (matches the session VWAP here); the
 * first-hour range is a classic market-profile reference for the day's
 * acceptance/rejection. Price-derived → real on every symbol & timeframe.
 *
 * On daily+ timeframes a single bar spans the whole IB window, so the levels
 * degenerate to that bar's own high/low — IB is an intraday concept, so this
 * is expected rather than meaningful there.
 */
export function initialBalance(
  candles: readonly Candle[],
  opts: InitialBalanceOptions = {},
): InitialBalanceResult {
  const ibMs = Math.max(1, opts.ibMinutes ?? 60) * 60_000;
  const n = candles.length;
  const res: InitialBalanceResult = {
    ibHigh: new Array<number>(n).fill(NaN),
    ibLow: new Array<number>(n).fill(NaN),
    ibMid: new Array<number>(n).fill(NaN),
  };
  let i = 0;
  while (i < n) {
    const dayIdx = Math.floor(candles[i]!.openTime / 86_400_000);
    const sessionStart = dayIdx * 86_400_000;
    const ibEnd = sessionStart + ibMs;
    let hi = -Infinity;
    let lo = Infinity;
    let haveIB = false;
    let j = i;
    // Walk every candle in this UTC-day session; take H/L over the IB window only.
    while (j < n && Math.floor(candles[j]!.openTime / 86_400_000) === dayIdx) {
      const c = candles[j]!;
      if (c.openTime < ibEnd) {
        if (c.high > hi) hi = c.high;
        if (c.low < lo) lo = c.low;
        haveIB = true;
      }
      j++;
    }
    if (haveIB && hi > -Infinity && lo < Infinity) {
      const mid = (hi + lo) / 2;
      for (let k = i; k < j; k++) {
        res.ibHigh[k] = hi;
        res.ibLow[k] = lo;
        res.ibMid[k] = mid;
      }
    }
    i = j;
  }
  return res;
}
