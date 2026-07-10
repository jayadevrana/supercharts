# PulseScript — language reference

> PulseScript is SuperCharts' own chart-scripting language: an **original design** with the
> bar-by-bar series execution model every charting DSL shares. Universal market vocabulary
> (`close`, `sma`, `rsi`) is used because it is industry language; every structural keyword and
> API name is ours. This file is the complete reference for what the language can do **today** —
> nothing listed here is aspirational. The capability comparison against other platforms lives in
> `docs/pulsescript-parity.md`.

## 1. Execution model

The script body runs **once per bar**, oldest → newest, over the pane's real candle buffer
(or the last 1000 real candles server-side for backtests). On each run:

- A bare series name (`close`) is the **current bar's** value.
- `expr[n]` is the **history operator**: the value of `expr` as of `n` bars back. Out-of-range
  history is `none`.
- Outputs (`draw`, `paint`, `mark`, `alert`) capture the current bar's contribution; the
  renderer assembles the full buffers afterwards.

There is no look-ahead anywhere: every built-in is causal, and multi-timeframe reads only see
**completed** higher-TF bars (see §10).

## 2. Syntax

- `pulse 1` — optional version header on the first line (unknown versions fail loud).
- `#` starts a line comment (no block comments).
- Newlines separate statements; expressions inside `(…)` / `[…]` may wrap freely.
- Blocks use `{ }`, or the **low-indent colon form**: `when cond: mark buy` — a colon takes
  exactly one statement on the same line (works for `when`/`if`/`else`/`for`/`while`).
- Strings use double quotes with `\n`, `\t`, `\"` escapes.
- `meta(name: "My Study", overlay: true)` — optional, first statement after the version line.

## 3. Declarations

| form | meaning |
|---|---|
| `x = expr` | **the everyday form** — first assignment declares (same semantics as `mut`); assigning to a built-in name (`close`, `ema`, …) errors with guidance |
| `let x = expr` | per-bar binding, recomputed every bar, **not** reassignable |
| `mut x = expr` | per-bar binding, reassignable within the bar (`x = …`) |
| `persist x = expr` | initialised **once** on the first bar its statement runs, carries its value across bars; reassign with `x = …`. The accumulator/state primitive. |
| `fn f(a, b = 2) = expr` | function, expression body |
| `fn f(a) { … }` | function, block body — the last bare expression is the return value |

A `persist` declared inside a conditional resumes from its last defined value across skipped
bars (it never resets or goes `none` because a `when` didn't fire).

## 4. Types & values

`num` (one numeric type), `bool`, `text`, `none` (the absent value), `list` (`[1, 2, 3]`),
`record` (returned by multi-output studies — `ta.bands(20, 2).upper`), `color strings`
(`"#22c55e"`, `"rgba(34,197,94,0.2)"`, or `rgb()/rgba()` builders).

- Truthiness is **strict**: only a real `bool` drives `if`/`when`/`? :`/`and`/`or`/`not`.
- Arithmetic with `none` → `none`; comparisons with `none` → `false`; `==`/`!=` treat two
  `none`s as equal. Lists/records compare **deeply**.
- `nz(x, fallback)` and `na(x)` handle `none`/non-finite values.
- `+` concatenates when either side is text.

## 5. Operators

`+ - * / %`, comparisons `== != < > <= >=`, logic `and or not`, ternary
`cond ? a : b` (right-associative), history `expr[n]`, member `.field` (records) /
`.method()` (lists, text), call `f(…)` with positional and `name:` arguments (keywords are
valid argument names: `at:`, `shape:`).

## 6. Control flow

```pulse
if cond { … } else if other { … } else { … }
when cond { … }                 # event-style if (no else)
for i = 0 to 9 { … }            # inclusive range, auto step ±1
for v in [1, 2, 3] { … }        # list iteration
while cond { … }
break / continue                 # inside any loop
```

All loops count against the runaway guards (§12).

## 7. Lists & text methods

Lists: `.size() .at(i) .first() .last() .push(v) .pop() .shift() .unshift(v) .set(i, v)
.insert(i, v) .removeAt(i) .clear() .copy() .contains(v) .indexOf(v) .slice(from, to?)
.join(sep?) .sum() .avg() .min() .max() .sort(desc?) .reverse()` — mutators return the list
(chainable); `repeat(value, count)` builds a filled list. `persist xs = []` + `xs.push(close)`
is the rolling-collection idiom.

Text: `.len() .upper() .lower() .trim() .contains(s) .startsWith(s) .endsWith(s) .indexOf(s)
.replace(a, b) .split(sep) .slice(a, b?) .repeat(n)`.

Conversions: `text(v, decimals?)` → text, `parseNum(s)` → num or `none`.

## 8. Built-in series & context

| name | value |
|---|---|
| `open high low close volume` | the bar's OHLCV |
| `hl2 hlc3 ohlc4 hlcc4` | derived prices |
| `time` | bar open time (UNIX ms) |
| `barIndex` | 0-based bar number |
| `barCount`, `lastBarIndex` | run shape |
| `isFirstBar`, `isLastBar` | bools |
| `year month day weekday hour minute second` | **UTC** fields of the bar open time; `weekday` is ISO (Mon=1 … Sun=7) |

## 9. Inputs (editor-rendered controls)

```pulse
let len  = input.num(14, "Length", min: 2, max: 200, step: 1)
let src  = input.source(close, "Source")          # close/open/high/low/hl2/hlc3/ohlc4/hlcc4/volume
let on   = input.bool(true, "Enabled")
let tag  = input.text("note", "Label")
let mode = input.select("fast", "Mode", options: ["fast", "slow", "off"])
let col  = input.color("#22c55e", "Line color")
```

Inputs appear as form controls in the code dock; overrides re-run the script. `input.num`
fields are also what the script **Optimizer** sweeps. A non-numeric `input.num` default is a
loud error (it silently rewires strategies otherwise).

## 10. Standard library

### `math.*`
`abs sign floor ceil round(x, decimals?) sqrt exp log log10 pow sin cos tan asin acos atan
atan2 toDegrees toRadians clamp(x, lo, hi) min max sum avg` + constants `math.pi math.e math.phi`.
(`random` is deliberately absent: runs must be deterministic and reproducible.)

### `ta.*` — also callable bare (`ema(close, 12)`)

Series in, series out (first arg is any series):
`sma ema wma rma hma dema tema vwma linreg(src, len, offset?) alma(src, len, offset?, sigma?)
swma rsi stdev variance dev median percentRank cmo tsi(src, short, long) roc mom cog change
cum sum highest lowest sinceHighest sinceLowest correlation(a, b, len)`.

Events/state:
`crossOver(a, b) crossUnder(a, b) cross(a, b) rising(s, n) falling(s, n) since(cond)
lastWhen(cond, src, back?) hold(s) pivotHigh(src, left, right) pivotLow(src, left, right)`.
Pivots are **confirmed** pivots: the value appears on the bar where the right side completes —
never repaints.

Candle-based (read OHLCV directly):
`atr tr vwap cci mfi willr obv cmf rvol sar(start?, step?, max?) macd stoch`.

Multi-output records (access fields with `.`):

| call | fields |
|---|---|
| `ta.bands(len, mult)` | `.upper .mid .lower .width .pctB` (Bollinger) |
| `ta.channel(emaLen, atrLen, mult)` | `.upper .mid .lower` (Keltner) |
| `ta.donchian(len)` | `.upper .mid .lower` |
| `ta.dmi(len)` | `.plus .minus .adx` |
| `ta.supertrend(mult, atrLen)` | `.line .dir` |
| `ta.ichimoku(conv, base, spanB)` | `.conversion .base .spanA .spanB .lagging` |
| `ta.aroon(len)` | `.up .down .osc` |
| `ta.macdFull(fast, slow, signal)` | `.line .signal .histo` |
| `ta.stochFull(k, kSmooth, dSmooth)` | `.k .d` |

All TA math is shared with the chart's own indicator engine (`@supercharts/indicators`) —
scripts and chart indicators agree bar-for-bar by construction.

### Multi-timeframe

```pulse
let htfTrend = onTf("4h", ema(close, 20))
```

`onTf(tf, expr)` aggregates the chart candles into UTC-aligned `tf` buckets, evaluates `expr`
on those bars, and gives each chart bar the value of the **last completed** higher-TF bar —
the forming bucket is never read, so values never repaint. Rules (all errors carry line/col):
`tf` is `"Nm" / "Nh" / "Nd"`, must be a whole multiple of the chart interval at or above it;
top-level use only; no nesting; the expression sees its own timeframe (prices, `ta.*`,
`math.*`, inputs, `fn` calls) and cannot read chart-timeframe variables. A partial leading
bucket in the buffer is dropped rather than reported with made-up OHLC.

## 11. Outputs

### Series plots — `draw`

```pulse
draw line(ema(close, 20), color: "#38bdf8", title: "EMA", width: 2, style: "dashed")
draw steps(onTf("4h", close), title: "4h close")    # stepped line
draw area(vwap(), title: "vwap area")               # filled to the pane bottom
draw hist(close - open, title: "body")              # columns anchored at 0
draw dots(ta.sar(), title: "SAR")                   # circles, width = radius
draw band(b.upper, b.lower, color: "#38bdf8")       # filled channel between two series
```

`style:` is `"solid" | "dashed" | "dotted"`; `width:` is px. `none` values leave gaps.

### Reference levels, markers, paints

```pulse
draw level(70, title: "OB", color: "#ef4444", style: "dotted")   # constant horizontal line
draw marker(cond, shape: "triangleUp", at: "below", color: "#22c55e", text: "LONG", size: 5)
paint bg(cond ? "rgba(34,197,94,0.1)" : none)       # background strip behind the candles
paint candles(cond ? "#fbbf24" : none)              # tints the bar's high-low box
```

Marker shapes: `circle square diamond cross triangleUp triangleDown arrowUp arrowDown flag`;
`at:` is `"above"`, `"below"`, or a price expression. A `level` driven by a series keeps its
**last** value (e.g. `draw level(ta.highest(high, 200))`).

### Signals, alerts

```pulse
when crossOver(fast, slow) {
  mark buy at low "Long"            # buy/sell marks ARE the strategy for the backtester
  alert("golden cross at " + text(close, 1))
}
```

`mark buy/sell/note (at price)? (text)?` plots signal dots; the Strategy Tester and the
script Optimizer trade exactly these marks on real candles. `alert("…")` events are collected
per run and shown in the console (they are **not** yet routed to Telegram/web alert delivery —
see the parity doc).

Colors anywhere accept CSS strings or `rgb(r, g, b)` / `rgba(r, g, b, a)` (channels clamped).

## 12. Safety & limits

- Wall-clock budget per run (default 2 s) and a 5M loop-step cap — both abort with a
  line-numbered error. `maxBars` defaults to 50 k.
- Scripts cannot reach host globals or IO (`fetch`, `window`, `process` are unknown
  identifiers — hard errors).
- TA periods clamp to ≥ 1; `repeat()` counts cap at 100 k; text `.repeat()` at 10 k.
- Deterministic by design: same source + same candles + same inputs ⇒ same result, always.

## 13. Editor / tooling surface

The **Script** dock on `/terminal`: CodeMirror editor, Run, On-chart toggle, schema-driven
Inputs panel, console (meta + per-channel counts + the last alert lines + line-numbered
errors), Save/Open (per-user `user_scripts`), **Strategy Tester** tab (backtests the script's
marks server-side on the last 1000 real candles, with realism options), and the **Optimizer**
tab (sweeps `input.num` ranges, ranked like the MA optimizer, honest truncation reporting).
