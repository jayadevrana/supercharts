import type { DocEntry } from '../reference-types';

/**
 * Output & helper reference — the constructs that put things on the chart or raise events:
 * `draw …`, `paint …`, `mark …`, `alert()`, `onTf(…)`, and the `nz`/`na` helpers.
 */
export const OUTPUT_DOCS: Record<string, DocEntry> = {
  'draw line': {
    signature: 'draw line(value, color:, title:, width:, style:)',
    summary: 'Plot a series as a line on the chart.',
    params: [
      { name: 'value', type: 'series', desc: 'The per-bar values to plot.' },
      { name: 'color / title / width / style', type: 'named', desc: '`style: "dashed" | "dotted"`, `width:` in px.' },
    ],
    returns: 'chart plot',
    example: 'pulse 1\ndraw line(ema(close, 20), color: "#38bdf8", title: "EMA 20")',
  },
  'draw area': {
    signature: 'draw area(value, color:, title:)',
    summary: 'Plot a series as a filled area from the zero line.',
    params: [{ name: 'value', type: 'series', desc: 'Per-bar values.' }],
    returns: 'chart plot',
    example: 'pulse 1\nmeta(name: "RSI", overlay: false)\ndraw area(rsi(close, 14), color: "#7c9cff", title: "RSI")',
  },
  'draw steps': {
    signature: 'draw steps(value, color:, title:)',
    summary: 'Plot a series as a step line (holds each value until the next).',
    params: [{ name: 'value', type: 'series', desc: 'Per-bar values.' }],
    returns: 'chart plot',
    example: 'pulse 1\ndraw steps(sma(close, 20), title: "SMA steps")',
  },
  'draw dots': {
    signature: 'draw dots(value, color:, title:)',
    summary: 'Plot a series as discrete dots.',
    params: [{ name: 'value', type: 'series', desc: 'Per-bar values.' }],
    returns: 'chart plot',
    example: 'pulse 1\ndraw dots(ta.pivotHigh(high, 5, 5), color: "#ef4444", title: "pivots")',
  },
  'draw hist': {
    signature: 'draw hist(value, color:, title:)',
    summary: 'Plot a series as a histogram of bars from the zero line.',
    params: [{ name: 'value', type: 'series', desc: 'Per-bar values (often a difference).' }],
    returns: 'chart plot',
    example: 'pulse 1\nmeta(name: "MACD hist", overlay: false)\ndraw hist(ta.macdFull().histo, title: "histogram")',
  },
  'draw band': {
    signature: 'draw band(upper, lower, color:, title:)',
    summary: 'Fill the area between two series (e.g. Bollinger Bands).',
    params: [
      { name: 'upper', type: 'series', desc: 'Top edge.' },
      { name: 'lower', type: 'series', desc: 'Bottom edge.' },
    ],
    returns: 'chart plot',
    example: 'pulse 1\nb = ta.bands(20, 2)\ndraw band(b.upper, b.lower, color: "rgba(124,156,255,0.15)", title: "BB")',
  },
  'draw level': {
    signature: 'draw level(y, color:, title:, style:)',
    summary: 'A constant horizontal reference line at price/value `y`.',
    params: [{ name: 'y', type: 'number', desc: 'The level.' }],
    returns: 'chart level',
    example: 'pulse 1\nmeta(name: "RSI", overlay: false)\ndraw line(rsi(close, 14), title: "RSI")\ndraw level(70, color: "#ef4444", title: "overbought")\ndraw level(30, color: "#22c55e", title: "oversold")',
  },
  'draw marker': {
    signature: 'draw marker(cond, at:, shape:, color:, text:, size:)',
    summary: 'Draw a shape on bars where `cond` is true. Shapes: circle, square, diamond, cross, triangleUp/Down, arrowUp/Down, flag.',
    params: [
      { name: 'cond', type: 'bool', desc: 'When to place the marker.' },
      { name: 'at', type: '"above" | "below" | number', desc: 'Position relative to the bar, or an explicit price.' },
      { name: 'shape / color / text / size', type: 'named', desc: 'Appearance.' },
    ],
    returns: 'chart markers',
    example: 'pulse 1\ndraw marker(crossOver(ema(close, 9), ema(close, 21)), at: "below", shape: "triangleUp", color: "#22c55e")',
  },
  'mark buy / sell / note': {
    signature: 'mark buy|sell|note at <price> "text"',
    summary: 'Drop a signal marker. `mark buy`/`sell` are also what the backtester trades and the scanner matches on the last closed bar.',
    params: [
      { name: 'at <price>', type: 'series', desc: 'Where to anchor it, e.g. `at low` / `at high`.' },
      { name: '"text"', type: 'text?', desc: 'Optional label baked onto the marker.' },
    ],
    returns: 'signal markers',
    example: 'pulse 1\nwhen crossOver(ema(close, 9), ema(close, 21)): mark buy at low "Long"\nwhen crossUnder(ema(close, 9), ema(close, 21)): mark sell at high "Short"',
  },
  'paint bg': {
    signature: 'paint bg(color)',
    summary: 'Tint the chart background on the current bar (usually gated by a condition).',
    params: [{ name: 'color', type: 'color', desc: 'An rgba() colour with low opacity works best.' }],
    returns: 'background tint',
    example: 'pulse 1\nwhen close > open: paint bg(rgba(34, 197, 94, 0.06))\nwhen close < open: paint bg(rgba(239, 68, 68, 0.06))',
  },
  'paint candles': {
    signature: 'paint candles(color)',
    summary: 'Recolour the candle body on the current bar.',
    params: [{ name: 'color', type: 'color', desc: 'The candle colour for this bar.' }],
    returns: 'candle tint',
    example: 'pulse 1\nwhen rsi(close, 14) > 70: paint candles(rgba(239, 68, 68, 0.8))\nwhen rsi(close, 14) < 30: paint candles(rgba(34, 197, 94, 0.8))',
  },
  'alert()': {
    signature: 'alert("message")',
    summary: 'Raise an alert event on the current bar — captured in the console today; the live alert-engine bridge lands in a coming release.',
    params: [{ name: 'message', type: 'text', desc: 'The alert text.' }],
    returns: 'alert event',
    example: 'pulse 1\nwhen crossOver(ema(close, 9), ema(close, 21)): alert("EMA 9 crossed above EMA 21")',
  },
  'onTf()': {
    signature: 'onTf(timeframe, expr) → series',
    summary: 'Evaluate an expression on a higher timeframe, mapping back only COMPLETED bars — strict no-repaint.',
    params: [
      { name: 'timeframe', type: 'text', desc: 'Higher timeframe, e.g. "4h", "1d".' },
      { name: 'expr', type: 'series', desc: 'Any price / ta.* expression to compute on that timeframe.' },
    ],
    returns: 'series (HTF value mapped to chart bars)',
    example: 'pulse 1\nhtfTrend = onTf("4h", ema(close, 20))\ndraw line(htfTrend, color: "#a78bfa", title: "4h EMA 20")',
  },
  'nz()': {
    signature: 'nz(x, replacement?) → number',
    summary: 'Replace none / non-finite values with `replacement` (default 0).',
    params: [
      { name: 'x', type: 'number', desc: 'Value that might be none.' },
      { name: 'replacement', type: 'number?', desc: 'Fallback (default 0).' },
    ],
    returns: 'number',
    example: 'pulse 1\ndraw line(nz(sma(close, 50), close), title: "SMA (close during warmup)")',
  },
  'na()': {
    signature: 'na(x) → bool',
    summary: 'True when x is none / not-a-number (e.g. during an indicator’s warmup).',
    params: [{ name: 'x', type: 'number', desc: 'Value to test.' }],
    returns: 'bool',
    example: 'pulse 1\nwhen na(sma(close, 50)): mark note at high "warming up"',
  },
};
