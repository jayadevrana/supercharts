/**
 * Advanced moving averages — original implementations of public-domain formulas
 * (Arnaud Legoux, Kaufman, Tillson, McGinley, zero-lag, volume-weighted). All return arrays
 * aligned 1:1 with the input, NaN over warm-up. `vwma` reads candle volume; the rest take a
 * pre-extracted price series so the runner can apply any source.
 */

import type { Candle } from '@supercharts/types';
import { ema, type PriceSource } from './ma';
import { priceFromCandle } from './ma';

// ─── Volume-Weighted Moving Average ───
export function vwma(candles: readonly Candle[], length: number, source: PriceSource = 'close'): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (length < 1) return out;
  for (let i = length - 1; i < candles.length; i++) {
    let pv = 0, v = 0;
    for (let j = i - length + 1; j <= i; j++) {
      const vol = candles[j]!.volume;
      pv += priceFromCandle(candles[j]!, source) * vol;
      v += vol;
    }
    out[i] = v === 0 ? NaN : pv / v;
  }
  return out;
}

// ─── Arnaud Legoux Moving Average ───
export function alma(values: readonly number[], length: number, offset = 0.85, sigma = 6): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (length < 1) return out;
  const m = offset * (length - 1);
  const s = length / sigma;
  const w = new Array<number>(length);
  let wsum = 0;
  for (let i = 0; i < length; i++) {
    w[i] = Math.exp(-((i - m) * (i - m)) / (2 * s * s));
    wsum += w[i]!;
  }
  for (let i = length - 1; i < values.length; i++) {
    let acc = 0;
    let ok = true;
    for (let j = 0; j < length; j++) {
      const v = values[i - length + 1 + j]!;
      if (!Number.isFinite(v)) { ok = false; break; }
      acc += v * w[j]!;
    }
    if (ok) out[i] = acc / wsum;
  }
  return out;
}

// ─── Kaufman Adaptive Moving Average ───
export function kama(values: readonly number[], length = 10, fast = 2, slow = 30): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length <= length) return out;
  const fastSc = 2 / (fast + 1);
  const slowSc = 2 / (slow + 1);
  let prev = values[length - 1]!;
  out[length - 1] = prev;
  for (let i = length; i < values.length; i++) {
    const change = Math.abs(values[i]! - values[i - length]!);
    let volatility = 0;
    for (let j = i - length + 1; j <= i; j++) volatility += Math.abs(values[j]! - values[j - 1]!);
    const er = volatility === 0 ? 0 : change / volatility;
    const sc = Math.pow(er * (fastSc - slowSc) + slowSc, 2);
    prev = prev + sc * (values[i]! - prev);
    out[i] = prev;
  }
  return out;
}

// ─── Tillson T3 ───
export function t3(values: readonly number[], length = 8, vfactor = 0.7): number[] {
  const e1 = ema(values, length);
  const e2 = ema(e1, length);
  const e3 = ema(e2, length);
  const e4 = ema(e3, length);
  const e5 = ema(e4, length);
  const e6 = ema(e5, length);
  const a = vfactor;
  const c1 = -a * a * a;
  const c2 = 3 * a * a + 3 * a * a * a;
  const c3 = -6 * a * a - 3 * a - 3 * a * a * a;
  const c4 = 1 + 3 * a + a * a * a + 3 * a * a;
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(e6[i]!) || !Number.isFinite(e5[i]!) || !Number.isFinite(e4[i]!) || !Number.isFinite(e3[i]!)) continue;
    out[i] = c1 * e6[i]! + c2 * e5[i]! + c3 * e4[i]! + c4 * e3[i]!;
  }
  return out;
}

// ─── Zero-Lag EMA ───
export function zlema(values: readonly number[], length: number): number[] {
  const lag = Math.floor((length - 1) / 2);
  const deLagged = new Array<number>(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (i < lag) continue;
    const v = values[i]!, vp = values[i - lag]!;
    if (!Number.isFinite(v) || !Number.isFinite(vp)) continue;
    deLagged[i] = v + (v - vp);
  }
  return ema(deLagged, length);
}

// ─── McGinley Dynamic ───
export function mcginley(values: readonly number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  // Seed on the first finite value.
  let start = 0;
  while (start < values.length && !Number.isFinite(values[start]!)) start++;
  if (start >= values.length) return out;
  let md = values[start]!;
  out[start] = md;
  for (let i = start + 1; i < values.length; i++) {
    const price = values[i]!;
    if (!Number.isFinite(price) || md === 0) { out[i] = md; continue; }
    const ratio = price / md;
    md = md + (price - md) / (length * Math.pow(ratio, 4));
    out[i] = md;
  }
  return out;
}
