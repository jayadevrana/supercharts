/**
 * Every code sample shown on the public docs pages, in one module — so
 * `tests/docs-samples.test.ts` executes ALL of them through the real interpreter.
 * Shipped docs code that doesn't run fails CI; nothing on the docs page is decorative.
 */

export const HERO = `pulse 1
meta(name: "EMA Cross", overlay: true)

fast = ema(close, 12)
slow = ema(close, 26)

draw line(fast, color: "#38bdf8", title: "Fast EMA")
draw line(slow, color: "#f59e0b", title: "Slow EMA")

when crossOver(fast, slow): mark buy at low "Long"
when crossUnder(fast, slow): mark sell at high "Short"
`;

export const FIRST_SCRIPT = `pulse 1
meta(name: "My first study", overlay: true)

# A 20-bar average of the close — one line, no boilerplate.
smooth = sma(close, 20)
draw line(smooth, color: "#7c9cff", title: "SMA 20")
`;

export const INPUTS = `pulse 1
meta(name: "Tunable RSI gate", overlay: true)

len = input.num(14, "RSI length", 2, 50)
floor = input.num(30, "Oversold level", 5, 50)

when rsi(close, len) < floor: mark buy at low "oversold"
`;

export const HISTORY = `pulse 1
# expr[n] reads a value n bars back. Out-of-range history is none.
gap = close - close[1]
threeBarMean = (close + close[1] + close[2]) / 3
draw line(threeBarMean, title: "3-bar mean")
when gap > 0 and gap[1] > 0: mark note at high "2 up bars"
`;

export const DECLARATIONS = `pulse 1
# Bare assignment declares (recomputed every bar):
spread = high - low

# let = same, but protected from reassignment:
let basis = hlc3

# persist = initialised ONCE, carries across bars (state):
persist upBars = 0
when close > open: upBars = upBars + 1
draw line(upBars, title: "cumulative up bars")
`;

export const CONTROL_FLOW = `pulse 1
mut zone = 0
r = rsi(close, 14)

# Colon form: one statement, no braces.
when r > 70: zone = 1
when r < 30: zone = -1

# Brace form: multiple statements.
if zone == 1 {
  paint bg(rgba(239, 68, 68, 0.08))
} else if zone == -1 {
  paint bg(rgba(34, 197, 94, 0.08))
}
draw hist(r - 50, title: "RSI distance from 50")
`;

export const FUNCTIONS = `pulse 1
# Expression body:
fn mid(a, b) = (a + b) / 2

# Block body — the last expression is the return value:
fn pctOf(part, whole) {
  ratio = part / whole
  ratio * 100
}

# Compute studies at the top level (they cache once per run), then pass values in.
band = ta.stdev(close, 20) * 2
draw line(mid(high, low), title: "midpoint")
draw line(pctOf(band, close), title: "stretch %")
`;

export const MTF = `pulse 1
meta(name: "HTF trend gate", overlay: true)

# onTf reads a COMPLETED higher-timeframe series — no repaint, ever.
htfTrend = onTf("4h", ema(close, 20))
draw line(htfTrend, color: "#a78bfa", title: "4h EMA 20")

goLong = close > htfTrend and crossOver(ema(close, 9), ema(close, 21))
when goLong: mark buy at low "with 4h trend"
`;

export const PERSIST_STATE = `pulse 1
meta(name: "ATR trail flip", overlay: true)

trail = ta.supertrend(10, 3)
draw line(trail.line, color: "#a78bfa", title: "trail")
when trail.dir > trail.dir[1]: mark buy at low "flip up"
when trail.dir < trail.dir[1]: mark sell at high "flip down"
`;

/** Every sample above, for the doc-example execution test. */
export const ALL_SAMPLES: Record<string, string> = {
  HERO,
  FIRST_SCRIPT,
  INPUTS,
  HISTORY,
  DECLARATIONS,
  CONTROL_FLOW,
  FUNCTIONS,
  MTF,
  PERSIST_STATE,
};
