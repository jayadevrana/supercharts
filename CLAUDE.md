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
- [x] **2. Backtester v1** — `runMaCrossBacktest` engine + `POST /api/alerts/:id/backtest` route + result modal in Active tab. Pulls up to 1000 bars from candleStore (fetches from provider when sparse). Per-trade: enter on cross (RSI-gated when set), exit on reverse cross. Stats: trades, win rate, total return %, max DD %, Sharpe, profit factor, avg win/loss, avg bars. v1 model — no SL/TP/fees/slippage (Phase 1 #3 picks those up).
- [x] **3. Param optimizer v1** — `runOptimizer` engine + `POST /api/alerts/:id/optimize`. Grid sweeps fast/slow MA lengths (and RSI thresholds when filter set), reuses backtester per combo, ranks by composite score (Sharpe − 0.02 × Max-DD). UI: Sliders icon per alert row → results table with Apply button to overwrite alert config.
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

- ✅ Phase 1 #3 — Param Optimizer v1 shipped.
- `apps/api/src/optimizer.ts` — `runOptimizer(candles, base, interval, req)`. Grid
  sweep over fast lengths [5,7,9,12,15,20] × slow lengths [20,30,50,100,200] × RSI
  thresholds when filter set. Skips fast≥slow combos.
- Composite score = Sharpe − 0.02 × Max-DD%. Trades<minTrades disqualified.
- `POST /api/alerts/:id/optimize` — reuses candle fetch path from backtest. Returns
  top-N combos with full backtest summary.
- UI: Sliders icon per alert row → modal with sortable results table + Apply button
  that overwrites alert config (with confirm dialog).
- Browser-verified on **BTC 1d** (existing EMA 5×10 config): top combo EMA(7)×EMA(30)
  → +232% return · 35% win · Sharpe 0.95 · PF 2.61 · 40 trades · score 0.46.
- 144 alerts + 3 bots untouched.

## Next pick

**Phase 1 · #4 — Walk-forward analysis.** Train window / test window with rolling
re-optimization. Goal: for each rolling N-bar test window, optimize on the preceding
M-bar train window, apply best combo to test, accumulate out-of-sample equity. Shows
whether the optimizer's top picks generalize or are just curve-fit. Reuses
`runOptimizer` + `runMaCrossBacktest`.

## Questions for owner

(none yet)
