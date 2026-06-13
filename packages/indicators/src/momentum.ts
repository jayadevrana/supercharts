/**
 * Momentum & community-favourite oscillators — original implementations of public-domain
 * technical-analysis formulas (named by technique, never reproducing any third-party script
 * source or branded identifier). Each returns arrays aligned 1:1 with the input candles,
 * NaN over the warm-up region. Reuses the shared `@supercharts/indicators` math so charts,
 * PulseScript and alerts share one tested implementation.
 */

import type { Candle } from '@supercharts/types';
import { ema, sma, rma, wma, pricesFromCandles, type PriceSource } from './ma';
import { stdev } from './volatility';
import { trueRange } from './volatility';
import { rsi } from './oscillators';

const hl2 = (c: Candle): number => (c.high + c.low) / 2;
const hlc3 = (c: Candle): number => (c.high + c.low + c.close) / 3;

/** Endpoint value of the least-squares line fit over a trailing window of `length` bars. */
export function linreg(values: readonly number[], length: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  if (length < 1) return out;
  // x = 0..length-1; sums are constant for a fixed window.
  const sumX = ((length - 1) * length) / 2;
  const sumX2 = ((length - 1) * length * (2 * length - 1)) / 6;
  const denom = length * sumX2 - sumX * sumX;
  for (let i = length - 1; i < n; i++) {
    let sumY = 0;
    let sumXY = 0;
    let ok = true;
    for (let k = 0; k < length; k++) {
      const v = values[i - length + 1 + k]!;
      if (!Number.isFinite(v)) { ok = false; break; }
      sumY += v;
      sumXY += k * v;
    }
    if (!ok || denom === 0) continue;
    const slope = (length * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / length;
    out[i] = intercept + slope * (length - 1);
  }
  return out;
}

/**
 * NaN-tolerant simple moving average: emits a value once the trailing window is fully finite,
 * and recovers after a gap. The shared `sma` uses a running sum that a leading NaN poisons
 * permanently — these oscillators smooth NaN-prefixed derived series (RSI, ROC, vigor), so
 * they need this instead.
 */
function smaNan(values: readonly number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (length < 1) return out;
  for (let i = length - 1; i < values.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - length + 1; j <= i; j++) {
      const v = values[j]!;
      if (!Number.isFinite(v)) { ok = false; break; }
      sum += v;
    }
    if (ok) out[i] = sum / length;
  }
  return out;
}

function highest(values: readonly number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = length - 1; i < values.length; i++) {
    let hi = -Infinity;
    for (let j = i - length + 1; j <= i; j++) if (values[j]! > hi) hi = values[j]!;
    out[i] = hi;
  }
  return out;
}
function lowest(values: readonly number[], length: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  for (let i = length - 1; i < values.length; i++) {
    let lo = Infinity;
    for (let j = i - length + 1; j <= i; j++) if (values[j]! < lo) lo = values[j]!;
    out[i] = lo;
  }
  return out;
}

// ─── Stochastic RSI ───
export interface StochRsiOptions { rsiLength?: number; stochLength?: number; kSmooth?: number; dSmooth?: number; source?: PriceSource }
export function stochRsi(candles: readonly Candle[], opts: StochRsiOptions = {}): { k: number[]; d: number[] } {
  const r = rsi(candles, { length: opts.rsiLength ?? 14, source: opts.source ?? 'close' });
  const len = opts.stochLength ?? 14;
  const hi = highest(r, len);
  const lo = lowest(r, len);
  const rawK = new Array<number>(r.length).fill(NaN);
  for (let i = 0; i < r.length; i++) {
    if (Number.isNaN(hi[i]!) || Number.isNaN(lo[i]!) || Number.isNaN(r[i]!)) continue;
    const range = hi[i]! - lo[i]!;
    rawK[i] = range === 0 ? 0 : ((r[i]! - lo[i]!) / range) * 100;
  }
  const k = smaNan(rawK, opts.kSmooth ?? 3);
  const d = smaNan(k, opts.dSmooth ?? 3);
  return { k, d };
}

// ─── Awesome Oscillator ───
export function awesome(candles: readonly Candle[], opts: { fast?: number; slow?: number } = {}): number[] {
  const m = candles.map(hl2);
  const f = sma(m, opts.fast ?? 5);
  const s = sma(m, opts.slow ?? 34);
  const out = new Array<number>(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(f[i]!) || Number.isNaN(s[i]!)) continue;
    out[i] = f[i]! - s[i]!;
  }
  return out;
}

// ─── Momentum ───
export function momentum(candles: readonly Candle[], opts: { length?: number; source?: PriceSource } = {}): number[] {
  const len = opts.length ?? 10;
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const out = new Array<number>(src.length).fill(NaN);
  for (let i = len; i < src.length; i++) out[i] = src[i]! - src[i - len]!;
  return out;
}

// ─── TRIX (rate-of-change of a triple-smoothed EMA, in basis points) ───
export function trix(candles: readonly Candle[], opts: { length?: number; source?: PriceSource } = {}): number[] {
  const len = opts.length ?? 18;
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const e3 = ema(ema(ema(src, len), len), len);
  const out = new Array<number>(src.length).fill(NaN);
  for (let i = 1; i < src.length; i++) {
    const a = e3[i - 1]!;
    if (!Number.isFinite(a) || !Number.isFinite(e3[i]!) || a === 0) continue;
    out[i] = ((e3[i]! - a) / a) * 10000;
  }
  return out;
}

// ─── Ultimate Oscillator ───
export function ultimate(candles: readonly Candle[], opts: { fast?: number; mid?: number; slow?: number } = {}): number[] {
  const f = opts.fast ?? 7, m = opts.mid ?? 14, s = opts.slow ?? 28;
  const n = candles.length;
  const bp = new Array<number>(n).fill(0);
  const tr = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const c = candles[i]!, pc = candles[i - 1]!.close;
    const trueLow = Math.min(c.low, pc);
    bp[i] = c.close - trueLow;
    tr[i] = Math.max(c.high, pc) - trueLow;
  }
  const win = (len: number, i: number): number => {
    let sbp = 0, str = 0;
    for (let j = i - len + 1; j <= i; j++) { sbp += bp[j]!; str += tr[j]!; }
    return str === 0 ? 0 : sbp / str;
  };
  const out = new Array<number>(n).fill(NaN);
  for (let i = s; i < n; i++) {
    out[i] = (100 * (4 * win(f, i) + 2 * win(m, i) + win(s, i))) / 7;
  }
  return out;
}

// ─── Chande Momentum Oscillator ───
export function cmo(candles: readonly Candle[], opts: { length?: number; source?: PriceSource } = {}): number[] {
  const len = opts.length ?? 9;
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const up = new Array<number>(src.length).fill(0);
  const dn = new Array<number>(src.length).fill(0);
  for (let i = 1; i < src.length; i++) {
    const d = src[i]! - src[i - 1]!;
    up[i] = d > 0 ? d : 0;
    dn[i] = d < 0 ? -d : 0;
  }
  const out = new Array<number>(src.length).fill(NaN);
  for (let i = len; i < src.length; i++) {
    let su = 0, sd = 0;
    for (let j = i - len + 1; j <= i; j++) { su += up[j]!; sd += dn[j]!; }
    const tot = su + sd;
    out[i] = tot === 0 ? 0 : (100 * (su - sd)) / tot;
  }
  return out;
}

// ─── Detrended Price Oscillator ───
export function dpo(candles: readonly Candle[], opts: { length?: number; source?: PriceSource } = {}): number[] {
  const len = opts.length ?? 21;
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const ma = sma(src, len);
  const shift = Math.floor(len / 2) + 1;
  const out = new Array<number>(src.length).fill(NaN);
  for (let i = 0; i < src.length; i++) {
    const m = ma[i]!;
    const past = i - shift;
    if (past < 0 || !Number.isFinite(m)) continue;
    out[i] = src[past]! - m;
  }
  return out;
}

// ─── Fisher Transform ───
export function fisher(candles: readonly Candle[], opts: { length?: number } = {}): { fisher: number[]; trigger: number[] } {
  const len = opts.length ?? 9;
  const m = candles.map(hl2);
  const hi = highest(m, len);
  const lo = lowest(m, len);
  const fish = new Array<number>(candles.length).fill(NaN);
  const trig = new Array<number>(candles.length).fill(NaN);
  let value = 0;
  let prevFish = 0;
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(hi[i]!) || Number.isNaN(lo[i]!)) continue;
    const range = hi[i]! - lo[i]!;
    const raw = range === 0 ? 0 : ((m[i]! - lo[i]!) / range - 0.5) * 2;
    value = 0.33 * raw + 0.67 * value;
    value = Math.max(-0.999, Math.min(0.999, value));
    const f = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * prevFish;
    fish[i] = f;
    trig[i] = prevFish;
    prevFish = f;
  }
  return { fisher: fish, trigger: trig };
}

// ─── Coppock Curve ───
export function coppock(candles: readonly Candle[], opts: { roc1?: number; roc2?: number; wma?: number; source?: PriceSource } = {}): number[] {
  const r1 = opts.roc1 ?? 14, r2 = opts.roc2 ?? 11, w = opts.wma ?? 10;
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const rocOf = (len: number): number[] => {
    const o = new Array<number>(src.length).fill(NaN);
    for (let i = len; i < src.length; i++) { const p = src[i - len]!; if (p !== 0) o[i] = ((src[i]! - p) / p) * 100; }
    return o;
  };
  const a = rocOf(r1), b = rocOf(r2);
  const sum = new Array<number>(src.length).fill(NaN);
  for (let i = 0; i < src.length; i++) if (Number.isFinite(a[i]!) && Number.isFinite(b[i]!)) sum[i] = a[i]! + b[i]!;
  return wma(sum, w);
}

// ─── Know Sure Thing ───
export function kst(candles: readonly Candle[], opts: { source?: PriceSource } = {}): { kst: number[]; signal: number[] } {
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const rocSma = (rocLen: number, smaLen: number): number[] => {
    const r = new Array<number>(src.length).fill(NaN);
    for (let i = rocLen; i < src.length; i++) { const p = src[i - rocLen]!; if (p !== 0) r[i] = ((src[i]! - p) / p) * 100; }
    return smaNan(r, smaLen);
  };
  const a = rocSma(10, 10), b = rocSma(15, 10), c = rocSma(20, 10), d = rocSma(30, 15);
  const k = new Array<number>(src.length).fill(NaN);
  for (let i = 0; i < src.length; i++) {
    if (![a[i], b[i], c[i], d[i]].every((v) => Number.isFinite(v!))) continue;
    k[i] = a[i]! * 1 + b[i]! * 2 + c[i]! * 3 + d[i]! * 4;
  }
  return { kst: k, signal: smaNan(k, 9) };
}

// ─── True Strength Index ───
export function tsi(candles: readonly Candle[], opts: { long?: number; short?: number; signal?: number; source?: PriceSource } = {}): { tsi: number[]; signal: number[] } {
  const long = opts.long ?? 25, short = opts.short ?? 13, sig = opts.signal ?? 13;
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const mom = new Array<number>(src.length).fill(NaN);
  const amom = new Array<number>(src.length).fill(NaN);
  for (let i = 1; i < src.length; i++) { const d = src[i]! - src[i - 1]!; mom[i] = d; amom[i] = Math.abs(d); }
  const ds = ema(ema(mom, long), short);
  const das = ema(ema(amom, long), short);
  const t = new Array<number>(src.length).fill(NaN);
  for (let i = 0; i < src.length; i++) {
    if (!Number.isFinite(ds[i]!) || !Number.isFinite(das[i]!) || das[i]! === 0) continue;
    t[i] = (100 * ds[i]!) / das[i]!;
  }
  return { tsi: t, signal: ema(t, sig) };
}

// ─── Relative Vigor Index ───
export function rvgi(candles: readonly Candle[], opts: { length?: number } = {}): { rvgi: number[]; signal: number[] } {
  const len = opts.length ?? 10;
  const n = candles.length;
  const num = new Array<number>(n).fill(NaN);
  const den = new Array<number>(n).fill(NaN);
  const swma = (fn: (c: Candle) => number, i: number): number => {
    if (i < 3) return NaN;
    return (fn(candles[i]!) + 2 * fn(candles[i - 1]!) + 2 * fn(candles[i - 2]!) + fn(candles[i - 3]!)) / 6;
  };
  for (let i = 3; i < n; i++) {
    num[i] = swma((c) => c.close - c.open, i);
    den[i] = swma((c) => c.high - c.low, i);
  }
  const numS = smaNan(num, len);
  const denS = smaNan(den, len);
  const r = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) if (Number.isFinite(numS[i]!) && Number.isFinite(denS[i]!) && denS[i]! !== 0) r[i] = numS[i]! / denS[i]!;
  // Signal = symmetric weighted MA of RVGI.
  const signal = new Array<number>(n).fill(NaN);
  for (let i = 3; i < n; i++) {
    if (![r[i], r[i - 1], r[i - 2], r[i - 3]].every((v) => Number.isFinite(v!))) continue;
    signal[i] = (r[i]! + 2 * r[i - 1]! + 2 * r[i - 2]! + r[i - 3]!) / 6;
  }
  return { rvgi: r, signal };
}

// ─── Balance of Power ───
export function bop(candles: readonly Candle[], opts: { smooth?: number } = {}): number[] {
  const raw = new Array<number>(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const range = c.high - c.low;
    raw[i] = range === 0 ? 0 : (c.close - c.open) / range;
  }
  const s = opts.smooth ?? 14;
  return s > 1 ? sma(raw, s) : raw;
}

// ─── Connors RSI ───
export function connorsRsi(candles: readonly Candle[], opts: { rsiLength?: number; streakLength?: number; rankLength?: number } = {}): number[] {
  const rl = opts.rsiLength ?? 3, sl = opts.streakLength ?? 2, pl = opts.rankLength ?? 100;
  const closes = candles.map((c) => c.close);
  const r1 = rsi(candles, { length: rl });
  // Streak series (consecutive up/down days), then RSI of the streak.
  const streak = new Array<number>(closes.length).fill(0);
  for (let i = 1; i < closes.length; i++) {
    if (closes[i]! > closes[i - 1]!) streak[i] = streak[i - 1]! > 0 ? streak[i - 1]! + 1 : 1;
    else if (closes[i]! < closes[i - 1]!) streak[i] = streak[i - 1]! < 0 ? streak[i - 1]! - 1 : -1;
    else streak[i] = 0;
  }
  const streakCandles = streak.map((s, i) => ({ ...candles[i]!, close: s, high: s, low: s, open: s }));
  const r2 = rsi(streakCandles as Candle[], { length: sl });
  // Percent-rank of the 1-bar return over the last `pl` bars.
  const ret = new Array<number>(closes.length).fill(NaN);
  for (let i = 1; i < closes.length; i++) { const p = closes[i - 1]!; if (p !== 0) ret[i] = ((closes[i]! - p) / p) * 100; }
  const rank = new Array<number>(closes.length).fill(NaN);
  for (let i = pl; i < closes.length; i++) {
    const cur = ret[i]!;
    if (!Number.isFinite(cur)) continue;
    let less = 0, cnt = 0;
    for (let j = i - pl; j < i; j++) { const v = ret[j]!; if (!Number.isFinite(v)) continue; cnt++; if (v < cur) less++; }
    rank[i] = cnt === 0 ? 50 : (less / cnt) * 100;
  }
  const out = new Array<number>(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    if (!Number.isFinite(r1[i]!) || !Number.isFinite(r2[i]!) || !Number.isFinite(rank[i]!)) continue;
    out[i] = (r1[i]! + r2[i]! + rank[i]!) / 3;
  }
  return out;
}

// ─── Stochastic Momentum Index ───
export function smi(candles: readonly Candle[], opts: { length?: number; smooth1?: number; smooth2?: number; signal?: number } = {}): { smi: number[]; signal: number[] } {
  const len = opts.length ?? 10, s1 = opts.smooth1 ?? 3, s2 = opts.smooth2 ?? 3, sig = opts.signal ?? 3;
  const n = candles.length;
  const hh = highest(candles.map((c) => c.high), len);
  const ll = lowest(candles.map((c) => c.low), len);
  const rel = new Array<number>(n).fill(NaN);
  const diff = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(hh[i]!) || Number.isNaN(ll[i]!)) continue;
    const mid = (hh[i]! + ll[i]!) / 2;
    rel[i] = candles[i]!.close - mid;
    diff[i] = hh[i]! - ll[i]!;
  }
  const relS = ema(ema(rel, s1), s2);
  const diffS = ema(ema(diff, s1), s2);
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(relS[i]!) || !Number.isFinite(diffS[i]!) || diffS[i]! === 0) continue;
    out[i] = 100 * (relS[i]! / (diffS[i]! / 2));
  }
  return { smi: out, signal: ema(out, sig) };
}

// ─── WaveTrend Oscillator ───
export function wavetrend(candles: readonly Candle[], opts: { channelLength?: number; averageLength?: number } = {}): { wt1: number[]; wt2: number[] } {
  const n1 = opts.channelLength ?? 10, n2 = opts.averageLength ?? 21;
  const ap = candles.map(hlc3);
  const esa = ema(ap, n1);
  const dabs = new Array<number>(ap.length).fill(NaN);
  for (let i = 0; i < ap.length; i++) if (Number.isFinite(esa[i]!)) dabs[i] = Math.abs(ap[i]! - esa[i]!);
  const d = ema(dabs, n1);
  const ci = new Array<number>(ap.length).fill(NaN);
  for (let i = 0; i < ap.length; i++) {
    if (!Number.isFinite(esa[i]!) || !Number.isFinite(d[i]!) || d[i]! === 0) continue;
    ci[i] = (ap[i]! - esa[i]!) / (0.015 * d[i]!);
  }
  const wt1 = ema(ci, n2);
  const wt2 = smaNan(wt1, 4);
  return { wt1, wt2 };
}

// ─── Squeeze Momentum (TTM concept; momentum = linreg of price vs range/MA midline) ───
export function squeezeMomentum(candles: readonly Candle[], opts: { length?: number } = {}): { histogram: number[]; squeeze: number[] } {
  const len = opts.length ?? 20;
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const hh = highest(candles.map((c) => c.high), len);
  const ll = lowest(candles.map((c) => c.low), len);
  const smaC = sma(closes, len);
  const detrended = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(hh[i]!) || Number.isNaN(ll[i]!) || Number.isNaN(smaC[i]!)) continue;
    detrended[i] = closes[i]! - ((hh[i]! + ll[i]!) / 2 + smaC[i]!) / 2;
  }
  const histogram = linreg(detrended, len);
  // Squeeze state: 1 when Bollinger(20,2) is inside Keltner(20,1.5×ATR) (low volatility).
  const sd = stdev(closes, len);
  const tr = trueRange(candles);
  const atr20 = rma(tr, len);
  const squeeze = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(sd[i]!) || !Number.isFinite(atr20[i]!) || !Number.isFinite(smaC[i]!)) continue;
    const bbUp = smaC[i]! + 2 * sd[i]!, bbLo = smaC[i]! - 2 * sd[i]!;
    const kcUp = smaC[i]! + 1.5 * atr20[i]!, kcLo = smaC[i]! - 1.5 * atr20[i]!;
    squeeze[i] = bbUp < kcUp && bbLo > kcLo ? 1 : 0;
  }
  return { histogram, squeeze };
}

// ─── Williams Vix Fix (synthetic VIX from the close range; spike = capitulation) ───
export function williamsVixFix(candles: readonly Candle[], opts: { length?: number } = {}): number[] {
  const len = opts.length ?? 22;
  const closes = candles.map((c) => c.close);
  const hh = highest(closes, len);
  const out = new Array<number>(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(hh[i]!) || hh[i]! === 0) continue;
    out[i] = ((hh[i]! - candles[i]!.low) / hh[i]!) * 100;
  }
  return out;
}

// ─── Choppiness Index ───
export function choppiness(candles: readonly Candle[], opts: { length?: number } = {}): number[] {
  const len = opts.length ?? 14;
  const tr = trueRange(candles);
  const out = new Array<number>(candles.length).fill(NaN);
  const log10len = Math.log10(len);
  for (let i = len - 1; i < candles.length; i++) {
    let sumTr = 0, hi = -Infinity, lo = Infinity;
    for (let j = i - len + 1; j <= i; j++) {
      sumTr += tr[j]!;
      if (candles[j]!.high > hi) hi = candles[j]!.high;
      if (candles[j]!.low < lo) lo = candles[j]!.low;
    }
    const range = hi - lo;
    if (range <= 0 || sumTr <= 0) { out[i] = NaN; continue; }
    out[i] = (100 * Math.log10(sumTr / range)) / log10len;
  }
  return out;
}

// ─── Vortex Indicator ───
export function vortex(candles: readonly Candle[], opts: { length?: number } = {}): { viPlus: number[]; viMinus: number[] } {
  const len = opts.length ?? 14;
  const n = candles.length;
  const vmP = new Array<number>(n).fill(0);
  const vmM = new Array<number>(n).fill(0);
  const tr = trueRange(candles);
  for (let i = 1; i < n; i++) {
    vmP[i] = Math.abs(candles[i]!.high - candles[i - 1]!.low);
    vmM[i] = Math.abs(candles[i]!.low - candles[i - 1]!.high);
  }
  const viP = new Array<number>(n).fill(NaN);
  const viM = new Array<number>(n).fill(NaN);
  for (let i = len; i < n; i++) {
    let sp = 0, sm = 0, st = 0;
    for (let j = i - len + 1; j <= i; j++) { sp += vmP[j]!; sm += vmM[j]!; st += tr[j]!; }
    if (st === 0) continue;
    viP[i] = sp / st;
    viM[i] = sm / st;
  }
  return { viPlus: viP, viMinus: viM };
}

// ─── Mass Index ───
export function massIndex(candles: readonly Candle[], opts: { length?: number; emaLength?: number } = {}): number[] {
  const len = opts.length ?? 25, el = opts.emaLength ?? 9;
  const range = candles.map((c) => c.high - c.low);
  const e1 = ema(range, el);
  const e2 = ema(e1, el);
  const ratio = new Array<number>(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) if (Number.isFinite(e1[i]!) && Number.isFinite(e2[i]!) && e2[i]! !== 0) ratio[i] = e1[i]! / e2[i]!;
  const out = new Array<number>(candles.length).fill(NaN);
  for (let i = len - 1; i < candles.length; i++) {
    let s = 0, ok = true;
    for (let j = i - len + 1; j <= i; j++) { if (!Number.isFinite(ratio[j]!)) { ok = false; break; } s += ratio[j]!; }
    if (ok) out[i] = s;
  }
  return out;
}

// ─── Schaff Trend Cycle (double-stochastic of MACD) ───
export function schaffTrendCycle(candles: readonly Candle[], opts: { fast?: number; slow?: number; cycle?: number; source?: PriceSource } = {}): number[] {
  const fast = opts.fast ?? 23, slow = opts.slow ?? 50, cyc = opts.cycle ?? 10;
  const src = pricesFromCandles(candles, opts.source ?? 'close');
  const macdLine = new Array<number>(src.length).fill(NaN);
  const ef = ema(src, fast), es = ema(src, slow);
  for (let i = 0; i < src.length; i++) if (Number.isFinite(ef[i]!) && Number.isFinite(es[i]!)) macdLine[i] = ef[i]! - es[i]!;
  const stoch = (vals: number[]): number[] => {
    const hi = highest(vals, cyc), lo = lowest(vals, cyc);
    const out = new Array<number>(vals.length).fill(NaN);
    let prev = NaN;
    for (let i = 0; i < vals.length; i++) {
      if (Number.isNaN(hi[i]!) || Number.isNaN(lo[i]!) || Number.isNaN(vals[i]!)) continue;
      const range = hi[i]! - lo[i]!;
      const k = range === 0 ? (Number.isFinite(prev) ? prev : 50) : ((vals[i]! - lo[i]!) / range) * 100;
      prev = Number.isFinite(prev) ? prev + 0.5 * (k - prev) : k;
      out[i] = prev;
    }
    return out;
  };
  return stoch(stoch(macdLine));
}
