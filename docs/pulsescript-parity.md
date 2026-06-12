# PulseScript ↔ Pine Script capability parity — honest status

> Goal (owner directive 2026-06-12): *"everything I can do on Pine Script, I should be able to
> do in PulseScript."* This file is the audited truth of where that stands. ✅ = capability
> covered today (our own API, never Pine's identifiers) · 🟡 = partial, gap described ·
> ❌ = not built yet. Anything not listed under ✅ should be assumed missing — this doc errs
> on the side of under-claiming.
>
> Last audited: 2026-06-12, after commits `77ffecc`, `b90c05c`, `5a49ec2`, `56da78d`, `ef6d1fd`.
> Tests backing the claims: `tests/script-lang-*.test.ts` (≈120 cases).

## Coming from Pine — name map

| Pine Script | PulseScript |
|---|---|
| `//` comment | `#` comment |
| `var x =` | `persist x =` |
| `x := y` | `mut x = …` then `x = y` |
| `na` / `nz()` / `na(x)` / `fixnan` | `none` / `nz()` / `na(x)` / `ta.hold()` |
| `cond ? a : b` | same (strict bool condition) |
| `plot(x, style=…)` | `draw line/steps/area/hist/dots(x, style:, width:)` |
| `plotshape / plotchar / plotarrow` | `draw marker(cond, shape:, at:, text:, size:)` |
| `bgcolor()` | `paint bg(color)` |
| `barcolor()` | `paint candles(color)` |
| `hline()` | `draw level(y)` |
| `fill(p1, p2)` | `draw band(a, b)` |
| `alertcondition()/alert()` | `alert("…")` (collected; delivery not wired yet) |
| `strategy.entry/close` (signal level) | `mark buy` / `mark sell` (+ server backtester) |
| `request.security(sym, tf, expr)` | `onTf(tf, expr)` — same symbol, completed bars only |
| `ta.valuewhen` | `ta.lastWhen(cond, src, back)` |
| `ta.barssince` | `ta.since(cond)` |
| `ta.highestbars/lowestbars` | `ta.sinceHighest/sinceLowest` (positive bars-ago) |
| `ta.pivothigh/pivotlow` | `ta.pivotHigh/pivotLow(src, left, right)` |
| `input.int/float` | `input.num` |
| `input.string(options=[…])` | `input.select(…, options: […])` |
| `input.color / input.bool / input.source / input.string` | `input.color / input.bool / input.source / input.text` |
| `array.*` | list literals + methods (`xs.push(…)`, `xs.avg()`, …) |
| `str.*` | text methods (`s.upper()`, `s.split(…)`, …) + `text()/parseNum()` |
| `math.*` | `math.*` (no `random` — determinism by design) |
| `bar_index / last_bar_index` | `barIndex / lastBarIndex` |
| `barstate.isfirst/islast` | `isFirstBar / isLastBar` |
| `dayofweek/hour/…` | `weekday/hour/…` (UTC, ISO weekday) |

## Language core

| capability | status | notes |
|---|---|---|
| bar-by-bar series model + `[]` history | ✅ | history works through variables, calls, record fields |
| `let` / reassignable / persistent vars | ✅ | `let` / `mut` / `persist` (lazy init, carries across skipped bars) |
| if / else-if / else, event blocks | ✅ | `if/else`, `when` |
| ternary | ✅ | strict-bool, right-associative |
| for loops | ✅ | `for i = a to b`, `for v in list` |
| while loops, break/continue | ✅ | step + wall-clock guarded |
| switch/match construct | ❌ | use else-if chains / ternaries; a `match` form is a candidate next |
| user functions | ✅ | `fn`, defaults, expression or block body |
| methods on values | ✅ | built-in list/text methods; **user-defined methods ❌** |
| tuples / multi-value returns | 🟡 | multi-output **records** (`.field`) cover the main use; no destructuring assignment |
| arrays | ✅ | lists + 20 methods, `repeat()` |
| user-defined types (UDT) | ❌ | `shape` keyword reserved, unimplemented |
| maps / matrices | ❌ | not started |
| `varip` (intra-bar live state) | ❌ | batch re-run model; would need the live tick path |
| libraries / `import` | ❌ | single-script model (server-side saved scripts only) |
| strings | ✅ | methods + conversions + `+` concat |
| date-time built-ins | 🟡 | UTC only (documented); no exchange-timezone or session calendar |

## Indicators (`ta.*`)

| group | status | notes |
|---|---|---|
| MAs: sma ema wma rma hma dema tema vwma swma alma linreg | ✅ | pinned bar-for-bar to `@supercharts/indicators` where it exists |
| rsi stdev variance dev median percentRank cmo tsi roc mom cog change cum sum correlation | ✅ | |
| highest lowest sinceHighest sinceLowest | ✅ | |
| crossOver crossUnder cross rising falling | ✅ | |
| since lastWhen hold pivotHigh pivotLow | ✅ | confirmed-pivot timing, no repaint |
| atr tr vwap cci mfi willr obv cmf rvol sar macd stoch | ✅ | |
| BB/Keltner/Donchian/DMI/Supertrend/Ichimoku/Aroon/macdFull/stochFull | ✅ | record outputs |
| Pine extras not yet mirrored | ❌ | `ta.wpr`≈`willr` ✅ but: `bbw/kcw` (derivable: `.width`), `cci` source variant, `cog` ✅, `dmi` ✅, `mfi` ✅ — still missing: `ta.range`, `ta.mode`, `ta.percentile_*`, `ta.iii`, `ta.kc` source variants, `ta.wad`, `ta.wvad`, `ta.nvi/pvi`, `ta.pvt`, session-anchored vwap options |
| candle-pattern helpers | ❌ | the indicators package has 8 tested detectors — not yet exposed as `ta.*` |

## Multi-timeframe & data

| capability | status | notes |
|---|---|---|
| higher-TF expression (`request.security` core use) | ✅ | `onTf` — same symbol, m/h/d, completed bars only (no repaint, stricter than Pine's default) |
| forming-bar / lookahead variants | ❌ | deliberately rejected — repaint modes fake accuracy |
| weekly/monthly TFs | ❌ | need real calendar buckets |
| other SYMBOLS (`request.security("AAPL", …)`) | ❌ | needs a data-fetch bridge into the run |
| lower TFs (`request.security_lower_tf`) | ❌ | chart buffer can't be disaggregated honestly |
| `syminfo.*` / `timeframe.*` namespaces | ❌ | interval is plumbed internally for onTf; not exposed as script values yet |

## Inputs

| capability | status |
|---|---|
| num (min/max/step), bool, text, source, select(options), color | ✅ |
| timeframe / symbol / session / price-pick inputs | ❌ |
| input groups/inline layout | ❌ |

## Visual output

| capability | status | notes |
|---|---|---|
| line / stepline / area / histogram / columns / circles styles | ✅ | `draw line/steps/area/hist/dots` (+ `width:`, `style:` dash) |
| bands / fills between series | ✅ | `draw band(a, b)` |
| horizontal levels | ✅ | `draw level` (+ title label, dash) |
| shape markers above/below/at price + label text | ✅ | 9 shapes |
| background shading | ✅ | `paint bg`, renders **behind** candles (own layer) |
| bar tinting | 🟡 | `paint candles` overlays a translucent tint box; true candle recolor needs the price-series layer |
| sub-pane (separate-pane) script output | ❌ | script plots render on the price pane today; `meta(pane: "below")` is the planned route |
| plotcandle/plotbar | ❌ | |
| persistent drawing objects (segments/boxes/labels/tables at arbitrary coordinates) | ❌ | biggest visual gap for SMC-style scripts; renderer primitives exist (`DrawingLayer`) but no script API |
| color gradients (`color.from_gradient`) | ❌ | `rgb()/rgba()` cover construction |

## Strategy & alerts

| capability | status | notes |
|---|---|---|
| signal-level strategy (entries/exits as marks) + real backtest | ✅ | `mark buy/sell` → `POST /api/backtest/script` (1000 real candles, realism: fees/slippage/SL-TP) |
| parameter optimization of script inputs | ✅ | `POST /api/optimize/script`, time-budgeted, deterministic |
| per-order qty / pyramiding / OCO / per-trade SL-TP from script | ❌ | backtester realism is global, not per-signal; a `trade.*` output channel is the planned route |
| position/equity introspection (`strategy.position_size`…) | ❌ | |
| `alert()` events | 🟡 | collected per run + shown in console with bar+text; **not** routed to the live Telegram/web alert engine (deliberate — that engine carries live money-adjacent config) |

## Tooling

| capability | status |
|---|---|
| editor (CodeMirror), Run, on-chart toggle, inputs panel, console w/ line-numbered errors | ✅ |
| save/load per user | ✅ |
| strategy tester + optimizer tabs | ✅ |
| syntax highlighting tuned to PulseScript grammar | 🟡 (generic highlighting today) |
| autocomplete/signature help, hover docs | ❌ |
| script sharing / publishing | ❌ (strategy share links exist for GUI recipes only) |

## Deliberate differences (decisions, not gaps)

- **No repaint, ever**: `onTf` reads completed bars only; pivots confirm before they print.
  Pine's defaults repaint in both places.
- **No `math.random`**: identical inputs must give identical runs (optimizer/backtest honesty).
- **Strict booleans**: `1` is not `true` — silent numeric truthiness hides bugs.
- **Fail-loud inputs**: a non-numeric `input.num` default is an error, not a guess.
- **UTC clock built-ins**: documented, consistent; exchange-local calendars are a future,
  explicit feature — not an implicit behavior.

## Recommended next increments (in value order)

1. `match` expression + tuple destructuring (`let (a, b) = …`).
2. Sub-pane script plots (`meta(pane: …)`) so oscillators leave the price pane.
3. Persistent drawing objects API (`draw segment/zone/textAt`) on the existing DrawingLayer.
4. `trade.*` output channel (qty/SL/TP per signal) feeding the existing realism backtester.
5. Candle-pattern `ta.*` wrappers over the tested detectors.
6. Script alerts → opt-in bridge into the alert engine (new delivery path, never touching the
   live MA-cross config).
7. `syminfo`/`timeframe` context values + timeframe/symbol inputs.
8. Cross-symbol `onTf` via a server-side data bridge.
