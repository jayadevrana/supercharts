import type { Candle } from '@supercharts/types';

export type PriceSource = 'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4';

export function priceFromCandle(c: Candle, source: PriceSource): number {
  switch (source) {
    case 'open':  return c.open;
    case 'high':  return c.high;
    case 'low':   return c.low;
    case 'close': return c.close;
    case 'hl2':   return (c.high + c.low) / 2;
    case 'hlc3':  return (c.high + c.low + c.close) / 3;
    case 'ohlc4': return (c.open + c.high + c.low + c.close) / 4;
  }
}

export function pricesFromCandles(candles: readonly Candle[], source: PriceSource = 'close'): number[] {
  const out = new Array<number>(candles.length);
  for (let i = 0; i < candles.length; i++) out[i] = priceFromCandle(candles[i]!, source);
  return out;
}

export function sma(values: readonly number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (length <= 0 || values.length === 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= length) sum -= values[i - length]!;
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

export function ema(values: readonly number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (length <= 0 || values.length === 0) return out;
  const k = 2 / (length + 1);
  // Seed on the first window of `length` consecutive finite values, so an EMA *of a derived
  // series* (e.g. the MACD line, whose first `slow-1` bars are NaN) seeds on real data instead of
  // propagating NaN. With a plain finite series the window is [0,length) — identical to the usual
  // first-SMA seed at index length-1. After seeding, a stray NaN holds the last EMA rather than
  // poisoning the rest of the series, so a mid-series data gap doesn't blank the tail.
  let start = 0;
  while (start <= values.length - length) {
    let sum = 0;
    let clean = true;
    for (let j = start; j < start + length; j += 1) {
      if (!Number.isFinite(values[j]!)) {
        start = j + 1;
        clean = false;
        break;
      }
      sum += values[j]!;
    }
    if (!clean) continue;
    let prev = sum / length;
    out[start + length - 1] = prev;
    for (let i = start + length; i < values.length; i += 1) {
      const v = values[i]!;
      if (Number.isFinite(v)) prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }
  return out;
}

export function wma(values: readonly number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (length <= 0) return out;
  const denom = (length * (length + 1)) / 2;
  for (let i = length - 1; i < values.length; i++) {
    let s = 0;
    for (let j = 0; j < length; j++) s += values[i - j]! * (length - j);
    out[i] = s / denom;
  }
  return out;
}

export function hma(values: readonly number[], length: number): number[] {
  const half = Math.floor(length / 2);
  const sqrtN = Math.max(1, Math.floor(Math.sqrt(length)));
  const wmaHalf = wma(values, half);
  const wmaFull = wma(values, length);
  const diff = new Array<number>(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    const a = wmaHalf[i];
    const b = wmaFull[i];
    if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) continue;
    diff[i] = 2 * a - b;
  }
  return wma(diff, sqrtN);
}

export function dema(values: readonly number[], length: number): number[] {
  const e1 = ema(values, length);
  const e2 = ema(e1, length);
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(e1[i]!) || Number.isNaN(e2[i]!)) continue;
    out[i] = 2 * e1[i]! - e2[i]!;
  }
  return out;
}

export function tema(values: readonly number[], length: number): number[] {
  const e1 = ema(values, length);
  const e2 = ema(e1, length);
  const e3 = ema(e2, length);
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(e1[i]!) || Number.isNaN(e2[i]!) || Number.isNaN(e3[i]!)) continue;
    out[i] = 3 * e1[i]! - 3 * e2[i]! + e3[i]!;
  }
  return out;
}

export function rma(values: readonly number[], length: number): number[] {
  // Wilder's smoothing (also called RMA / smoothed moving average).
  const out = new Array<number>(values.length).fill(NaN);
  if (length <= 0 || values.length === 0) return out;
  if (values.length < length) return out;
  let seed = 0;
  for (let i = 0; i < length; i++) seed += values[i]!;
  let prev = seed / length;
  out[length - 1] = prev;
  for (let i = length; i < values.length; i++) {
    prev = (prev * (length - 1) + values[i]!) / length;
    out[i] = prev;
  }
  return out;
}
