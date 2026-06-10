# Coding & backtesting a strategy in PulseScript

SuperCharts follows the same loop you know from other platforms: **write a script in the
editor → its buy/sell marks ARE the strategy → the Strategy Tester backtests those exact
marks on real candles.** Nothing is simulated from a form; the report tests the same
signals you see drawn on the chart.

## Where everything lives

1. **Script** (top bar) — toggles the PulseScript editor, docked at the bottom of the
   chart. Code on the left; **Console** and **Strategy Tester** tabs on the right.
2. **Run** — compiles the script and draws its `draw`/`mark` output on the live chart
   (enable the "On chart" switch to see it).
3. **Backtest** — runs the script server-side over the last 1000 real candles of the
   active chart's symbol + interval, trades its marks, and opens the Strategy Tester tab
   with the report: net return, win rate, profit factor, max drawdown, Sharpe, an equity
   curve, and the trade list.
4. **Backtest** (top bar, flask icon) — the form-based tester for plain MA-cross setups,
   no code needed. Same engine underneath.

## A complete strategy, line by line

```pulse
meta(name: "EMA Cross Strategy")

# Inputs render as form controls in the Console tab.
# Signature: input.num(default, title?, min:, max:)  ← default comes FIRST
let fastLen = input.num(9,  "Fast EMA", min: 2)
let slowLen = input.num(21, "Slow EMA", min: 3)

let fast = ema(close, fastLen)
let slow = ema(close, slowLen)

# Optional: draw the lines so you can see what the strategy sees.
draw line(fast, color: "#f5d524")
draw line(slow, color: "#7c9cff")

# The marks ARE the strategy: buy = go long, sell = close long + go short.
when crossOver(fast, slow) {
  mark buy at low "Long"
}
when crossUnder(fast, slow) {
  mark sell at high "Short"
}
```

Press **Backtest**. That's it.

## The trade model (read this before trusting any number)

- **Entry**: at the close of the bar where the mark fired (`at low` / `at high` only
  position the label on screen — fills always use the close).
- **Exit**: at the next opposite-side mark, which also flips the position. Same-side
  marks while a position is open are ignored. The last open trade closes at the final
  candle so the stats can't hide an open loser.
- **Equity**: each trade's % return compounds from a base of 100. No position sizing,
  no leverage.
- **Realism (optional, Strategy Tester tab)**: commission %/side, slippage % (fills move
  against you), stop-loss % and take-profit % from the entry fill, checked intrabar with
  the conservative assumption that a bar spanning both levels hits the **stop first**.
  All blank = off; results are then identical to the plain model.
- **Data**: the last 1000 closed candles of the chart's symbol/interval — real market
  data, never synthetic. Run the same backtest twice and you get byte-identical results.

## Verifying a backtest (do this — it's the point)

After **Backtest**, the same script is pushed to the chart, so with "On chart" enabled
every `mark buy`/`mark sell` the report traded is visible on real candles. Pick any row
in the trade list and find its entry mark on the chart. If you can't reconcile a trade
with what you see, don't trust it — that's the standard the whole tool is built around.

## Common errors

| Error | Cause |
| --- | --- |
| `input.num default must be a number…` | Title written first. The signature is `input.num(9, "Fast EMA")`, not `input.num("Fast EMA", 9)`. |
| `no_signals` | The script never emitted `mark buy`/`mark sell` on this data. Note the tester needs at least one mark. |
| `script_error` with a line number | Compile/runtime error — the message points at the offending line. Scripts also time out at 2s as a runaway guard. |

## Strategy ideas that work with this model

Anything that can be expressed as "a condition becomes true on a bar → mark":
MA/EMA crosses, RSI thresholds (`when rsi(close, 14) < 30 { mark buy }`), breakouts
(`when close > highest(high, 20)[1] { mark buy }`), candle patterns, multi-condition
filters with `and`/`or`. Combine with the **Peak Performance** optimizer (Alerts → flask
icon on an alert row) when you want the parameter sweep to find the best settings for an
MA-cross under a win-rate floor.
