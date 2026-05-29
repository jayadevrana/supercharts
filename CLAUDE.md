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
- [x] **7. Portfolio heat v1** — `apps/api/src/portfolio-heat.ts` (pure) + `GET /api/portfolio/heat`. Pearson correlation of log returns across open paper positions (or a `?symbols=` basket). Day-bucketed alignment so cross-provider daily bars (gold futures vs spot FX vs crypto, which open at different session times) line up by UTC day. Folds position SIDE into the correlation → a *directional* concentration score (two longs on a +0.9 pair = stacked risk; long+short = hedged). Asset-class buckets + net currency exposure (EUR_USD long → +EUR / −USD; the "5 EUR longs" check). UI: **Heat tab** in the alerts dialog — concentration headline + avg|corr| + stacked-pair count, amber stacked-risk warnings (clustered via union-find), N×N correlation heatmap (red = move together, blue = offset), asset-class + net-currency bars. "Analyse active alerts" maps the watched basket; empty state when <2 open positions. Exposure is equal-weight (paper_trades carry no lot size) — stated, not faked.
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

- 🔥 **Phase 2 #7 — Portfolio heat.** Correlation + concentration across open positions
  (or any basket). `apps/api/src/portfolio-heat.ts` (pure) + `GET /api/portfolio/heat`.
- Pearson of log returns over a lookback; **day-bucketed alignment** so cross-provider
  daily bars (gold futures vs spot FX vs crypto) line up by UTC day (fixed gold showing
  all-null correlations on exact-timestamp match).
- **Directional** concentration: position SIDE folds into the correlation, so two longs on
  a +0.9 pair register as *stacked* risk while a long+short reads as a hedge. Plus net
  currency exposure (EUR_USD long → +EUR / −USD) and asset-class buckets.
- UI: new **Heat tab** in the alerts dialog — concentration headline, stacked-risk
  warnings (union-find clusters), N×N heatmap (red together / blue offset), asset-class +
  currency bars, "Analyse active alerts" to map the watched basket. Empty state <2 positions.
- Verified in browser on the live 12-symbol basket: crypto block all 0.80–0.95 correlated
  (flagged as 10 stacked positions, net −10 USDT), FX near-zero vs crypto. Real data.
- Cleared **108 GB** of dev caches off the SSD at the owner's request (reinstalled +
  rebuilt supercharts to bring services back). 144 alerts + 3 bots intact.

## Earlier

- 📸 **Alert chart photos to Telegram** — every BUY/SELL alert ships a rendered PNG of the
  crossover (`alert-chart.ts` via `@napi-rs/canvas`, marker on the exact cross bar, same
  `computeMaCross` math). `sendTelegramPhoto()` multipart; text fallback so alerts never
  drop. Verified by a live engine fire (DOGE/BTC 1m) that auto-sent photos to the owner.
- 🔴→🟢 Fixed the **cold-start false-alert flood**: `initSubscription()` backfills history +
  seeds `lastFiredAt` before wiring the listener. The flood was the 114 forex alerts waking
  on Yahoo; crypto (Binance WS) could never flood. 0 events post-restart.
- Free FX/metals/indices via `YahooProvider`; 3 review-bug fixes; live paper PnL.

## Next pick

**Phase 2 · #8 — Per-strategy P&L attribution dashboard.** Break realised + open P&L down
by alert/strategy (and by symbol / asset class), so the trader sees which recipes actually
earn. Reuse `paper_trades` + the heat exposure helpers; surface as a dashboard tab.

## Questions for owner

(none yet)
