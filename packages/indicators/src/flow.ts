/**
 * Volume & money-flow indicators — original implementations of public-domain formulas
 * (Chaikin, Williams, Elder, etc.), named by technique. Aligned 1:1 with the candles, NaN
 * over warm-up. Reuses the shared EMA/SMA so charts, PulseScript and alerts agree.
 */

import type { Candle } from '@supercharts/types';
import { ema, smaNan } from './ma';

const hlc3 = (c: Candle): number => (c.high + c.low + c.close) / 3;

/** Money-flow-volume per bar: ((C−L)−(H−C))/(H−L) × volume. Shared by ADL & Chaikin Osc. */
function moneyFlowVolume(candles: readonly Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const range = c.high - c.low;
    const mult = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
    out[i] = mult * c.volume;
  }
  return out;
}

// ─── Accumulation / Distribution Line ───
export function adl(candles: readonly Candle[]): number[] {
  const mfv = moneyFlowVolume(candles);
  const out = new Array<number>(candles.length).fill(NaN);
  let cum = 0;
  for (let i = 0; i < candles.length; i++) {
    cum += mfv[i]!;
    out[i] = cum;
  }
  return out;
}

// ─── Chaikin Oscillator: EMA(ADL,fast) − EMA(ADL,slow) ───
export function chaikinOscillator(candles: readonly Candle[], opts: { fast?: number; slow?: number } = {}): number[] {
  const line = adl(candles);
  const f = ema(line, opts.fast ?? 3);
  const s = ema(line, opts.slow ?? 10);
  const out = new Array<number>(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) if (Number.isFinite(f[i]!) && Number.isFinite(s[i]!)) out[i] = f[i]! - s[i]!;
  return out;
}

// ─── Ease of Movement ───
export function easeOfMovement(candles: readonly Candle[], opts: { length?: number } = {}): number[] {
  const len = opts.length ?? 14;
  const emv = new Array<number>(candles.length).fill(NaN);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!, p = candles[i - 1]!;
    const moved = (c.high + c.low) / 2 - (p.high + p.low) / 2;
    const range = c.high - c.low;
    // Box ratio = volume / range; EMV = moved / boxRatio = moved × range / volume.
    emv[i] = c.volume === 0 ? 0 : (moved * range) / c.volume;
  }
  return smaNan(emv, len);
}

// ─── Price Volume Trend ───
export function priceVolumeTrend(candles: readonly Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length === 0) return out;
  let cum = 0;
  out[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    const pc = candles[i - 1]!.close;
    if (pc !== 0) cum += ((candles[i]!.close - pc) / pc) * candles[i]!.volume;
    out[i] = cum;
  }
  return out;
}

// ─── Negative / Positive Volume Index ───
function volumeIndex(candles: readonly Candle[], onIncrease: boolean): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length === 0) return out;
  let val = 1000;
  out[0] = val;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!, p = candles[i - 1]!;
    const trigger = onIncrease ? c.volume > p.volume : c.volume < p.volume;
    if (trigger && p.close !== 0) val = val * (1 + (c.close - p.close) / p.close);
    out[i] = val;
  }
  return out;
}
export const negativeVolumeIndex = (c: readonly Candle[]): number[] => volumeIndex(c, false);
export const positiveVolumeIndex = (c: readonly Candle[]): number[] => volumeIndex(c, true);

// ─── Klinger Volume Oscillator ───
export function klinger(candles: readonly Candle[], opts: { fast?: number; slow?: number; signal?: number } = {}): { kvo: number[]; signal: number[] } {
  const fast = opts.fast ?? 34, slow = opts.slow ?? 55, sig = opts.signal ?? 13;
  const n = candles.length;
  const vf = new Array<number>(n).fill(NaN);
  let prevTrend = 0, cm = 0, prevDm = 0;
  for (let i = 1; i < n; i++) {
    const c = candles[i]!, p = candles[i - 1]!;
    const dm = c.high - c.low;
    const trend = hlc3(c) > hlc3(p) ? 1 : -1;
    cm = trend === prevTrend ? cm + dm : prevDm + dm;
    const ratio = cm === 0 ? 0 : Math.abs(2 * (dm / cm - 1));
    vf[i] = c.volume * ratio * trend * 100;
    prevTrend = trend;
    prevDm = dm;
  }
  const ef = ema(vf, fast);
  const es = ema(vf, slow);
  const kvo = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) if (Number.isFinite(ef[i]!) && Number.isFinite(es[i]!)) kvo[i] = ef[i]! - es[i]!;
  return { kvo, signal: ema(kvo, sig) };
}

// ─── Elder Force Index ───
export function forceIndex(candles: readonly Candle[], opts: { length?: number } = {}): number[] {
  const len = opts.length ?? 13;
  const raw = new Array<number>(candles.length).fill(NaN);
  for (let i = 1; i < candles.length; i++) raw[i] = (candles[i]!.close - candles[i - 1]!.close) * candles[i]!.volume;
  return ema(raw, len);
}

// ─── Elder Ray / Bull & Bear Power ───
export function bullBearPower(candles: readonly Candle[], opts: { length?: number } = {}): { bull: number[]; bear: number[] } {
  const len = opts.length ?? 13;
  const emaC = ema(candles.map((c) => c.close), len);
  const bull = new Array<number>(candles.length).fill(NaN);
  const bear = new Array<number>(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(emaC[i]!)) continue;
    bull[i] = candles[i]!.high - emaC[i]!;
    bear[i] = candles[i]!.low - emaC[i]!;
  }
  return { bull, bear };
}

// ─── Net Volume (volume signed by the bar's direction) ───
export function netVolume(candles: readonly Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length === 0) return out;
  out[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!, p = candles[i - 1]!;
    out[i] = c.close > p.close ? c.volume : c.close < p.close ? -c.volume : 0;
  }
  return out;
}
