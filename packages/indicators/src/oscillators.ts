import type { Candle } from '@supercharts/types';
import { ema, rma, sma, pricesFromCandles, type PriceSource } from './ma';

export interface RSIOptions {
  length?: number;
  source?: PriceSource;
}

export function rsi(candles: readonly Candle[], opts: RSIOptions = {}): number[] {
  const length = opts.length ?? 14;
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const gains = new Array<number>(src.length).fill(0);
  const losses = new Array<number>(src.length).fill(0);
  for (let i = 1; i < src.length; i++) {
    const d = src[i]! - src[i - 1]!;
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  const avgGain = rma(gains, length);
  const avgLoss = rma(losses, length);
  const out = new Array<number>(src.length).fill(NaN);
  for (let i = 0; i < src.length; i++) {
    if (Number.isNaN(avgGain[i]!) || Number.isNaN(avgLoss[i]!)) continue;
    const al = avgLoss[i]!;
    if (al === 0) { out[i] = 100; continue; }
    const rs = avgGain[i]! / al;
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

export interface MACDOptions {
  fast?: number;
  slow?: number;
  signal?: number;
  source?: PriceSource;
}

export interface MACDFrame {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(candles: readonly Candle[], opts: MACDOptions = {}): MACDFrame {
  const fast = opts.fast ?? 12;
  const slow = opts.slow ?? 26;
  const sig = opts.signal ?? 9;
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const fastE = ema(src, fast);
  const slowE = ema(src, slow);
  const macdLine = new Array<number>(src.length).fill(NaN);
  for (let i = 0; i < src.length; i++) {
    if (Number.isNaN(fastE[i]!) || Number.isNaN(slowE[i]!)) continue;
    macdLine[i] = fastE[i]! - slowE[i]!;
  }
  const sigLine = ema(macdLine, sig);
  const hist = new Array<number>(src.length).fill(NaN);
  for (let i = 0; i < src.length; i++) {
    if (Number.isNaN(macdLine[i]!) || Number.isNaN(sigLine[i]!)) continue;
    hist[i] = macdLine[i]! - sigLine[i]!;
  }
  return { macd: macdLine, signal: sigLine, histogram: hist };
}

export interface StochasticOptions {
  kLength?: number;
  kSmooth?: number;
  dSmooth?: number;
}

export interface StochasticFrame {
  k: number[];
  d: number[];
}

export function stochastic(candles: readonly Candle[], opts: StochasticOptions = {}): StochasticFrame {
  const kLen = opts.kLength ?? 14;
  const kSmooth = opts.kSmooth ?? 3;
  const dSmooth = opts.dSmooth ?? 3;
  const rawK = new Array<number>(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) {
    if (i < kLen - 1) continue;
    let hi = -Infinity;
    let lo = +Infinity;
    for (let j = i - kLen + 1; j <= i; j++) {
      if (candles[j]!.high > hi) hi = candles[j]!.high;
      if (candles[j]!.low < lo) lo = candles[j]!.low;
    }
    rawK[i] = hi === lo ? 50 : ((candles[i]!.close - lo) / (hi - lo)) * 100;
  }
  const k = sma(rawK, kSmooth);
  const d = sma(k, dSmooth);
  return { k, d };
}

export interface WilliamsROptions {
  length?: number;
}

export function williamsR(candles: readonly Candle[], opts: WilliamsROptions = {}): number[] {
  const len = opts.length ?? 14;
  const out = new Array<number>(candles.length).fill(NaN);
  for (let i = len - 1; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = +Infinity;
    for (let j = i - len + 1; j <= i; j++) {
      if (candles[j]!.high > hi) hi = candles[j]!.high;
      if (candles[j]!.low < lo) lo = candles[j]!.low;
    }
    out[i] = hi === lo ? -50 : ((hi - candles[i]!.close) / (hi - lo)) * -100;
  }
  return out;
}

export interface CCIOptions {
  length?: number;
}

export function cci(candles: readonly Candle[], opts: CCIOptions = {}): number[] {
  const len = opts.length ?? 20;
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const tpSma = sma(tp, len);
  const out = new Array<number>(candles.length).fill(NaN);
  for (let i = len - 1; i < candles.length; i++) {
    let meanDev = 0;
    for (let j = i - len + 1; j <= i; j++) meanDev += Math.abs(tp[j]! - tpSma[i]!);
    meanDev /= len;
    if (meanDev === 0) { out[i] = 0; continue; }
    out[i] = (tp[i]! - tpSma[i]!) / (0.015 * meanDev);
  }
  return out;
}

export interface MFIOptions {
  length?: number;
}

export function mfi(candles: readonly Candle[], opts: MFIOptions = {}): number[] {
  const len = opts.length ?? 14;
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const pos = new Array<number>(candles.length).fill(0);
  const neg = new Array<number>(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const mf = tp[i]! * candles[i]!.volume;
    if (tp[i]! > tp[i - 1]!) pos[i] = mf;
    else if (tp[i]! < tp[i - 1]!) neg[i] = mf;
  }
  const out = new Array<number>(candles.length).fill(NaN);
  for (let i = len; i < candles.length; i++) {
    let pSum = 0;
    let nSum = 0;
    for (let j = i - len + 1; j <= i; j++) {
      pSum += pos[j]!;
      nSum += neg[j]!;
    }
    if (nSum === 0) { out[i] = 100; continue; }
    const mr = pSum / nSum;
    out[i] = 100 - 100 / (1 + mr);
  }
  return out;
}

export interface ROCOptions {
  length?: number;
  source?: PriceSource;
}

export function roc(candles: readonly Candle[], opts: ROCOptions = {}): number[] {
  const len = opts.length ?? 9;
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const out = new Array<number>(src.length).fill(NaN);
  for (let i = len; i < src.length; i++) {
    const prev = src[i - len]!;
    if (prev === 0) continue;
    out[i] = ((src[i]! - prev) / prev) * 100;
  }
  return out;
}
