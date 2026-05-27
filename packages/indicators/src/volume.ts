import type { Candle } from '@supercharts/types';
import { ema, sma } from './ma';

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

void sma;
