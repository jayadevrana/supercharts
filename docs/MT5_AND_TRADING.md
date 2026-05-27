# SuperCharts MT5 trading + signal engine

End-to-end guide for the live forex / MT5 features added in this branch.

## What you can do now

1. **Live forex charts** with multi-chart grid (1 / 4 / 8 / 16 panes), drawing
   tools, drawings persistence, all existing crypto + forex providers.
2. **Classic TA indicators** with on/off toggles and editable parameters
   (RSI, MACD, EMA, SMA, WMA, HMA, DEMA, TEMA, Bollinger, Keltner, Donchian,
   ATR, ADX, VWAP, OBV, CMF, Volume Oscillator, Williams %R, CCI, MFI, ROC,
   Supertrend, PSAR, Ichimoku, Aroon). Overlay indicators render on the
   price chart via a dedicated canvas layer; sub-pane oscillators render
   below the chart as a stacked SVG mini-pane per indicator.
3. **MT5 account pairing** through a custom MQL5 Expert Advisor over a TCP
   socket carrying newline-delimited JSON.
4. **EA-style order configurator** with market / limit / stop entries,
   SL + TP (price or pips), partial closes (TP1 / TP2 / TP3 with sizing),
   trailing stop, break-even shift, lot / risk-% / cash-risk sizing.
5. **Signal builder** UI for condition → action recipes. Conditions can
   reference any active indicator channel, the price, sessions, time
   windows, or candle patterns. Actions can open positions (with the full
   EA configurator) or modify existing trades.
6. **Bar replay** scrubber that clips visible candles to a cursor across
   all panes; play / pause / 0.5×–32× speed.
7. **TradingView feature recorder** (Playwright) that uses a persistent
   browser profile (you log in once, the credentials never leave your
   machine) to map TradingView selectors + screenshots to a JSON spec for
   reference.

## Repo layout (added/changed)

```
apps/mt5-ea/SuperChartsBridge.mq5     MetaTrader 5 Expert Advisor
apps/mt5-ea/README.md                 EA install instructions

apps/api/src/mt5/
  state.ts                            In-memory MT5 store + event bus
  bridge.ts                           TCP listener for EA connections
  intents.ts                          OrderIntent → MT5 command router
                                      (partial closes, trailing, break-even)
  risk.ts                             Sizing math + risk checks
  signal-runner.ts                    Recipe condition evaluator + dispatcher
  index.ts                            Module exports

apps/api/src/routes/
  mt5.ts                              REST: /api/mt5/pair-tokens, accounts,
                                      positions, orders, modify, close, cancel
  signals.ts                          REST CRUD for SignalRecipe
  indicators.ts                       Per-user indicator layout persistence

packages/types/src/
  mt5.ts                              MT5 EA <-> backend wire types
  trading.ts                          High-level OrderIntent + SignalRecipe

packages/indicators/                  NEW workspace package
  src/ma.ts                           SMA, EMA, WMA, HMA, DEMA, TEMA, RMA
  src/oscillators.ts                  RSI, MACD, Stoch, Williams%R, CCI, MFI, ROC
  src/volatility.ts                   ATR, Bollinger, Keltner, Donchian
  src/trend.ts                        ADX, Supertrend, PSAR, Ichimoku, Aroon
  src/volume.ts                       VWAP, OBV, CMF, Volume Oscillator
  src/patterns.ts                     Candlestick patterns
  src/registry.ts                     Indicator picker definitions
  src/runner.ts                       computeIndicatorChannel / computeAll

packages/chart-core/src/layers/indicators.ts  Generic line/band/dot layer

apps/web/features/terminal/
  mt5-store.ts                        Web-side MT5 store + WS dispatcher
  mt5-chip.tsx                        Top-bar MT5 connection chip
  mt5-connect-dialog.tsx              Pairing instructions + token
  order-panel.tsx                     Right-rail trading panel
  indicator-panel.tsx                 Right-rail classic indicator manager
  sub-pane-indicators.tsx             SVG mini-panes for RSI/MACD/etc.
  signal-builder-dialog.tsx           Signal recipe builder
  replay-bar.tsx                      Bottom replay scrubber

apps/tv-recorder/                     NEW workspace package
  src/launch.ts                       One-time persistent browser launch
  src/record.ts                       Walks TradingView UX, records spec
  README.md                           How to use the recorder
```

## End-to-end flow

```
┌──────────────────┐       TCP NDJSON         ┌──────────────────────┐
│ MetaTrader 5     │  ────────────────────►   │ apps/api (Node 22)   │
│ + EA on chart    │  ◄────────────────────   │  startMT5Bridge()    │
└──────────────────┘                          │  MT5Store            │
                                              │  IntentRouter        │
                                              │  SignalRunner        │
                                              │  Fastify REST + WS   │
                                              └─────┬───────────┬────┘
                                                    │ WS        │ REST
                                                    ▼           ▼
                                              ┌───────────────────────┐
                                              │ apps/web (Next.js)    │
                                              │  /terminal grid       │
                                              │  Order panel          │
                                              │  Indicator panel      │
                                              │  Signal builder       │
                                              └───────────────────────┘
```

## Configuration

`.env.example` now includes:

```bash
MT5_BRIDGE_PORT=7878
MT5_BRIDGE_HOST=0.0.0.0
```

Copy `.env.example` to `.env` and set whatever you need. SQLite is the
default DB; no Docker needed.

## Running locally (when you're back)

```bash
pnpm install                     # one-time
pnpm dev                         # runs web (:3000), api (:4000), ingestion
```

Open `http://localhost:3000/terminal`. The MT5 chip appears in the
top-right of the chart toolbar. Click it, copy the pairing token, install
the EA in MT5 (see `apps/mt5-ea/README.md`), paste the token in
`InpAccountToken`, set `InpHost`/`InpPort`, and attach the EA to any
chart. The chip flips to green when paired.

## TradingView recorder (optional)

```bash
pnpm --filter @supercharts/tv-recorder install:browser
pnpm --filter @supercharts/tv-recorder launch       # log in once
pnpm --filter @supercharts/tv-recorder record       # capture spec
```

Output lands in `apps/tv-recorder/output/`.

## What's deliberately not in this batch

- **Order execution UI on the chart canvas (drag SL/TP lines).** The
  order panel + click-to-trade actions all work; in-canvas line drag for
  SL/TP is a follow-up because it needs new drawing types wired into
  the existing drawing controller.
- **Backtesting engine.** Bar replay clips the chart, but it does not
  yet run signal recipes against the historical bars. Live recipes work.
- **Order history view.** Open positions + pending orders show in the
  right rail. A separate trade-history table over deals is a follow-up.
- **Per-broker symbol mapping.** `mapBrokerSymbol` in the order panel
  guesses by stripping `OANDA:` prefixes and underscores. Some brokers
  use suffixes (`EURUSD.r`, `EURUSD.pro`) — those land in the picker as
  raw broker symbols already; if the chart symbol id differs, pick from
  the watchlist or symbol search instead.
- **Trailing-stop "set_trailing" action.** Recipe-level trailing arrives
  on the open intent. Adjusting trailing on already-open trades from a
  recipe (the `set_trailing` action variant) is acked but not yet wired
  into the live tick loop.

## Known limitations

- The MT5 EA streams ticks via `OnTimer` at 4 Hz to keep the wire format
  simple. Faster streaming is possible but needs a binary protocol.
- The classic indicator runner recomputes everything on each new bar.
  For very large bar counts (> 5000) consider incremental updates.
- Bar replay does not yet pause WebSocket-driven candle updates — live
  bars keep arriving but are buffered, not rendered, while replay is on.

## Security

- The pairing token is one-time-ish (valid 24h until first attach) and
  stored in SQLite. Rotate any time.
- The EA accepts trade commands from whichever backend it connects to.
  Only point it at a SuperCharts you control.
- The TV recorder uses a persistent profile under
  `apps/tv-recorder/.tv-profile/` — that directory is gitignored. Your
  TradingView credentials never enter the repo.
