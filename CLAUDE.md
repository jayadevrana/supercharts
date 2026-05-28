# SuperCharts — Master Prompt

> Institutional-grade browser charting terminal for crypto & forex traders.
> Live tick data, multi-window grid, drawing tools, advanced indicators (SMC / footprint /
> heatmap / deep trades), MA-crossover alerts (Telegram + web), MT5 automation bridge,
> Stripe-ready billing. Pricing: $400 / 6mo, $600 / 12mo.

Repo: `/Volumes/PortableSSD/new start/supercharts` (pnpm monorepo).

## Stack

- **Web**: Next.js 15 App Router · React 19 RC · Tailwind · Radix · Zustand
- **API**: Fastify 5 · @fastify/websocket · `node:sqlite` (Node 26) · zod
- **Indicators / chart engine**: Canvas 2D, layered `Layer` interface in `packages/chart-core`
- **Market data**: Binance public WS (no key) · OANDA (token via env) · MockProvider for dev
- **MT5**: Custom TCP bridge on :7878 + intent router + signal-runner
- **Telegram**: HTTP bot API, token stored server-side (last 4 chars to client)

## Build state (as of init)

Monorepo is feature-complete on **chart terminal + alerts + bulk MT5 automation**. 54 tasks shipped:

- Multi-pane terminal (1/4/8/9/16 + TradingView-style layouts)
- All chart types (candles / heikin-ashi / renko / range / kagi / line-break / point-and-figure)
- Drawing system persisted to API + drag/resize/delete
- 48-symbol catalog: 10 crypto, 7 FX major, 8 FX minor, 10 FX cross, 3 metals, 10 indices
- Liquidity heatmap · volume profile · footprint · deep-trade bubbles
- 11 SMC indicators (FVG / Order Blocks / Liquidity / BOS/CHoCH / Premium-Discount / AVWAP / CVD / Sessions / HVN-LVN / Regime)
- Signals & Trend Score (Pine port) + MTF dashboard + bottom strip
- Backfill 1y history per watchlist symbol + pan-loads-more
- **MA cross alert engine**: single-MA price-cross + dual-MA (e.g. EMA 5×10)
- **Telegram delivery**: bot validation, auto-detect chat ID via getUpdates
- **Watchlists**: CRUD + bulk-subscribe alerts from a list
- **Bulk MT5 automation**: arm signal-recipes for every symbol×side from a watchlist
- **Logs tab**: 8s auto-refresh, single + clear-all delete

Current live config: 48 alerts on **1d EMA(5) × EMA(10) close**, web + Telegram on. Bot
`@dipaloMA_bot` (chat `6386490802`) saved. **Do not break this.**

## Roadmap

### Phase 1 — Strategy & Backtesting

- [x] **1. Strategy Builder GUI v1** — `StrategyBuilderDialog` with Active / New / Templates tabs. 4 one-click presets (MA cross, RSI oversold, bullish engulfing, London session breakout). Block-based condition rows + open-position action with sizing/SL/TP/cooldown. Reuses `/api/signals` with `indicatorSpecs` thread so MA params actually take effect.
- [ ] 2. Backtester — run a recipe over loaded candles, plot entry/exit markers + equity curve + drawdown + win-rate + Sharpe
- [ ] 3. Param optimizer — grid sweep over MA lengths / SL / TP, rank by Sharpe + max-DD
- [ ] 4. Walk-forward analysis — train window / test window with rolling reoptimization
- [ ] 5. Paper-trading mode — replay engine + virtual P&L on the active strategy

### Phase 2 — Risk & Portfolio

- [ ] 6. Position sizer (Kelly, fixed fractional, ATR-scaled) integrated into Strategy Builder
- [ ] 7. Portfolio heat — open-position correlation matrix + sector exposure pie
- [ ] 8. Per-strategy P&L attribution dashboard
- [ ] 9. Daily / weekly stat report (web + Telegram summary)
- [ ] 10. Max-drawdown breaker — pause all recipes when daily-DD breached

### Phase 3 — Data & Integrations

- [ ] 11. OANDA token onboarding wizard (in-app form → write to user config)
- [ ] 12. News filter per watchlist (CryptoPanic + GDELT keyword scoring)
- [ ] 13. Economic calendar overlay on chart (events as vertical markers)
- [ ] 14. CSV import for custom OHLC data
- [ ] 15. Tradingview webhook receiver (alerts in via HTTP)

### Phase 4 — Collaboration & Sharing

- [ ] 16. Public strategy share links (read-only)
- [ ] 17. Telegram broadcast channel (1 admin → many subscribers)
- [ ] 18. Embedded charts (iframe widget for blogs)
- [ ] 19. Multi-user workspaces (team accounts)

### Phase 5 — Polish & Scale

- [ ] 20. Auth.js (credentials + OAuth) replacing demo user
- [ ] 21. Stripe billing live (already scaffolded)
- [ ] 22. Persisted per-user layouts + indicators per pane
- [ ] 23. Mobile responsive terminal
- [ ] 24. PWA install + offline last-known snapshot
- [ ] 25. WASM-accelerated indicator pass

## Working agreement (for Claude loop)

- Never fabricate market data. Never fake API responses.
- Never break the live alerts or Telegram config that's already wired.
- Verify every feature with a browser screenshot before commit.
- Commit small. One feature → one commit.
- Update the **Last session** / **Next pick** footer before each commit.
- If blocked, append to **Questions for owner** + skip to next item.

## Last session

- ✅ RSI filter on MA cross + 3rd bot (`@dipaloSwing_bot`) shipped.
- `MaCrossAlertConfig.rsiFilter?: { length, buyBelow, sellAbove }` — engine evaluates RSI
  at the crossover bar; fires only when side-specific threshold satisfied. RSI value
  surfaced in `AlertEvent.rsiValue` and Telegram message.
- 3 bots saved:
  - `Default` (•Nfcs) — 48 alerts on 1d EMA(5)×EMA(10)  *(no rsiFilter)*
  - `Scalp bot` (•KfoM) — 48 alerts on 30m EMA(9)×EMA(21)  *(no rsiFilter)*
  - `Swing bot` (•Xi_I) — 48 alerts on **1h EMA(20)×EMA(50) + RSI(6) gate (buy ≤ 25 / sell ≥ 75)**
- **144 active alerts total** across the catalog.
- Browser-verified: 3 bots render in Telegram tab, all LIVE, per-row test works.

## Next pick

**Phase 1 · #2 — Backtester.** Run a saved recipe over the candle store, emit
entry/exit markers + equity curve + win-rate + max-DD + Sharpe. Goal: one-click "test"
button on each recipe row that opens a result modal. Reuse existing condition evaluator
from `signal-runner` so backtest = same code as live.

## Questions for owner

(none yet)
