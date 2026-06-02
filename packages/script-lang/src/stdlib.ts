import type { Candle } from '@supercharts/types';
import { sma, ema, wma, rma, stdev, atr, vwap, macd, stochastic } from '@supercharts/indicators';

/**
 * PulseScript standard library (Phase 6 task 4).
 *
 * The TA math reuses `@supercharts/indicators` so scripts and the chart's own
 * indicators share one tested implementation. Series transforms (sma/ema/…) take
 * a series argument; inherently OHLC-based studies (atr/vwap/macd/stoch) read the
 * chart candles directly. Everything returns a full per-bar array; the interpreter
 * indexes the bar it needs (causal — no look-ahead leaks into the current bar).
 */

const fin = (v: number | undefined): v is number => v != null && Number.isFinite(v);
const int = (v: number | undefined, d: number): number => (fin(v) ? Math.trunc(v) : d);

/** `math.*` — scalar / variadic numeric helpers. */
export const MATH: Record<string, (a: number[]) => number> = {
  abs: (a) => Math.abs(a[0] ?? NaN),
  sign: (a) => Math.sign(a[0] ?? NaN),
  floor: (a) => Math.floor(a[0] ?? NaN),
  ceil: (a) => Math.ceil(a[0] ?? NaN),
  round: (a) => Math.round(a[0] ?? NaN),
  sqrt: (a) => Math.sqrt(a[0] ?? NaN),
  exp: (a) => Math.exp(a[0] ?? NaN),
  log: (a) => Math.log(a[0] ?? NaN),
  pow: (a) => Math.pow(a[0] ?? NaN, a[1] ?? NaN),
  min: (a) => (a.length ? Math.min(...a) : NaN),
  max: (a) => (a.length ? Math.max(...a) : NaN),
  sum: (a) => a.reduce((s, x) => s + x, 0),
  avg: (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN),
};

export type TaOut = (number | boolean | null)[];
export interface TaFn {
  /** number of leading arguments that are series (the rest are scalar params). */
  series: number;
  compute(s: number[][], n: number[], candles: readonly Candle[]): TaOut;
}

const rollMax = (s: number[], len: number): TaOut =>
  s.map((_, i) => {
    if (i + 1 < len) return null;
    let m = -Infinity;
    for (let k = i - len + 1; k <= i; k++) {
      if (!fin(s[k])) return null;
      if (s[k]! > m) m = s[k]!;
    }
    return m;
  });
const rollMin = (s: number[], len: number): TaOut =>
  s.map((_, i) => {
    if (i + 1 < len) return null;
    let m = Infinity;
    for (let k = i - len + 1; k <= i; k++) {
      if (!fin(s[k])) return null;
      if (s[k]! < m) m = s[k]!;
    }
    return m;
  });

/**
 * RSI of an arbitrary series, composed from the tested Wilder `rma` — mirrors the
 * `@supercharts/indicators` rsi exactly (gains/losses seeded at 0) so the language
 * and the chart indicator agree bar-for-bar.
 */
function rsiSeries(src: number[], len: number): number[] {
  const gains = new Array<number>(src.length).fill(0);
  const losses = new Array<number>(src.length).fill(0);
  for (let i = 1; i < src.length; i++) {
    const d = src[i]! - src[i - 1]!;
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  const rg = rma(gains, len);
  const rl = rma(losses, len);
  return src.map((_, i) => {
    const g = rg[i]!;
    const l = rl[i]!;
    if (!Number.isFinite(g) || !Number.isFinite(l)) return NaN;
    if (l === 0) return 100;
    return 100 - 100 / (1 + g / l);
  });
}

function crossSeries(a: number[], b: number[], over: boolean): TaOut {
  return a.map((_, i) => {
    if (i === 0) return false;
    const a0 = a[i - 1]!;
    const b0 = b[i - 1]!;
    const a1 = a[i]!;
    const b1 = b[i]!;
    if (!fin(a0) || !fin(b0) || !fin(a1) || !fin(b1)) return false;
    return over ? a0 <= b0 && a1 > b1 : a0 >= b0 && a1 < b1;
  });
}

function seriesTrend(a: number[], n: number, up: boolean): TaOut {
  return a.map((_, i) => {
    if (i < n) return false;
    for (let k = i - n + 1; k <= i; k++) {
      if (!fin(a[k]) || !fin(a[k - 1])) return false;
      if (up ? !(a[k]! > a[k - 1]!) : !(a[k]! < a[k - 1]!)) return false;
    }
    return true;
  });
}

/** `ta.*` (also callable bare: `ema(close, 12)`). */
export const TA: Record<string, TaFn> = {
  sma: { series: 1, compute: (s, n) => sma(s[0]!, int(n[0], 14)) },
  ema: { series: 1, compute: (s, n) => ema(s[0]!, int(n[0], 14)) },
  wma: { series: 1, compute: (s, n) => wma(s[0]!, int(n[0], 14)) },
  rma: { series: 1, compute: (s, n) => rma(s[0]!, int(n[0], 14)) },
  stdev: { series: 1, compute: (s, n) => stdev(s[0]!, int(n[0], 14)) },
  rsi: { series: 1, compute: (s, n) => rsiSeries(s[0]!, int(n[0], 14)) },
  change: {
    series: 1,
    compute: (s, n) => {
      const k = int(n[0], 1);
      const a = s[0]!;
      return a.map((_, i) => (i - k >= 0 && fin(a[i]) && fin(a[i - k]) ? a[i]! - a[i - k]! : null));
    },
  },
  highest: { series: 1, compute: (s, n) => rollMax(s[0]!, int(n[0], 14)) },
  lowest: { series: 1, compute: (s, n) => rollMin(s[0]!, int(n[0], 14)) },
  rising: { series: 1, compute: (s, n) => seriesTrend(s[0]!, int(n[0], 1), true) },
  falling: { series: 1, compute: (s, n) => seriesTrend(s[0]!, int(n[0], 1), false) },
  crossOver: { series: 2, compute: (s) => crossSeries(s[0]!, s[1]!, true) },
  crossUnder: { series: 2, compute: (s) => crossSeries(s[0]!, s[1]!, false) },
  atr: { series: 0, compute: (_s, n, c) => atr(c, { length: int(n[0], 14) }) },
  vwap: { series: 0, compute: (_s, _n, c) => vwap(c) },
  macd: { series: 0, compute: (_s, n, c) => macd(c, { fast: int(n[0], 12), slow: int(n[1], 26), signal: int(n[2], 9) }).macd },
  stoch: { series: 0, compute: (_s, n, c) => stochastic(c, { kLength: int(n[0], 14), kSmooth: int(n[1], 3), dSmooth: int(n[2], 3) }).k },
};
