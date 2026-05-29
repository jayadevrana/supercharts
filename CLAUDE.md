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
- **Market data**: Binance public WS (no key) · OANDA (token via env) · **Yahoo Finance (free, no key — FX/metals/indices fallback when no OANDA token)** · MockProvider for dev
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
- [x] **4. Walk-forward analysis v1** — `runWalkForward` engine + `POST /api/alerts/:id/walk-forward`. Rolling 250-bar train / 60-bar test windows. Optimizer picks per train slice, OOS backtest on test slice. Aggregates OOS equity + computes robustness (OOS Sharpe / mean train Sharpe). UI: Shuffle icon → modal with 8 stat cards (Generalises ≥0.7 / Marginal 0.3-0.7 / Curve-fit <0.3) + per-window picks table.
- [x] **5. Paper-trading mode v1** — per-alert `delivery.paper` flag. Engine opens a virtual position on every cross fire, closes + flips on opposite fire. Persisted in `paper_trades`. New routes: GET `/api/alerts/:id/paper-trades`, GET `/api/alerts/paper/summary`, POST `/api/alerts/:id/paper/reset` (close-open or wipe). UI: ClipboardList icon per alert row → modal with toggle, 4 stat cards (Closed / Win rate / Total return / W-L), live open-position card, closed-trades table, Close-open + Wipe-history actions.

### Phase 2 — Risk & Portfolio

- [x] **6. Position sizer v1** — `apps/api/src/position-sizer.ts` with pure helpers for fixed_lots / risk_percent / cash_risk / kelly (fractional 0.25) / atr_scaled. Route `POST /api/alerts/:id/sizer-preview` backtests the alert to derive Kelly inputs (winRate, avg win/loss) + reads latest ATR, returns lot suggestions across all 5 modes. UI: Calculator icon per alert row → modal with 6 inputs (balance/risk%/risk$/SL pips/$pip/fixed lots), 4 backtest stat cards, side-by-side results table with formula breakdown.
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

- ✅ Free forex/metals/indices data via new `YahooProvider` (no OANDA token needed).
- `packages/market-data/src/providers/yahoo.ts` — Yahoo Finance chart API, no key.
  Maps catalog OANDA ids → Yahoo tickers (EUR_USD→EURUSD=X, XAU_USD→GC=F,
  SPX500_USD→^GSPC, …). REST `fetchHistoricalCandles` (period1/period2) + poll-based
  `subscribeCandles` (¼-bar, 15s–5min) emitting closed bars. volumeKind 'tick'.
- Bootstrap picks OANDA when token present, else Yahoo — registered under the `oanda`
  provider key so the venue resolver + all routes are unchanged.
- Verified live: yahoo **114 subs (38 symbols × 3 TF)** — every previously-dark alert
  now has data. EUR/USD 1d backtest pulled 711 real Yahoo bars (74 trades); gold
  (4534) + S&P500 (7563) candles flowing.
- Caveats (documented in provider): unofficial endpoint, IP-rate-limited, poll-only,
  no real FX volume, indices only during session. Fine for personal MVP, not resale.
- Also fixed 3 review bugs (ATR pip-size, telegram-status persist, MA warmup window).
- 144 alerts + 3 Telegram bots untouched; crypto still on Binance.

## Earlier

- Live PnL on paper trades (TradingView-style).
- Server marks every open paper position against `candleStore`'s latest close on each
  query — no WebSocket plumbing, sub-5ms per portfolio call. Open rows now carry
  `currentPrice`, `unrealizedPct`, `markedAt`.
- `PaperSummary` gained `unrealizedPct` + `totalPct`. New aggregate route
  `GET /api/alerts/paper/portfolio` returns `realisedPct + unrealizedPct + totalPct`
  + per-symbol breakdown sorted by total equity.
- UI: PaperTradesModal now polls every 3s + renders a `LiveOpenPositionCard` with
  big colour-coded PnL number (BUY/SELL · OPEN, held age, ENTRY/MARK/MOVE grid).
- Active tab header shows a live Paper Portfolio banner (realised / unrealized /
  total equity) when any paper position exists. Auto-refreshes every 3s.
- Live-verified on BTC 30m paper buy (entry 72500 → mark 73484): +1.36% live in
  modal, +1.32% in portfolio banner. Tick refresh works.
- 144 alerts + 3 Telegram bots untouched.

## Next pick

**Phase 2 · #7 — Portfolio heat.** Open-position correlation matrix + sector exposure
pie. Goal: surface "I have 5 EUR-pair longs that all move together" so the trader
can throttle correlated risk before MT5 fires them.

## Questions for owner

(none yet)
