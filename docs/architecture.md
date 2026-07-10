# SuperCharts — Architecture / Codebase Map

> Read this at session start **instead of re-exploring the repo**. Update it when structure
> changes (new package, new route file, moved component). Last verified against the tree: 2026-06-10.

## Monorepo

pnpm workspaces: `apps/*`, `packages/*` (`pnpm-workspace.yaml`). Node ≥20 (runtime uses `node:sqlite`), pnpm 9.12.2.

Root scripts: `dev` (all apps parallel) · `dev:web` · `dev:api` · `dev:ingestion` · `build` · `typecheck` · `lint` · `test` (= `vitest run`).

Ports: web `:3000` · api `:4000` · MT5 TCP bridge `:7878`.

`reserch/` = owner's personal research — **gitignored, never commit**. `infra/` = deploy scaffolding. macOS `._*` AppleDouble files appear on the USB SSD — ignore them.

## apps/web — Next.js 15 App Router · React 19 RC · Tailwind · Radix · Zustand

- `app/` — landing page, `/terminal` (the product), `/login`, `/signup`, `/pricing`, `/legal`, `/s/[token]` (public read-only strategy share).
- `features/terminal/` — **all terminal UI lives here** (37 files):
  - **Chart**: `chart-grid.tsx` (pane grid, active-pane fallback), `chart-pane.tsx` (ChartCore host — candles, WS subscribe, indicators, PulseScript runs over the pane's own candle buffer), `drawing-controller.ts` (two-gesture drawing: click-move-click AND drag; Escape cancels; magnet/lock/hide flags + `clearAll`, snap math in `drawing-snap.ts`), `sub-pane-indicators.tsx` (oscillator sub-panes grouped by `inst.paneId`, shared time axis), `indicator-legend.tsx`, `symbol-status-line.tsx`.
  - **Stores (Zustand)**: `terminal-store.ts` (panes/layouts, overlays, `classicIndicators[]`, `pulse` + `pulseResults`, `dataWindow`, `backtestPreview`, `rightRailTab`, `indicatorSettingsTarget`, `showBottomPanel`), `mt5-store.ts`.
  - **Rails/bars**: `terminal-top-bar.tsx` (Script/Backtest/Import/OANDA/Webhook/Broadcast/MT5 buttons + `workspace-settings-popover.tsx` behind the cog), `left-rail.tsx` (drawing tools + magnet/lock/hide toggles + remove-all menu), `right-rail.tsx` (tabs: Trade · Ind · Data · Watchlist · News · Scanner · Layers), `replay-bar.tsx` (steps by the active pane's interval).
  - **Dialogs**: `alerts-dialog`, `backtest-dialog`, `strategy-builder-dialog`, `indicators-dialog` (browser: favorites/recent/alias search/DnD), `import-csv-dialog`, `oanda-connect-dialog`, `mt5-connect-dialog`, `broadcast-dialog`, `webhooks-dialog`, `layout-picker`. (`signal-builder-dialog` was orphaned — deleted 2026-07-10; strategy-builder owns `/signals`.)
  - **Panels**: `pulse-editor-panel.tsx` (PulseScript bottom dock — editor · Console | Strategy Tester | Optimizer tabs), `order-panel`, `dom-ladder-panel`, `time-sales-panel`, `open-interest-panel`, `sts-dashboard`.
  - **Pure utils (unit-tested)**: `data-window-util`, `indicator-legend-util`, `indicator-manager-util`, `indicator-prefs` (localStorage), `layouts`.
- `components/ui/` — Radix-styled primitives. **Gotcha:** `cn` is plain clsx (no tailwind-merge); `DialogContent` only emits its default `max-w-lg` when the caller passes no `max-w-*`.
- `lib/` — helpers incl. `strategy-describe.ts` (conditions/actions → plain English).

## apps/api — Fastify 5 · `node:sqlite` · zod

- `main.ts` — boot: db, routes, ws-gateway, alert engine, MT5 bridge + token re-hydration, custom-dataset re-seed, saved-OANDA-creds load.
- `db.ts` — SQLite tables: users, sessions, subscriptions, watchlists, watchlist_symbols, chart_layouts, user_scripts, drawing_objects, alerts, alert_events, telegram_configs, telegram_bots, paper_trades, user_preferences, oanda_credentials, custom_datasets, telegram_channels, telegram_broadcasts, strategy_shares, webhook_endpoints, webhook_events, news_saved_items, mt5_pairing_tokens, mt5_accounts, signal_recipes, indicator_layouts.
- `routes/` (20 files):
  - `alerts.ts` — alert CRUD + per-alert `/backtest` `/optimize` `/walk-forward` `/sizer-preview` paper routes, **and the standalone endpoints**: `POST /api/backtest` (L531), `POST /api/optimize` (L614), `POST /api/optimize/script` (L722), `POST /api/backtest/script` (L826).
  - `signals.ts` SignalRecipes (strategy builder) · `share.ts` strategy share + public `GET /api/public/strategy/:token` · `scripts.ts` user_scripts CRUD · `indicators.ts` indicator_layouts persistence · `layouts.ts` chart layouts · `drawings.ts` · `watchlists.ts` · `preferences.ts`.
  - `market.ts` candles/symbols (serves `CUSTOM:` cache-only) · `custom-data.ts` CSV OHLC datasets · `futures.ts` Binance USD-M open interest · `calendar.ts` economic calendar · `news.ts` + `/api/news/watchlist/:id`.
  - `mt5.ts` pairing/status · `oanda.ts` credential wizard · `webhooks.ts` inbound receiver `/api/webhooks/in/<token>` · `broadcast.ts` Telegram channels · `breaker.ts` max-DD breaker · `billing.ts` (Stripe-ready, not live).
- Core modules (pure, unit-tested, one per feature): `alert-engine.ts` (MA-cross + indicator alerts, Telegram/web delivery, anti-flood watermark), `alert-chart.ts` (PNG snapshot), `backtester.ts` (`runMaCrossBacktest` + `runSignalBacktest` + optional realism: commission/slippage/SL/TP), `optimizer.ts` (`runOptimizer`/`rankPeak`, hard filters + robustness flags), `script-optimizer.ts` (PulseScript input sweeps, time-budgeted deterministic), `walk-forward.ts`, `signal-eval.ts` (shared evaluator: alerts + MT5 runner), `position-sizer.ts`, `portfolio-heat.ts`, `pnl-attribution.ts`, `stat-report.ts`, `dd-breaker.ts`, `telegram.ts` + `telegram-broadcast.ts`, `news-relevance.ts`, `economic-calendar.ts`, `csv-ohlc.ts`, `webhook-signal.ts`, `strategy-share.ts`, `auth.ts`, `demo-guard.ts`, `ws-gateway.ts`.
- `mt5/` — `bridge.ts` (TCP `:7878`), `intents.ts`, `risk.ts`, `signal-runner.ts`, `state.ts`. **KNOWN issue:** ws-gateway broadcasts MT5 events unscoped per-user — fix before multi-user auth.

## apps/ingestion — market-data fan-in

`main.ts`, `subscription-manager.ts`, `candle-store.ts`, `backfill.ts` (1y), `event-bus.ts`, `footprint-aggregator.ts` (per-cell bid/ask + imbalance/absorption), `heatmap-aggregator.ts`, `deep-trade-detector.ts`.

## apps/mt5-ea · apps/tv-recorder

`mt5-ea/SuperChartsBridge.mq5` + `Include/` — the MQL5 EA that pairs with the TCP bridge. `tv-recorder/` — internal capture tooling (not product).

## packages/

- **chart-core** — canvas engine: `chart-core.ts` (ChartCore, `invalidate()`), `viewport.ts`, `scale.ts`, `axis` via layers, `theme.ts`, `pure.ts`. `layers/`: axis, crosshair, deep-trades, drawings, economic-events, footprint, grid, heatmap, indicators (also hosts the `pulse-script` instance), ma-cross, market-profile, price-series, signals-trend-score, smc, tooltip, volume-profile, volume. `series/`: heikin-ashi, kagi, line-break, point-and-figure, range-bars, renko. `indicators/`: chart-side calcs (dmi, supertrend, smc/, signals-trend-score, ma-cross, series-math).
- **indicators** — **the single shared TA implementation** (charts, PulseScript stdlib, alert engine all reuse it): `registry.ts` + `runner.ts` (`computeAll`); category files `ma` / `oscillators` / `patterns` / `profile` / `trend` / `volatility` / `volume`.
- **script-lang** — PulseScript: `tokens` → `lexer` → `parser`/`ast` → `interpreter` (bar-by-bar, `[]` history, let/mut/persist, sandbox: 2s timeout, 50k bars, loop caps, no host globals) → `stdlib` (`ta.*` reusing @supercharts/indicators, memoized) + `collectInputs`. Spec: `docs/pulsescript-design.md`. **Hard rule: ORIGINAL language — never reproduce another product's API/keywords.**
- **market-data** — provider adapters: Binance public WS, OANDA, Yahoo fallback, Mock.
- **types** — shared domain types (`AlertDefinition` discriminated union, `SignalRecipe`/`SignalCondition`, candles…).
- **ui**, **config** — shared primitives/config.

## Tests & conventions

- Vitest at repo root: `tests/` (35 files, `_helpers.ts`); config `vitest.config.ts`; **import pure modules by relative source path** (no package build step). ESLint flat config `eslint.config.mjs`.
- Feature pattern: pure unit-tested module in `apps/api/src/` + thin route + dialog/panel in `features/terminal/` + (if chart-visible) a `Layer` + `overlays.*` store flag + Layers-tab toggle.
- Verify loop per increment: typecheck touched packages → relevant Vitest → headless-browser screenshot on `/terminal` → commit small.

## Env (`.env.example`)

`NEXT_PUBLIC_APP_URL/API_URL/WS_URL` · `AUTH_SECRET`/`ENCRYPTION_KEY` · `OANDA_API_TOKEN/ACCOUNT_ID/ENV` (UI wizard overrides env) · provider flags `BINANCE_ENABLED` etc. · optional news keys (`CRYPTOPANIC_API_KEY`, `FINNHUB_API_KEY`, `NEWSAPI_KEY`, `GDELT_ENABLED`) · `STRIPE_*` (not live) · `MT5_BRIDGE_PORT/HOST` · feature flags `ENABLE_REPLAY/FOOTPRINT/HEATMAP/DEEP_TRADES`. Postgres/Redis/ClickHouse vars exist in the example but the runtime store is `node:sqlite`.

## Docs index

| File | Contents |
| --- | --- |
| `CLAUDE.md` | Master prompt: state, roadmap, working agreement, session protocol, log (≤5) |
| `docs/architecture.md` | This map |
| `docs/changelog.md` | Full build history (archived Recent-log entries) |
| `docs/pulsescript-design.md` | PulseScript language spec |
| `docs/strategy-backtesting.md` | Strategy Tester / backtest how-to |
| `docs/mt5-setup.md` · `docs/MT5_AND_TRADING.md` | MT5 bridge + EA setup |
| `docs/AFK_HANDOFF.md` | Older AFK handoff note |
| `DEMO.md` | Public read-only demo from the Mac |
| `README.md` | Product overview |
| `.audit/tv-parity/PUNCHLIST.md` | TradingView-parity gap list (64 gaps / 18 increments) |
