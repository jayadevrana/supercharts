import type { Candle } from '@supercharts/types';
import {
  sma,
  ema,
  wma,
  rma,
  hma,
  dema,
  tema,
  stdev,
  atr,
  trueRange,
  vwap,
  macd,
  stochastic,
  williamsR,
  cci,
  mfi,
  obv,
  cmf,
  rvol,
  bollinger,
  keltner,
  donchian,
  adx,
  supertrend,
  psar,
  ichimoku,
  aroon,
} from '@supercharts/indicators';

/**
 * PulseScript standard library.
 *
 * The TA math reuses `@supercharts/indicators` wherever that package has the study, so
 * scripts and the chart's own indicators share one tested implementation. Series
 * transforms (sma/ema/…) take a series argument; inherently OHLC-based studies
 * (atr/vwap/cci/…) read the chart candles directly. Multi-output studies (bands,
 * dmi, supertrend, …) declare `outputs` and return one array per field — the
 * interpreter hands scripts a record value (`ta.bands(20, 2).upper`). Everything
 * returns full per-bar arrays; the interpreter indexes the bar it needs (causal —
 * no look-ahead leaks into the current bar).
 */

const fin = (v: number | undefined): v is number => v != null && Number.isFinite(v);
const int = (v: number | undefined, d: number): number => (fin(v) ? Math.trunc(v) : d);
/** A period / length param — truncated, defaulted, and clamped to ≥ 1 so `ta.sma(close, 0)` (or a
 *  negative) can never produce an all-empty/garbage series; it floors at a 1-bar window instead. */
const len = (v: number | undefined, d: number): number => Math.max(1, int(v, d));
/** A float param (multiplier / factor / offset) — defaulted but NOT truncated. */
const fnum = (v: number | undefined, d: number): number => (fin(v) ? v : d);

/** `math.*` — scalar / variadic numeric helpers. */
export const MATH: Record<string, (a: number[]) => number> = {
  abs: (a) => Math.abs(a[0] ?? NaN),
  sign: (a) => Math.sign(a[0] ?? NaN),
  floor: (a) => Math.floor(a[0] ?? NaN),
  ceil: (a) => Math.ceil(a[0] ?? NaN),
  // round(x) or round(x, decimals)
  round: (a) => {
    const x = a[0] ?? NaN;
    if (a.length < 2 || !Number.isFinite(a[1]!)) return Math.round(x);
    const p = Math.pow(10, Math.max(0, Math.min(12, Math.trunc(a[1]!))));
    return Math.round(x * p) / p;
  },
  sqrt: (a) => Math.sqrt(a[0] ?? NaN),
  exp: (a) => Math.exp(a[0] ?? NaN),
  log: (a) => Math.log(a[0] ?? NaN),
  log10: (a) => Math.log10(a[0] ?? NaN),
  pow: (a) => Math.pow(a[0] ?? NaN, a[1] ?? NaN),
  sin: (a) => Math.sin(a[0] ?? NaN),
  cos: (a) => Math.cos(a[0] ?? NaN),
  tan: (a) => Math.tan(a[0] ?? NaN),
  asin: (a) => Math.asin(a[0] ?? NaN),
  acos: (a) => Math.acos(a[0] ?? NaN),
  atan: (a) => Math.atan(a[0] ?? NaN),
  atan2: (a) => Math.atan2(a[0] ?? NaN, a[1] ?? NaN),
  toDegrees: (a) => ((a[0] ?? NaN) * 180) / Math.PI,
  toRadians: (a) => ((a[0] ?? NaN) * Math.PI) / 180,
  clamp: (a) => Math.min(Math.max(a[0] ?? NaN, a[1] ?? NaN), a[2] ?? NaN),
  min: (a) => (a.length ? Math.min(...a) : NaN),
  max: (a) => (a.length ? Math.max(...a) : NaN),
  sum: (a) => a.reduce((s, x) => s + x, 0),
  avg: (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN),
};

/** `math.<name>` constants, readable without a call. */
export const MATH_CONSTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
};

export type TaOut = (number | boolean | null)[];
/** A study's full result — one series, or named series for a multi-output record. */
export type TaResult = TaOut | Record<string, TaOut>;
export interface TaFn {
  /** number of leading arguments that are series (the rest are scalar params). */
  series: number;
  /** Present when the study yields a record per bar (`.upper`, `.lower`, …). */
  outputs?: readonly string[];
  compute(s: number[][], n: number[], candles: readonly Candle[]): TaResult;
}

// ---- rolling-window helpers (warm-up and any non-finite value in the window → null) ----

type WindowFold = (window: number[]) => number;
/** Generic rolling window: null during warm-up or when the window holds a non-finite value. */
function roll(s: number[], length: number, fold: WindowFold): TaOut {
  const out: TaOut = new Array(s.length).fill(null);
  for (let i = length - 1; i < s.length; i++) {
    const w: number[] = [];
    let ok = true;
    for (let k = i - length + 1; k <= i; k++) {
      if (!fin(s[k])) {
        ok = false;
        break;
      }
      w.push(s[k]!);
    }
    if (ok) out[i] = fold(w);
  }
  return out;
}

const rollMax = (s: number[], n: number): TaOut => roll(s, n, (w) => Math.max(...w));
const rollMin = (s: number[], n: number): TaOut => roll(s, n, (w) => Math.min(...w));

/**
 * RSI of an arbitrary series, composed from the tested Wilder `rma` — mirrors the
 * `@supercharts/indicators` rsi exactly (gains/losses seeded at 0) so the language
 * and the chart indicator agree bar-for-bar.
 */
function rsiSeries(src: number[], length: number): number[] {
  const gains = new Array<number>(src.length).fill(0);
  const losses = new Array<number>(src.length).fill(0);
  for (let i = 1; i < src.length; i++) {
    const d = src[i]! - src[i - 1]!;
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  const rg = rma(gains, length);
  const rl = rma(losses, length);
  return src.map((_, i) => {
    const g = rg[i]!;
    const l = rl[i]!;
    if (!Number.isFinite(g) || !Number.isFinite(l)) return NaN;
    if (l === 0) return 100;
    return 100 - 100 / (1 + g / l);
  });
}

function crossSeries(a: number[], b: number[], mode: 'over' | 'under' | 'any'): TaOut {
  return a.map((_, i) => {
    if (i === 0) return false;
    const a0 = a[i - 1]!;
    const b0 = b[i - 1]!;
    const a1 = a[i]!;
    const b1 = b[i]!;
    if (!fin(a0) || !fin(b0) || !fin(a1) || !fin(b1)) return false;
    const over = a0 <= b0 && a1 > b1;
    const under = a0 >= b0 && a1 < b1;
    return mode === 'over' ? over : mode === 'under' ? under : over || under;
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

/** Volume-weighted MA of an arbitrary series (volume read off the candles). */
function vwmaSeries(src: number[], length: number, candles: readonly Candle[]): TaOut {
  const out: TaOut = new Array(src.length).fill(null);
  for (let i = length - 1; i < src.length; i++) {
    let pv = 0;
    let v = 0;
    let ok = true;
    for (let k = i - length + 1; k <= i; k++) {
      const vol = candles[k]?.volume;
      if (!fin(src[k]) || !fin(vol)) {
        ok = false;
        break;
      }
      pv += src[k]! * vol!;
      v += vol!;
    }
    if (ok && v > 0) out[i] = pv / v;
  }
  return out;
}

/** Least-squares regression value at `length-1-offset` within each window (linear-regression curve). */
function linregSeries(src: number[], length: number, offset: number): TaOut {
  // closed forms over x = 0..len-1 (oldest→newest)
  const n = length;
  const sumX = ((n - 1) * n) / 2;
  const sumX2 = ((n - 1) * n * (2 * n - 1)) / 6;
  const denom = n * sumX2 - sumX * sumX;
  return roll(src, length, (w) => {
    let sumY = 0;
    let sumXY = 0;
    for (let x = 0; x < n; x++) {
      sumY += w[x]!;
      sumXY += x * w[x]!;
    }
    const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    const intercept = sumY / n - (slope * sumX) / n;
    return intercept + slope * (n - 1 - offset);
  });
}

/** Arnaud Legoux MA — Gaussian-weighted window, `offset` 0..1 (phase), `sigma` smoothness. */
function almaSeries(src: number[], length: number, offset: number, sigma: number): TaOut {
  const m = offset * (length - 1);
  const s = length / Math.max(1e-9, sigma);
  const weights: number[] = [];
  let norm = 0;
  for (let k = 0; k < length; k++) {
    const w = Math.exp(-((k - m) * (k - m)) / (2 * s * s));
    weights.push(w);
    norm += w;
  }
  return roll(src, length, (w) => {
    let acc = 0;
    for (let k = 0; k < length; k++) acc += w[k]! * weights[k]!;
    return acc / norm;
  });
}

/** Chande Momentum Oscillator — rolling (not Wilder-smoothed) up/down sums. */
function cmoSeries(src: number[], length: number): TaOut {
  const out: TaOut = new Array(src.length).fill(null);
  for (let i = length; i < src.length; i++) {
    let su = 0;
    let sd = 0;
    let ok = true;
    for (let k = i - length + 1; k <= i; k++) {
      if (!fin(src[k]) || !fin(src[k - 1])) {
        ok = false;
        break;
      }
      const d = src[k]! - src[k - 1]!;
      if (d > 0) su += d;
      else sd -= d;
    }
    if (!ok) continue;
    const tot = su + sd;
    out[i] = tot === 0 ? 0 : (100 * (su - sd)) / tot;
  }
  return out;
}

/** True Strength Index — momentum double-smoothed by EMA(long) then EMA(short), ×100. */
function tsiSeries(src: number[], shortLen: number, longLen: number): TaOut {
  const pc = new Array<number>(src.length).fill(NaN);
  const apc = new Array<number>(src.length).fill(NaN);
  for (let i = 1; i < src.length; i++) {
    if (fin(src[i]) && fin(src[i - 1])) {
      pc[i] = src[i]! - src[i - 1]!;
      apc[i] = Math.abs(pc[i]!);
    }
  }
  const num = ema(ema(pc, longLen), shortLen);
  const den = ema(ema(apc, longLen), shortLen);
  return src.map((_, i) => {
    if (!fin(num[i]) || !fin(den[i]) || den[i] === 0) return null;
    return (100 * num[i]!) / den[i]!;
  });
}

/** Rate of change of an arbitrary series: 100 × (s − s[n]) / s[n]. */
function rocSeries(src: number[], length: number): TaOut {
  return src.map((_, i) => {
    if (i < length || !fin(src[i]) || !fin(src[i - length]) || src[i - length] === 0) return null;
    return (100 * (src[i]! - src[i - length]!)) / src[i - length]!;
  });
}

/** Center of gravity (Ehlers) — weighted sum of the window, negative by convention. */
function cogSeries(src: number[], length: number): TaOut {
  return roll(src, length, (w) => {
    let num = 0;
    let den = 0;
    for (let k = 0; k < length; k++) {
      // k=0 is the oldest bar in the window; weight grows toward the PAST from the current bar.
      const price = w[length - 1 - k]!; // bars ago = k
      num += price * (k + 1);
      den += price;
    }
    return den === 0 ? 0 : -num / den;
  });
}

/** Bars since `cond` was last true; none before the first true. */
function sinceSeries(cond: number[]): TaOut {
  const out: TaOut = new Array(cond.length).fill(null);
  let last = -1;
  for (let i = 0; i < cond.length; i++) {
    if (fin(cond[i]) && cond[i]! > 0) last = i;
    if (last >= 0) out[i] = i - last;
  }
  return out;
}

/** Value of `src` at the `back`-th most recent bar where `cond` was true (0 = latest). */
function lastWhenSeries(cond: number[], src: number[], back: number): TaOut {
  const out: TaOut = new Array(cond.length).fill(null);
  const occ: number[] = [];
  for (let i = 0; i < cond.length; i++) {
    if (fin(cond[i]) && cond[i]! > 0) occ.push(i);
    const idx = occ.length - 1 - back;
    if (idx >= 0) {
      const v = src[occ[idx]!];
      out[i] = fin(v) ? v! : null;
    }
  }
  return out;
}

/** Carry the last finite value forward (none until the first finite value). */
function holdSeries(src: number[]): TaOut {
  const out: TaOut = new Array(src.length).fill(null);
  let lastVal: number | null = null;
  for (let i = 0; i < src.length; i++) {
    if (fin(src[i])) lastVal = src[i]!;
    out[i] = lastVal;
  }
  return out;
}

/**
 * Confirmed pivot: a bar strictly above (high) / below (low) its `left` and `right`
 * neighbours. The value appears on the CONFIRMATION bar (pivot + right bars) — same
 * no-repaint timing TradingView-style pivots use; earlier bars stay none.
 */
function pivotSeries(src: number[], left: number, right: number, isHigh: boolean): TaOut {
  const out: TaOut = new Array(src.length).fill(null);
  for (let j = left; j < src.length - right; j++) {
    const v = src[j];
    if (!fin(v)) continue;
    let ok = true;
    for (let k = 1; k <= left && ok; k++) {
      const o = src[j - k];
      if (!fin(o) || (isHigh ? o! >= v! : o! <= v!)) ok = false;
    }
    for (let k = 1; k <= right && ok; k++) {
      const o = src[j + k];
      if (!fin(o) || (isHigh ? o! >= v! : o! <= v!)) ok = false;
    }
    if (ok) out[j + right] = v!;
  }
  return out;
}

/** Bars ago of the window's extreme (0 = the current bar is the extreme; ties → most recent). */
function sinceExtremeSeries(src: number[], length: number, isMax: boolean): TaOut {
  const out: TaOut = new Array(src.length).fill(null);
  for (let i = length - 1; i < src.length; i++) {
    let best = NaN;
    let bestIdx = -1;
    let ok = true;
    for (let k = i - length + 1; k <= i; k++) {
      if (!fin(src[k])) {
        ok = false;
        break;
      }
      // `>=`/`<=` so ties resolve to the most recent bar.
      if (bestIdx < 0 || (isMax ? src[k]! >= best : src[k]! <= best)) {
        best = src[k]!;
        bestIdx = k;
      }
    }
    if (ok) out[i] = i - bestIdx;
  }
  return out;
}

/** Pearson correlation over a rolling window. */
function correlationSeries(a: number[], b: number[], length: number): TaOut {
  const out: TaOut = new Array(a.length).fill(null);
  for (let i = length - 1; i < a.length; i++) {
    let sa = 0;
    let sb = 0;
    let ok = true;
    for (let k = i - length + 1; k <= i; k++) {
      if (!fin(a[k]) || !fin(b[k])) {
        ok = false;
        break;
      }
      sa += a[k]!;
      sb += b[k]!;
    }
    if (!ok) continue;
    const ma = sa / length;
    const mb = sb / length;
    let cov = 0;
    let va = 0;
    let vb = 0;
    for (let k = i - length + 1; k <= i; k++) {
      const da = a[k]! - ma;
      const db = b[k]! - mb;
      cov += da * db;
      va += da * da;
      vb += db * db;
    }
    const den = Math.sqrt(va * vb);
    out[i] = den === 0 ? null : cov / den;
  }
  return out;
}

const sumWindow: WindowFold = (w) => w.reduce((s, x) => s + x, 0);
const meanWindow: WindowFold = (w) => sumWindow(w) / w.length;

/** `ta.*` (also callable bare: `ema(close, 12)`). */
export const TA: Record<string, TaFn> = {
  // ---- moving averages over an arbitrary series ----
  sma: { series: 1, compute: (s, n) => sma(s[0]!, len(n[0], 14)) },
  ema: { series: 1, compute: (s, n) => ema(s[0]!, len(n[0], 14)) },
  wma: { series: 1, compute: (s, n) => wma(s[0]!, len(n[0], 14)) },
  rma: { series: 1, compute: (s, n) => rma(s[0]!, len(n[0], 14)) },
  hma: { series: 1, compute: (s, n) => hma(s[0]!, len(n[0], 14)) },
  dema: { series: 1, compute: (s, n) => dema(s[0]!, len(n[0], 14)) },
  tema: { series: 1, compute: (s, n) => tema(s[0]!, len(n[0], 14)) },
  vwma: { series: 1, compute: (s, n, c) => vwmaSeries(s[0]!, len(n[0], 20), c) },
  linreg: { series: 1, compute: (s, n) => linregSeries(s[0]!, len(n[0], 14), int(n[1], 0)) },
  alma: { series: 1, compute: (s, n) => almaSeries(s[0]!, len(n[0], 9), fnum(n[1], 0.85), fnum(n[2], 6)) },
  swma: { series: 1, compute: (s) => roll(s[0]!, 4, (w) => (w[0]! + 2 * w[1]! + 2 * w[2]! + w[3]!) / 6) },

  // ---- oscillators / statistics over an arbitrary series ----
  rsi: { series: 1, compute: (s, n) => rsiSeries(s[0]!, len(n[0], 14)) },
  stdev: { series: 1, compute: (s, n) => stdev(s[0]!, len(n[0], 14)) },
  variance: { series: 1, compute: (s, n) => roll(s[0]!, len(n[0], 14), (w) => {
    const m = meanWindow(w);
    return w.reduce((acc, x) => acc + (x - m) * (x - m), 0) / w.length;
  }) },
  dev: { series: 1, compute: (s, n) => roll(s[0]!, len(n[0], 14), (w) => {
    const m = meanWindow(w);
    return w.reduce((acc, x) => acc + Math.abs(x - m), 0) / w.length;
  }) },
  median: { series: 1, compute: (s, n) => roll(s[0]!, len(n[0], 14), (w) => {
    const sorted = [...w].sort((x, y) => x - y);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }) },
  percentRank: { series: 1, compute: (s, n) => roll(s[0]!, len(n[0], 14), (w) => {
    const cur = w[w.length - 1]!;
    let below = 0;
    for (let k = 0; k < w.length - 1; k++) if (w[k]! <= cur) below += 1;
    return (100 * below) / (w.length - 1 || 1);
  }) },
  cmo: { series: 1, compute: (s, n) => cmoSeries(s[0]!, len(n[0], 9)) },
  tsi: { series: 1, compute: (s, n) => tsiSeries(s[0]!, len(n[0], 13), len(n[1], 25)) },
  roc: { series: 1, compute: (s, n) => rocSeries(s[0]!, len(n[0], 10)) },
  mom: {
    series: 1,
    compute: (s, n) => {
      const k = len(n[0], 10);
      const a = s[0]!;
      return a.map((_, i) => (i - k >= 0 && fin(a[i]) && fin(a[i - k]) ? a[i]! - a[i - k]! : null));
    },
  },
  cog: { series: 1, compute: (s, n) => cogSeries(s[0]!, len(n[0], 9)) },
  change: {
    series: 1,
    compute: (s, n) => {
      const k = len(n[0], 1);
      const a = s[0]!;
      return a.map((_, i) => (i - k >= 0 && fin(a[i]) && fin(a[i - k]) ? a[i]! - a[i - k]! : null));
    },
  },
  cum: {
    series: 1,
    compute: (s) => {
      const a = s[0]!;
      const out: TaOut = new Array(a.length).fill(null);
      let acc = 0;
      for (let i = 0; i < a.length; i++) {
        if (fin(a[i])) acc += a[i]!;
        out[i] = acc;
      }
      return out;
    },
  },
  sum: { series: 1, compute: (s, n) => roll(s[0]!, len(n[0], 14), sumWindow) },
  highest: { series: 1, compute: (s, n) => rollMax(s[0]!, len(n[0], 14)) },
  lowest: { series: 1, compute: (s, n) => rollMin(s[0]!, len(n[0], 14)) },
  sinceHighest: { series: 1, compute: (s, n) => sinceExtremeSeries(s[0]!, len(n[0], 14), true) },
  sinceLowest: { series: 1, compute: (s, n) => sinceExtremeSeries(s[0]!, len(n[0], 14), false) },
  correlation: { series: 2, compute: (s, n) => correlationSeries(s[0]!, s[1]!, len(n[0], 14)) },

  // ---- event / state helpers ----
  rising: { series: 1, compute: (s, n) => seriesTrend(s[0]!, len(n[0], 1), true) },
  falling: { series: 1, compute: (s, n) => seriesTrend(s[0]!, len(n[0], 1), false) },
  crossOver: { series: 2, compute: (s) => crossSeries(s[0]!, s[1]!, 'over') },
  crossUnder: { series: 2, compute: (s) => crossSeries(s[0]!, s[1]!, 'under') },
  cross: { series: 2, compute: (s) => crossSeries(s[0]!, s[1]!, 'any') },
  since: { series: 1, compute: (s) => sinceSeries(s[0]!) },
  lastWhen: { series: 2, compute: (s, n) => lastWhenSeries(s[0]!, s[1]!, Math.max(0, int(n[0], 0))) },
  hold: { series: 1, compute: (s) => holdSeries(s[0]!) },
  pivotHigh: { series: 1, compute: (s, n) => pivotSeries(s[0]!, len(n[0], 5), len(n[1], 5), true) },
  pivotLow: { series: 1, compute: (s, n) => pivotSeries(s[0]!, len(n[0], 5), len(n[1], 5), false) },

  // ---- candle-based studies (read OHLCV directly) ----
  atr: { series: 0, compute: (_s, n, c) => atr(c, { length: len(n[0], 14) }) },
  tr: { series: 0, compute: (_s, _n, c) => trueRange(c) },
  vwap: { series: 0, compute: (_s, _n, c) => vwap(c) },
  cci: { series: 0, compute: (_s, n, c) => cci(c, { length: len(n[0], 20) }) },
  mfi: { series: 0, compute: (_s, n, c) => mfi(c, { length: len(n[0], 14) }) },
  willr: { series: 0, compute: (_s, n, c) => williamsR(c, { length: len(n[0], 14) }) },
  obv: { series: 0, compute: (_s, _n, c) => obv(c) },
  cmf: { series: 0, compute: (_s, n, c) => cmf(c, { length: len(n[0], 20) }) },
  rvol: { series: 0, compute: (_s, n, c) => rvol(c, { length: len(n[0], 20) }) },
  sar: {
    series: 0,
    compute: (_s, n, c) => psar(c, { start: fnum(n[0], 0.02), step: fnum(n[1], 0.02), max: fnum(n[2], 0.2) }),
  },
  macd: {
    series: 0,
    compute: (_s, n, c) => macd(c, { fast: len(n[0], 12), slow: len(n[1], 26), signal: len(n[2], 9) }).macd,
  },
  stoch: {
    series: 0,
    compute: (_s, n, c) =>
      stochastic(c, { kLength: len(n[0], 14), kSmooth: len(n[1], 3), dSmooth: len(n[2], 3) }).k,
  },

  // ---- multi-output studies → record values ----
  macdFull: {
    series: 0,
    outputs: ['line', 'signal', 'histo'],
    compute: (_s, n, c) => {
      const r = macd(c, { fast: len(n[0], 12), slow: len(n[1], 26), signal: len(n[2], 9) });
      return { line: r.macd, signal: r.signal, histo: r.histogram };
    },
  },
  stochFull: {
    series: 0,
    outputs: ['k', 'd'],
    compute: (_s, n, c) => {
      const r = stochastic(c, { kLength: len(n[0], 14), kSmooth: len(n[1], 3), dSmooth: len(n[2], 3) });
      return { k: r.k, d: r.d };
    },
  },
  bands: {
    series: 0,
    outputs: ['upper', 'mid', 'lower', 'width', 'pctB'],
    compute: (_s, n, c) => {
      const r = bollinger(c, { length: len(n[0], 20), multiplier: fnum(n[1], 2) });
      return { upper: r.upper, mid: r.middle, lower: r.lower, width: r.bandwidth, pctB: r.percentB };
    },
  },
  channel: {
    series: 0,
    outputs: ['upper', 'mid', 'lower'],
    compute: (_s, n, c) => {
      const r = keltner(c, { emaLength: len(n[0], 20), atrLength: len(n[1], 10), multiplier: fnum(n[2], 2) });
      return { upper: r.upper, mid: r.middle, lower: r.lower };
    },
  },
  donchian: {
    series: 0,
    outputs: ['upper', 'mid', 'lower'],
    compute: (_s, n, c) => {
      const r = donchian(c, { length: len(n[0], 20) });
      return { upper: r.upper, mid: r.middle, lower: r.lower };
    },
  },
  dmi: {
    series: 0,
    outputs: ['plus', 'minus', 'adx'],
    compute: (_s, n, c) => {
      const r = adx(c, { length: len(n[0], 14) });
      return { plus: r.plusDI, minus: r.minusDI, adx: r.adx };
    },
  },
  supertrend: {
    series: 0,
    outputs: ['line', 'dir'],
    compute: (_s, n, c) => {
      const r = supertrend(c, { multiplier: fnum(n[0], 3), atrLength: len(n[1], 10) });
      return { line: r.line, dir: r.direction };
    },
  },
  ichimoku: {
    series: 0,
    outputs: ['conversion', 'base', 'spanA', 'spanB', 'lagging'],
    compute: (_s, n, c) => {
      const r = ichimoku(c, { conversion: len(n[0], 9), base: len(n[1], 26), spanB: len(n[2], 52) });
      return { conversion: r.conversion, base: r.base, spanA: r.spanA, spanB: r.spanB, lagging: r.lagging };
    },
  },
  aroon: {
    series: 0,
    outputs: ['up', 'down', 'osc'],
    compute: (_s, n, c) => {
      const r = aroon(c, { length: len(n[0], 25) });
      return { up: r.up, down: r.down, osc: r.oscillator };
    },
  },
};
