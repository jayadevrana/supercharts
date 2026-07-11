import type { TA } from '@supercharts/script-lang';
import type { DocEntry } from '../reference-types';

/**
 * `ta.*` reference — every technical function in the standard library, keyed against the real
 * TA object; the runtime coverage test (tests/docs-reference.test.ts) fails if a study lacks
 * a doc entry. Bare-callable too
 * (`ema(close, 12)` == `ta.ema(close, 12)`). Every `example` is executed through the real
 * interpreter in tests/docs-reference.test.ts.
 *
 * Grouping is by the `group` field: 'ma' · 'stat' · 'event' · 'candle' · 'record'.
 */
type TaGroup = 'ma' | 'stat' | 'event' | 'candle' | 'record';
export type TaDocEntry = DocEntry & { group: TaGroup };

const src: DocParamShort = { name: 'source', type: 'series', desc: 'Input series, e.g. `close`.' };
type DocParamShort = { name: string; type: string; desc: string };
const len = (d: number): DocParamShort => ({ name: 'length', type: 'number', desc: `Window length (default ${d}).` });

export const TA_DOCS: Record<keyof typeof TA, TaDocEntry> = {
  // ─────────────── Moving averages (over an arbitrary series) ───────────────
  sma: {
    group: 'ma', signature: 'ta.sma(source, length) → series',
    summary: 'Simple moving average — the mean of the last `length` values.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.sma(close, 20), title: "SMA 20")',
  },
  ema: {
    group: 'ma', signature: 'ta.ema(source, length) → series',
    summary: 'Exponential moving average — weights recent bars more heavily.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.ema(close, 21), title: "EMA 21")',
  },
  wma: {
    group: 'ma', signature: 'ta.wma(source, length) → series',
    summary: 'Weighted moving average — linearly increasing weights toward the newest bar.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.wma(close, 20), title: "WMA 20")',
  },
  rma: {
    group: 'ma', signature: 'ta.rma(source, length) → series',
    summary: 'Wilder’s smoothing (running MA) — the basis of RSI, ATR and ADX.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.rma(close, 14), title: "RMA 14")',
  },
  hma: {
    group: 'ma', signature: 'ta.hma(source, length) → series',
    summary: 'Hull moving average — very low lag, smooth response.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.hma(close, 21), title: "HMA 21")',
  },
  dema: {
    group: 'ma', signature: 'ta.dema(source, length) → series',
    summary: 'Double exponential moving average — reduced lag vs a plain EMA.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.dema(close, 21), title: "DEMA 21")',
  },
  tema: {
    group: 'ma', signature: 'ta.tema(source, length) → series',
    summary: 'Triple exponential moving average — even less lag than DEMA.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.tema(close, 21), title: "TEMA 21")',
  },
  vwma: {
    group: 'ma', signature: 'ta.vwma(source, length) → series',
    summary: 'Volume-weighted moving average — weights each bar by its volume.',
    params: [src, len(20)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.vwma(close, 20), title: "VWMA 20")',
  },
  linreg: {
    group: 'ma', signature: 'ta.linreg(source, length, offset?) → series',
    summary: 'Linear-regression curve — the endpoint of a least-squares line over the window.',
    params: [src, len(14), { name: 'offset', type: 'number?', desc: 'Bars back from the endpoint (default 0).' }], returns: 'series',
    example: 'pulse 1\ndraw line(ta.linreg(close, 20), title: "LinReg 20")',
  },
  alma: {
    group: 'ma', signature: 'ta.alma(source, length, offset?, sigma?) → series',
    summary: 'Arnaud Legoux MA — Gaussian-weighted; `offset` shifts phase, `sigma` sets smoothness.',
    params: [src, len(9), { name: 'offset', type: 'number?', desc: 'Phase 0–1 (default 0.85).' }, { name: 'sigma', type: 'number?', desc: 'Smoothness (default 6).' }], returns: 'series',
    example: 'pulse 1\ndraw line(ta.alma(close, 9, 0.85, 6), title: "ALMA")',
  },
  swma: {
    group: 'ma', signature: 'ta.swma(source) → series',
    summary: 'Symmetrically-weighted moving average over a fixed 4-bar window (1/6, 2/6, 2/6, 1/6).',
    params: [src], returns: 'series',
    example: 'pulse 1\ndraw line(ta.swma(close), title: "SWMA")',
  },

  // ─────────────── Oscillators / statistics (over a series) ───────────────
  rsi: {
    group: 'stat', signature: 'ta.rsi(source, length) → series (0–100)',
    summary: 'Relative Strength Index — momentum oscillator; >70 overbought, <30 oversold.',
    params: [src, len(14)], returns: 'series (0–100)',
    example: 'pulse 1\nmeta(name: "RSI", overlay: false)\ndraw line(ta.rsi(close, 14), title: "RSI")',
  },
  stdev: {
    group: 'stat', signature: 'ta.stdev(source, length) → series',
    summary: 'Rolling standard deviation of the series.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.stdev(close, 20), title: "StdDev")',
  },
  variance: {
    group: 'stat', signature: 'ta.variance(source, length) → series',
    summary: 'Rolling variance (standard deviation squared).',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.variance(close, 20), title: "Variance")',
  },
  dev: {
    group: 'stat', signature: 'ta.dev(source, length) → series',
    summary: 'Rolling mean absolute deviation from the window mean.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.dev(close, 20), title: "Mean Abs Dev")',
  },
  median: {
    group: 'stat', signature: 'ta.median(source, length) → series',
    summary: 'Rolling median of the series.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.median(close, 20), title: "Median")',
  },
  percentRank: {
    group: 'stat', signature: 'ta.percentRank(source, length) → series (0–100)',
    summary: 'Percent of prior bars in the window at or below the current value.',
    params: [src, len(14)], returns: 'series (0–100)',
    example: 'pulse 1\nmeta(name: "PctRank", overlay: false)\ndraw line(ta.percentRank(close, 50), title: "Percent Rank")',
  },
  cmo: {
    group: 'stat', signature: 'ta.cmo(source, length) → series (-100–100)',
    summary: 'Chande Momentum Oscillator — up/down sums, un-smoothed.',
    params: [src, len(9)], returns: 'series (-100–100)',
    example: 'pulse 1\nmeta(name: "CMO", overlay: false)\ndraw line(ta.cmo(close, 9), title: "CMO")',
  },
  tsi: {
    group: 'stat', signature: 'ta.tsi(source, short?, long?) → series',
    summary: 'True Strength Index — double-EMA-smoothed momentum, ×100.',
    params: [src, { name: 'short', type: 'number?', desc: 'Short smoothing (default 13).' }, { name: 'long', type: 'number?', desc: 'Long smoothing (default 25).' }], returns: 'series',
    example: 'pulse 1\nmeta(name: "TSI", overlay: false)\ndraw line(ta.tsi(close, 13, 25), title: "TSI")',
  },
  roc: {
    group: 'stat', signature: 'ta.roc(source, length) → series (%)',
    summary: 'Rate of change — percent change over `length` bars.',
    params: [src, len(10)], returns: 'series (%)',
    example: 'pulse 1\nmeta(name: "ROC", overlay: false)\ndraw line(ta.roc(close, 10), title: "ROC")',
  },
  mom: {
    group: 'stat', signature: 'ta.mom(source, length) → series',
    summary: 'Momentum — the raw difference `source − source[length]`.',
    params: [src, len(10)], returns: 'series',
    example: 'pulse 1\nmeta(name: "Momentum", overlay: false)\ndraw line(ta.mom(close, 10), title: "Mom")',
  },
  cog: {
    group: 'stat', signature: 'ta.cog(source, length) → series',
    summary: 'Center of Gravity (Ehlers) — a smoothed, low-lag oscillator.',
    params: [src, len(9)], returns: 'series',
    example: 'pulse 1\nmeta(name: "CoG", overlay: false)\ndraw line(ta.cog(close, 10), title: "CoG")',
  },
  change: {
    group: 'stat', signature: 'ta.change(source, length?) → series',
    summary: 'Difference between the current value and `length` bars ago (default 1).',
    params: [src, { name: 'length', type: 'number?', desc: 'Bars back (default 1).' }], returns: 'series',
    example: 'pulse 1\ndraw hist(ta.change(close), title: "bar-to-bar change")',
  },
  cum: {
    group: 'stat', signature: 'ta.cum(source) → series',
    summary: 'Cumulative running sum of the series from the first bar.',
    params: [src], returns: 'series',
    example: 'pulse 1\nmeta(name: "Cumulative", overlay: false)\ndraw line(ta.cum(ta.change(close)), title: "cum change")',
  },
  sum: {
    group: 'stat', signature: 'ta.sum(source, length) → series',
    summary: 'Rolling sum over the last `length` bars.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\nmeta(name: "Vol sum", overlay: false)\ndraw line(ta.sum(volume, 20), title: "20-bar volume")',
  },
  highest: {
    group: 'stat', signature: 'ta.highest(source, length) → series',
    summary: 'Highest value over the last `length` bars.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.highest(high, 20), title: "20-bar high")',
  },
  lowest: {
    group: 'stat', signature: 'ta.lowest(source, length) → series',
    summary: 'Lowest value over the last `length` bars.',
    params: [src, len(14)], returns: 'series',
    example: 'pulse 1\ndraw line(ta.lowest(low, 20), title: "20-bar low")',
  },
  sinceHighest: {
    group: 'stat', signature: 'ta.sinceHighest(source, length) → series',
    summary: 'Bars ago the window’s highest value occurred (0 = current bar).',
    params: [src, len(14)], returns: 'series (bars)',
    example: 'pulse 1\nmeta(name: "Bars since high", overlay: false)\ndraw line(ta.sinceHighest(high, 20), title: "bars since high")',
  },
  sinceLowest: {
    group: 'stat', signature: 'ta.sinceLowest(source, length) → series',
    summary: 'Bars ago the window’s lowest value occurred (0 = current bar).',
    params: [src, len(14)], returns: 'series (bars)',
    example: 'pulse 1\nmeta(name: "Bars since low", overlay: false)\ndraw line(ta.sinceLowest(low, 20), title: "bars since low")',
  },
  correlation: {
    group: 'stat', signature: 'ta.correlation(a, b, length) → series (-1–1)',
    summary: 'Rolling Pearson correlation between two series.',
    params: [{ name: 'a', type: 'series', desc: 'First series.' }, { name: 'b', type: 'series', desc: 'Second series.' }, len(14)], returns: 'series (-1–1)',
    example: 'pulse 1\nmeta(name: "Corr", overlay: false)\ndraw line(ta.correlation(close, volume, 20), title: "price/volume corr")',
  },

  // ─────────────── Event / state helpers ───────────────
  rising: {
    group: 'event', signature: 'ta.rising(source, length) → bool',
    summary: 'True when the series rose on each of the last `length` bars.',
    params: [src, len(1)], returns: 'bool',
    example: 'pulse 1\nwhen ta.rising(close, 3): mark note at high "3 up"',
  },
  falling: {
    group: 'event', signature: 'ta.falling(source, length) → bool',
    summary: 'True when the series fell on each of the last `length` bars.',
    params: [src, len(1)], returns: 'bool',
    example: 'pulse 1\nwhen ta.falling(close, 3): mark note at low "3 down"',
  },
  crossOver: {
    group: 'event', signature: 'ta.crossOver(a, b) → bool',
    summary: 'True on the bar where `a` crosses above `b`.',
    params: [{ name: 'a', type: 'series', desc: 'Fast series.' }, { name: 'b', type: 'series', desc: 'Slow series.' }], returns: 'bool',
    example: 'pulse 1\nwhen ta.crossOver(ema(close, 9), ema(close, 21)): mark buy at low "Long"',
  },
  crossUnder: {
    group: 'event', signature: 'ta.crossUnder(a, b) → bool',
    summary: 'True on the bar where `a` crosses below `b`.',
    params: [{ name: 'a', type: 'series', desc: 'Fast series.' }, { name: 'b', type: 'series', desc: 'Slow series.' }], returns: 'bool',
    example: 'pulse 1\nwhen ta.crossUnder(ema(close, 9), ema(close, 21)): mark sell at high "Short"',
  },
  cross: {
    group: 'event', signature: 'ta.cross(a, b) → bool',
    summary: 'True on any bar where `a` and `b` cross (either direction).',
    params: [{ name: 'a', type: 'series', desc: 'First series.' }, { name: 'b', type: 'series', desc: 'Second series.' }], returns: 'bool',
    example: 'pulse 1\nwhen ta.cross(ema(close, 9), ema(close, 21)): mark note at high "cross"',
  },
  since: {
    group: 'event', signature: 'ta.since(condition) → series',
    summary: 'Bars since `condition` was last true (none before the first occurrence).',
    params: [{ name: 'condition', type: 'bool series', desc: 'The event to count from.' }], returns: 'series (bars)',
    example: 'pulse 1\nmeta(name: "Bars since cross", overlay: false)\ndraw line(ta.since(ta.crossOver(ema(close, 9), ema(close, 21))), title: "bars since cross")',
  },
  lastWhen: {
    group: 'event', signature: 'ta.lastWhen(condition, source, back?) → series',
    summary: 'Value of `source` at the `back`-th most recent bar where `condition` was true (0 = latest).',
    params: [{ name: 'condition', type: 'bool series', desc: 'The event.' }, { name: 'source', type: 'series', desc: 'Value to read.' }, { name: 'back', type: 'number?', desc: 'How many occurrences back (default 0).' }], returns: 'series',
    example: 'pulse 1\ndraw line(ta.lastWhen(ta.crossOver(ema(close, 9), ema(close, 21)), close, 0), title: "price at last cross")',
  },
  hold: {
    group: 'event', signature: 'ta.hold(source) → series',
    summary: 'Carry the last finite value forward (fills gaps / none values).',
    params: [{ name: 'source', type: 'series', desc: 'Possibly-gappy series.' }], returns: 'series',
    example: 'pulse 1\ndraw line(ta.hold(ta.pivotHigh(high, 5, 5)), title: "last pivot high held")',
  },
  pivotHigh: {
    group: 'event', signature: 'ta.pivotHigh(source, left, right) → series',
    summary: 'Confirmed swing high — a bar above its `left`/`right` neighbours; appears on the confirmation bar (no repaint).',
    params: [{ name: 'source', type: 'series', desc: 'Usually `high`.' }, { name: 'left', type: 'number', desc: 'Bars to the left (default 5).' }, { name: 'right', type: 'number', desc: 'Bars to the right (default 5).' }], returns: 'series (pivot price)',
    example: 'pulse 1\ndraw dots(ta.pivotHigh(high, 5, 5), color: "#ef4444", title: "pivot high")',
  },
  pivotLow: {
    group: 'event', signature: 'ta.pivotLow(source, left, right) → series',
    summary: 'Confirmed swing low — a bar below its `left`/`right` neighbours; appears on the confirmation bar (no repaint).',
    params: [{ name: 'source', type: 'series', desc: 'Usually `low`.' }, { name: 'left', type: 'number', desc: 'Bars to the left (default 5).' }, { name: 'right', type: 'number', desc: 'Bars to the right (default 5).' }], returns: 'series (pivot price)',
    example: 'pulse 1\ndraw dots(ta.pivotLow(low, 5, 5), color: "#22c55e", title: "pivot low")',
  },

  // ─────────────── Candle-based studies (read OHLCV directly) ───────────────
  atr: {
    group: 'candle', signature: 'ta.atr(length) → series',
    summary: 'Average True Range — Wilder-smoothed volatility.',
    params: [len(14)], returns: 'series',
    example: 'pulse 1\nmeta(name: "ATR", overlay: false)\ndraw line(ta.atr(14), title: "ATR 14")',
  },
  tr: {
    group: 'candle', signature: 'ta.tr() → series',
    summary: 'True Range of each bar (before smoothing).',
    params: [], returns: 'series',
    example: 'pulse 1\nmeta(name: "True Range", overlay: false)\ndraw line(ta.tr(), title: "TR")',
  },
  vwap: {
    group: 'candle', signature: 'ta.vwap() → series',
    summary: 'Volume-Weighted Average Price for the session.',
    params: [], returns: 'series',
    example: 'pulse 1\ndraw line(ta.vwap(), color: "#f59e0b", title: "VWAP")',
  },
  cci: {
    group: 'candle', signature: 'ta.cci(length) → series',
    summary: 'Commodity Channel Index — deviation of typical price from its average.',
    params: [len(20)], returns: 'series',
    example: 'pulse 1\nmeta(name: "CCI", overlay: false)\ndraw line(ta.cci(20), title: "CCI 20")',
  },
  mfi: {
    group: 'candle', signature: 'ta.mfi(length) → series (0–100)',
    summary: 'Money Flow Index — volume-weighted RSI.',
    params: [len(14)], returns: 'series (0–100)',
    example: 'pulse 1\nmeta(name: "MFI", overlay: false)\ndraw line(ta.mfi(14), title: "MFI 14")',
  },
  willr: {
    group: 'candle', signature: 'ta.willr(length) → series (-100–0)',
    summary: 'Williams %R — where the close sits in the recent high/low range.',
    params: [len(14)], returns: 'series (-100–0)',
    example: 'pulse 1\nmeta(name: "Williams %R", overlay: false)\ndraw line(ta.willr(14), title: "%R")',
  },
  obv: {
    group: 'candle', signature: 'ta.obv() → series',
    summary: 'On-Balance Volume — cumulative volume signed by price direction.',
    params: [], returns: 'series',
    example: 'pulse 1\nmeta(name: "OBV", overlay: false)\ndraw line(ta.obv(), title: "OBV")',
  },
  cmf: {
    group: 'candle', signature: 'ta.cmf(length) → series (-1–1)',
    summary: 'Chaikin Money Flow — buying/selling pressure over the window.',
    params: [len(20)], returns: 'series (-1–1)',
    example: 'pulse 1\nmeta(name: "CMF", overlay: false)\ndraw line(ta.cmf(20), title: "CMF 20")',
  },
  rvol: {
    group: 'candle', signature: 'ta.rvol(length) → series',
    summary: 'Relative volume — current volume vs its `length`-bar average (2 = twice normal).',
    params: [len(20)], returns: 'series',
    example: 'pulse 1\nmeta(name: "RVOL", overlay: false)\ndraw line(ta.rvol(20), title: "RVOL")',
  },
  sar: {
    group: 'candle', signature: 'ta.sar(start?, step?, max?) → series',
    summary: 'Parabolic SAR — trailing stop-and-reverse dots.',
    params: [{ name: 'start', type: 'number?', desc: 'Initial acceleration (default 0.02).' }, { name: 'step', type: 'number?', desc: 'Acceleration step (default 0.02).' }, { name: 'max', type: 'number?', desc: 'Max acceleration (default 0.2).' }], returns: 'series',
    example: 'pulse 1\ndraw dots(ta.sar(0.02, 0.02, 0.2), color: "#a78bfa", title: "SAR")',
  },
  macd: {
    group: 'candle', signature: 'ta.macd(fast?, slow?, signal?) → series',
    summary: 'MACD line (fast EMA − slow EMA). For all three lines use `ta.macdFull`.',
    params: [{ name: 'fast', type: 'number?', desc: 'Fast EMA (default 12).' }, { name: 'slow', type: 'number?', desc: 'Slow EMA (default 26).' }, { name: 'signal', type: 'number?', desc: 'Signal EMA (default 9).' }], returns: 'series',
    example: 'pulse 1\nmeta(name: "MACD line", overlay: false)\ndraw line(ta.macd(12, 26, 9), title: "MACD")',
  },
  stoch: {
    group: 'candle', signature: 'ta.stoch(kLength?, kSmooth?, dSmooth?) → series (0–100)',
    summary: 'Stochastic %K line. For %K and %D use `ta.stochFull`.',
    params: [{ name: 'kLength', type: 'number?', desc: '%K lookback (default 14).' }, { name: 'kSmooth', type: 'number?', desc: '%K smoothing (default 3).' }, { name: 'dSmooth', type: 'number?', desc: '%D smoothing (default 3).' }], returns: 'series (0–100)',
    example: 'pulse 1\nmeta(name: "Stoch", overlay: false)\ndraw line(ta.stoch(14, 3, 3), title: "%K")',
  },

  // ─────────────── Multi-output studies → record values ───────────────
  macdFull: {
    group: 'record', signature: 'ta.macdFull(fast?, slow?, signal?) → record { line, signal, histo }',
    summary: 'Full MACD — the MACD line, its signal EMA, and the histogram.',
    params: [{ name: 'fast', type: 'number?', desc: 'Fast EMA (default 12).' }, { name: 'slow', type: 'number?', desc: 'Slow EMA (default 26).' }, { name: 'signal', type: 'number?', desc: 'Signal EMA (default 9).' }], returns: 'record { line, signal, histo }',
    example: 'pulse 1\nmeta(name: "MACD", overlay: false)\nm = ta.macdFull(12, 26, 9)\ndraw line(m.line, color: "#38bdf8", title: "MACD")\ndraw line(m.signal, color: "#f59e0b", title: "signal")\ndraw hist(m.histo, title: "histogram")',
  },
  stochFull: {
    group: 'record', signature: 'ta.stochFull(kLength?, kSmooth?, dSmooth?) → record { k, d }',
    summary: 'Full Stochastic — the %K and %D lines.',
    params: [{ name: 'kLength', type: 'number?', desc: '%K lookback (default 14).' }, { name: 'kSmooth', type: 'number?', desc: '%K smoothing (default 3).' }, { name: 'dSmooth', type: 'number?', desc: '%D smoothing (default 3).' }], returns: 'record { k, d }',
    example: 'pulse 1\nmeta(name: "Stoch", overlay: false)\ns = ta.stochFull(14, 3, 3)\ndraw line(s.k, color: "#38bdf8", title: "%K")\ndraw line(s.d, color: "#f59e0b", title: "%D")',
  },
  bands: {
    group: 'record', signature: 'ta.bands(length?, mult?) → record { upper, mid, lower, width, pctB }',
    summary: 'Bollinger Bands — SMA basis ± `mult` standard deviations, plus width and %B.',
    params: [len(20), { name: 'mult', type: 'number?', desc: 'StdDev multiplier (default 2).' }], returns: 'record { upper, mid, lower, width, pctB }',
    example: 'pulse 1\nb = ta.bands(20, 2)\ndraw band(b.upper, b.lower, color: "rgba(124,156,255,0.15)", title: "BB")\ndraw line(b.mid, color: "#7c9cff", title: "basis")',
  },
  channel: {
    group: 'record', signature: 'ta.channel(emaLen?, atrLen?, mult?) → record { upper, mid, lower }',
    summary: 'Keltner Channel — EMA basis ± `mult` × ATR.',
    params: [{ name: 'emaLen', type: 'number?', desc: 'Basis EMA (default 20).' }, { name: 'atrLen', type: 'number?', desc: 'ATR length (default 10).' }, { name: 'mult', type: 'number?', desc: 'ATR multiplier (default 2).' }], returns: 'record { upper, mid, lower }',
    example: 'pulse 1\nk = ta.channel(20, 10, 2)\ndraw band(k.upper, k.lower, color: "rgba(34,197,94,0.12)", title: "Keltner")',
  },
  donchian: {
    group: 'record', signature: 'ta.donchian(length?) → record { upper, mid, lower }',
    summary: 'Donchian Channel — highest high and lowest low over the window.',
    params: [len(20)], returns: 'record { upper, mid, lower }',
    example: 'pulse 1\nd = ta.donchian(20)\ndraw band(d.upper, d.lower, color: "rgba(245,158,11,0.12)", title: "Donchian")',
  },
  dmi: {
    group: 'record', signature: 'ta.dmi(length?) → record { plus, minus, adx }',
    summary: 'Directional Movement — +DI, −DI and the ADX trend-strength line.',
    params: [len(14)], returns: 'record { plus, minus, adx }',
    example: 'pulse 1\nmeta(name: "DMI", overlay: false)\nd = ta.dmi(14)\ndraw line(d.plus, color: "#22c55e", title: "+DI")\ndraw line(d.minus, color: "#ef4444", title: "-DI")\ndraw line(d.adx, color: "#e6edf3", title: "ADX")',
  },
  supertrend: {
    group: 'record', signature: 'ta.supertrend(mult?, atrLen?) → record { line, dir }',
    summary: 'SuperTrend — an ATR trailing stop; `dir` is +1 up-trend / −1 down-trend.',
    params: [{ name: 'mult', type: 'number?', desc: 'ATR multiplier (default 3).' }, { name: 'atrLen', type: 'number?', desc: 'ATR length (default 10).' }], returns: 'record { line, dir }',
    example: 'pulse 1\nst = ta.supertrend(3, 10)\ndraw line(st.line, color: "#a78bfa", title: "SuperTrend")\nwhen st.dir > st.dir[1]: mark buy at low "flip up"',
  },
  ichimoku: {
    group: 'record', signature: 'ta.ichimoku(conv?, base?, spanB?) → record { conversion, base, spanA, spanB, lagging }',
    summary: 'Ichimoku Cloud — conversion/base lines, the two span (cloud) lines, and the lagging span.',
    params: [{ name: 'conv', type: 'number?', desc: 'Conversion length (default 9).' }, { name: 'base', type: 'number?', desc: 'Base length (default 26).' }, { name: 'spanB', type: 'number?', desc: 'Span B length (default 52).' }], returns: 'record { conversion, base, spanA, spanB, lagging }',
    example: 'pulse 1\ni = ta.ichimoku(9, 26, 52)\ndraw line(i.conversion, color: "#38bdf8", title: "Tenkan")\ndraw line(i.base, color: "#f59e0b", title: "Kijun")\ndraw band(i.spanA, i.spanB, color: "rgba(124,156,255,0.1)", title: "cloud")',
  },
  aroon: {
    group: 'record', signature: 'ta.aroon(length?) → record { up, down, osc }',
    summary: 'Aroon — how recently the window’s high/low occurred, plus the oscillator (up − down).',
    params: [len(25)], returns: 'record { up, down, osc }',
    example: 'pulse 1\nmeta(name: "Aroon", overlay: false)\na = ta.aroon(25)\ndraw line(a.up, color: "#22c55e", title: "up")\ndraw line(a.down, color: "#ef4444", title: "down")',
  },
};
