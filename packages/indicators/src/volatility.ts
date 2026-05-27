import type { Candle } from '@supercharts/types';
import { ema, rma, sma } from './ma';

export interface ATROptions {
  length?: number;
  smoothing?: 'rma' | 'sma' | 'ema';
}

export function trueRange(candles: readonly Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length === 0) return out;
  out[0] = candles[0]!.high - candles[0]!.low;
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i]!.high;
    const l = candles[i]!.low;
    const pc = candles[i - 1]!.close;
    out[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return out;
}

export function atr(candles: readonly Candle[], opts: ATROptions = {}): number[] {
  const len = opts.length ?? 14;
  const tr = trueRange(candles);
  switch (opts.smoothing ?? 'rma') {
    case 'sma': return sma(tr, len);
    case 'ema': return ema(tr, len);
    case 'rma': default: return rma(tr, len);
  }
}

export interface BollingerOptions {
  length?: number;
  multiplier?: number;
}

export interface BollingerFrame {
  middle: number[];
  upper: number[];
  lower: number[];
  bandwidth: number[];
  percentB: number[];
}

export function bollinger(candles: readonly Candle[], opts: BollingerOptions = {}): BollingerFrame {
  const len = opts.length ?? 20;
  const mult = opts.multiplier ?? 2;
  const closes = candles.map((c) => c.close);
  const mid = sma(closes, len);
  const upper = new Array<number>(closes.length).fill(NaN);
  const lower = new Array<number>(closes.length).fill(NaN);
  const bw = new Array<number>(closes.length).fill(NaN);
  const pb = new Array<number>(closes.length).fill(NaN);
  for (let i = len - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - len + 1; j <= i; j++) {
      const d = closes[j]! - mid[i]!;
      sum += d * d;
    }
    const sd = Math.sqrt(sum / len);
    upper[i] = mid[i]! + mult * sd;
    lower[i] = mid[i]! - mult * sd;
    bw[i] = mid[i]! === 0 ? NaN : (upper[i]! - lower[i]!) / mid[i]!;
    const range = upper[i]! - lower[i]!;
    pb[i] = range === 0 ? 0.5 : (closes[i]! - lower[i]!) / range;
  }
  return { middle: mid, upper, lower, bandwidth: bw, percentB: pb };
}

export interface KeltnerOptions {
  emaLength?: number;
  atrLength?: number;
  multiplier?: number;
}

export interface KeltnerFrame {
  middle: number[];
  upper: number[];
  lower: number[];
}

export function keltner(candles: readonly Candle[], opts: KeltnerOptions = {}): KeltnerFrame {
  const emaLen = opts.emaLength ?? 20;
  const atrLen = opts.atrLength ?? 10;
  const mult = opts.multiplier ?? 2;
  const closes = candles.map((c) => c.close);
  const mid = ema(closes, emaLen);
  const tr = atr(candles, { length: atrLen });
  const upper = new Array<number>(closes.length).fill(NaN);
  const lower = new Array<number>(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    if (Number.isNaN(mid[i]!) || Number.isNaN(tr[i]!)) continue;
    upper[i] = mid[i]! + mult * tr[i]!;
    lower[i] = mid[i]! - mult * tr[i]!;
  }
  return { middle: mid, upper, lower };
}

export interface DonchianOptions {
  length?: number;
}

export interface DonchianFrame {
  upper: number[];
  lower: number[];
  middle: number[];
}

export function donchian(candles: readonly Candle[], opts: DonchianOptions = {}): DonchianFrame {
  const len = opts.length ?? 20;
  const upper = new Array<number>(candles.length).fill(NaN);
  const lower = new Array<number>(candles.length).fill(NaN);
  const mid = new Array<number>(candles.length).fill(NaN);
  for (let i = len - 1; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = +Infinity;
    for (let j = i - len + 1; j <= i; j++) {
      if (candles[j]!.high > hi) hi = candles[j]!.high;
      if (candles[j]!.low < lo) lo = candles[j]!.low;
    }
    upper[i] = hi;
    lower[i] = lo;
    mid[i] = (hi + lo) / 2;
  }
  return { upper, lower, middle: mid };
}

export function stdev(values: readonly number[], length: number): number[] {
  const m = sma(values, length);
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = length - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - length + 1; j <= i; j++) {
      const d = values[j]! - m[i]!;
      s += d * d;
    }
    out[i] = Math.sqrt(s / length);
  }
  return out;
}
