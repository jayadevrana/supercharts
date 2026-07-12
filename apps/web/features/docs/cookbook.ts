/**
 * PulseScript cookbook — complete, practical recipes shown on /docs/cookbook. Each `code`
 * string is a real script; `tests/docs-cookbook.test.ts` runs EVERY one through the interpreter
 * and asserts it produces output, so nothing here is decorative or copy-paste-broken.
 *
 * Recipes reuse the exact `ta.*` engine the chart, backtester, scanner and alerts share, so a
 * cookbook script behaves identically wherever you run it.
 */

export type RecipeCategory = 'Trend' | 'Momentum' | 'Volatility' | 'Volume' | 'Multi-timeframe' | 'Alerts';

export interface Recipe {
  id: string;
  title: string;
  category: RecipeCategory;
  blurb: string;
  code: string;
}

export const RECIPES: Recipe[] = [
  {
    id: 'ma-cross-filter',
    title: 'Moving-average cross with a trend filter',
    category: 'Trend',
    blurb:
      'The classic fast/slow EMA cross, but longs only fire above the 200-period trend — the single filter that removes most chop-market whipsaws.',
    code: `pulse 1
meta(name: "MA Cross + Filter", overlay: true)

fast = ema(close, 20)
slow = ema(close, 50)
trend = sma(close, 200)

draw line(fast, color: "#38bdf8", title: "EMA 20")
draw line(slow, color: "#f59e0b", title: "EMA 50")

when crossOver(fast, slow) and close > trend: mark buy at low "Long"
when crossUnder(fast, slow): mark sell at high "Exit"
`,
  },
  {
    id: 'supertrend-flip',
    title: 'SuperTrend trailing-stop flips',
    category: 'Trend',
    blurb:
      'An ATR trailing stop that flips direction with the trend. Mark the exact flip bar and tint the candles by regime so the state is obvious at a glance.',
    code: `pulse 1
meta(name: "SuperTrend Signals", overlay: true)

st = ta.supertrend(3, 10)
draw line(st.line, color: "#a78bfa", title: "SuperTrend")

when st.dir > st.dir[1]: mark buy at low "flip up"
when st.dir < st.dir[1]: mark sell at high "flip down"
`,
  },
  {
    id: 'donchian-breakout',
    title: 'Donchian breakout (turtle-style)',
    category: 'Trend',
    blurb:
      'Buy a new N-bar high, sell a new N-bar low — comparing against the PRIOR bar’s channel so the breakout is confirmed, never look-ahead.',
    code: `pulse 1
meta(name: "Donchian Breakout", overlay: true)

d = ta.donchian(20)
draw line(d.upper, color: "#f59e0b", title: "20-bar high")
draw line(d.lower, color: "#38bdf8", title: "20-bar low")

when high >= d.upper[1]: mark buy at low "new high break"
when low <= d.lower[1]: mark sell at high "new low break"
`,
  },
  {
    id: 'parabolic-sar',
    title: 'Parabolic SAR stop-and-reverse',
    category: 'Trend',
    blurb: 'Plot the SAR trailing dots and mark each bar where price crosses the stop — a self-contained reversal system.',
    code: `pulse 1
meta(name: "Parabolic SAR", overlay: true)

stop = ta.sar(0.02, 0.02, 0.2)
draw dots(stop, color: "#a78bfa", title: "SAR")

when close > stop and close[1] <= stop[1]: mark buy at low "flip long"
when close < stop and close[1] >= stop[1]: mark sell at high "flip short"
`,
  },
  {
    id: 'rsi-reversion',
    title: 'RSI mean-reversion turns',
    category: 'Momentum',
    blurb:
      'Fade extremes: buy the bar RSI crosses back up through 30, sell the bar it crosses back down through 70. The cross (not the level) keeps it to one signal per swing.',
    code: `pulse 1
meta(name: "RSI Reversion", overlay: true)

r = rsi(close, 14)

when r <= 30 and r[1] > 30: mark buy at low "oversold turn"
when r >= 70 and r[1] < 70: mark sell at high "overbought turn"
`,
  },
  {
    id: 'macd-momentum',
    title: 'MACD signal-line crosses',
    category: 'Momentum',
    blurb: 'The full MACD in a sub-pane — line, signal and histogram — with a marker on every bullish and bearish signal-line cross.',
    code: `pulse 1
meta(name: "MACD Momentum", overlay: false)

m = ta.macdFull(12, 26, 9)
draw line(m.line, color: "#38bdf8", title: "MACD")
draw line(m.signal, color: "#f59e0b", title: "signal")
draw hist(m.histo, title: "histogram")

when crossOver(m.line, m.signal): mark buy at low "bull cross"
when crossUnder(m.line, m.signal): mark sell at high "bear cross"
`,
  },
  {
    id: 'stochastic-zones',
    title: 'Stochastic cross inside a zone',
    category: 'Momentum',
    blurb: 'A %K/%D cross only counts when it happens in the oversold (<20) or overbought (>80) zone — the confluence filter that cuts the noise.',
    code: `pulse 1
meta(name: "Stochastic Cross", overlay: false)

s = ta.stochFull(14, 3, 3)
draw line(s.k, color: "#38bdf8", title: "%K")
draw line(s.d, color: "#f59e0b", title: "%D")

when crossOver(s.k, s.d) and s.k < 20: mark buy at low "oversold cross"
when crossUnder(s.k, s.d) and s.k > 80: mark sell at high "overbought cross"
`,
  },
  {
    id: 'bollinger-breakout',
    title: 'Bollinger Band breakout',
    category: 'Volatility',
    blurb: 'Shade the bands, plot the basis, and mark closes that break the upper or lower band — the core volatility-expansion trade.',
    code: `pulse 1
meta(name: "Bollinger Breakout", overlay: true)

b = ta.bands(20, 2)
draw band(b.upper, b.lower, color: "rgba(124,156,255,0.12)", title: "Bollinger")
draw line(b.mid, color: "#7c9cff", title: "basis")

when crossOver(close, b.upper): mark buy at low "upper break"
when crossUnder(close, b.lower): mark sell at high "lower break"
`,
  },
  {
    id: 'keltner-channel',
    title: 'Keltner Channel trend ride',
    category: 'Volatility',
    blurb: 'An EMA ± ATR envelope. A close outside the channel signals a trending expansion — cleaner than bands in strong trends.',
    code: `pulse 1
meta(name: "Keltner Channel", overlay: true)

k = ta.channel(20, 10, 2)
draw band(k.upper, k.lower, color: "rgba(34,197,94,0.12)", title: "Keltner")
draw line(k.mid, color: "#22c55e", title: "basis")

when crossOver(close, k.upper): mark buy at low "breakout"
when crossUnder(close, k.lower): mark sell at high "breakdown"
`,
  },
  {
    id: 'vol-regime-paint',
    title: 'Volatility-regime background',
    category: 'Volatility',
    blurb: 'Tint the chart background when ATR% is above its own average — an instant visual cue for when to widen stops or stand aside.',
    code: `pulse 1
meta(name: "Volatility Regime", overlay: true)

atrPct = ta.atr(14) / close * 100
hot = atrPct > ta.sma(atrPct, 50)

if hot {
  paint bg(rgba(239, 68, 68, 0.06))
} else {
  paint bg(rgba(34, 197, 94, 0.05))
}
`,
  },
  {
    id: 'volume-spike-alert',
    title: 'Volume-spike alert',
    category: 'Alerts',
    blurb:
      'When relative volume runs 2× normal on an up-bar, drop a marker AND raise an alert() event — the same event the alert engine delivers to Telegram.',
    code: `pulse 1
meta(name: "Volume Spike", overlay: true)

spike = ta.rvol(20) > 2 and close > open

when spike: mark buy at low "vol spike"
when spike: alert("Relative volume 2x on an up-bar")
`,
  },
  {
    id: 'htf-trend-gate',
    title: 'Higher-timeframe trend gate',
    category: 'Multi-timeframe',
    blurb:
      'Take the fast entry only when it agrees with the 4-hour trend. onTf reads only COMPLETED higher-timeframe bars, so this never repaints.',
    code: `pulse 1
meta(name: "HTF Trend Gate", overlay: true)

htf = onTf("4h", ema(close, 21))
draw line(htf, color: "#a78bfa", title: "4h EMA 21")

fast = ema(close, 9)
slow = ema(close, 21)

when crossOver(fast, slow) and close > htf: mark buy at low "long w/ 4h trend"
when crossUnder(fast, slow): mark sell at high "exit"
`,
  },
];

/** id → code, for the interpreter execution test. */
export const COOKBOOK_SAMPLES: Record<string, string> = Object.fromEntries(RECIPES.map((r) => [r.id, r.code]));

export const RECIPE_CATEGORIES: RecipeCategory[] = ['Trend', 'Momentum', 'Volatility', 'Volume', 'Multi-timeframe', 'Alerts'];
