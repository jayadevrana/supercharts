# SuperCharts — Master Prompt

> Institutional-grade browser charting terminal for crypto & forex traders.
> Live tick data, multi-window grid, drawing tools, advanced indicators (SMC / footprint /
> heatmap / order flow), MA-crossover alerts (Telegram + web), MT5 automation bridge,
> Stripe-ready billing. Pricing: $400 / 6mo, $600 / 12mo.

Repo: `/Volumes/PortableSSD/new start/supercharts` (pnpm monorepo).

## Stack

- **Web**: Next.js 15 App Router · React 19 RC · Tailwind · Radix · Zustand (`:3000`)
- **API**: Fastify 5 · @fastify/websocket · `node:sqlite` (Node 26) · zod (`:4000`)
- **Chart engine**: Canvas 2D, layered `Layer` interface in `packages/chart-core`
- **Indicators**: `packages/indicators` (pure, tested) — the one TA/math impl scripts share
- **Market data**: Binance public WS (no key) · OANDA (env token) · Yahoo (free FX/metals/indices fallback) · Mock (dev). Order-flow/futures are **Binance-only**; other venues show "no data", never faked.
- **MT5**: TCP bridge on `:7878` + intent router + signal-runner
- **Telegram**: HTTP bot API, token server-side (last 4 to client)

## Build state

Feature-complete on **terminal + alerts + bulk MT5 automation** (54 tasks). Multi-pane grid
(1/4/8/9/16 + TV-style layouts); all chart types; persisted drawings; 48-symbol catalog;
liquidity heatmap / volume profile / footprint / deep-trade bubbles; 11 SMC indicators;
Signals & Trend Score + MTF; 1y backfill + pan-loads-more; MA-cross alert engine (single +
dual MA); Telegram delivery (chat-ID auto-detect, chart-snapshot PNG); watchlists + bulk
subscribe; bulk MT5 automation; logs tab.

**⚠️ Live config — DO NOT BREAK:** 48 alerts on **1d EMA(5) × EMA(10) close**, web + Telegram on.
Bot `@dipaloMA_bot` (chat `6386490802`) saved.

**24-indicator request — COMPLETE:** RVOL, VWAP σ-bands, Initial Balance, Naked POC, Market
Profile/TPO, real footprint pipeline (per-cell bid/ask + imbalance/stacked/absorption from the
live trade stream), Time & Sales tape, DOM ladder, whale/block highlight, Open Interest. Iceberg
folded into footprint **absorption**.

## Roadmap

### Phase 1 — Strategy & Backtesting (done)
- [x] 1. **Strategy Builder GUI** — `StrategyBuilderDialog` (Active/New/Templates), 4 presets, block conditions → `/api/signals` w/ `indicatorSpecs`.
- [x] 2. **Backtester** — `runMaCrossBacktest` + `POST /api/alerts/:id/backtest`; trades/win%/return/maxDD/Sharpe/PF (v1: no SL/TP/fees).
- [x] 3. **Param optimizer** — `runOptimizer` + `/optimize`; grid sweep MA/RSI, ranked by Sharpe − 0.02·maxDD; Apply overwrites config.
- [x] 4. **Walk-forward** — `runWalkForward` + `/walk-forward`; 250/60 train/test, OOS robustness; 8-stat modal.
- [x] 5. **Paper-trading** — per-alert `delivery.paper`; virtual position opens/flips on cross; `paper_trades` + routes; ClipboardList modal.

### Phase 2 — Risk & Portfolio (done)
- [x] 6. **Position sizer** — `position-sizer.ts` (fixed/risk%/cash/kelly/atr) + `/sizer-preview`; Calculator modal.
- [x] 7. **Portfolio heat** — `portfolio-heat.ts` + `/portfolio/heat`; directional correlation, asset-class + net-currency exposure, Heat tab.
- [x] 8. **P&L attribution** — `pnl-attribution.ts` + `/portfolio/attribution`; per instance/recipe/asset-class, P&L tab. (Fixed zod `delivery.paper` strip bug.)
- [x] 9. **Stat report** — `stat-report.ts` + `/portfolio/report` + `/send`; daily/weekly Telegram digest, Summary card. (Scheduler external.)
- [x] 10. **Max-drawdown breaker** — `dd-breaker.ts` + `routes/breaker.ts`; halts signal-runner via additive `shouldHalt`, Telegram on trip, UTC auto-reset, Breaker card.

### Phase 3 — Data & Integrations
- [ ] 11. OANDA token onboarding wizard (in-app form → user config)
- [ ] 12. News filter per watchlist (CryptoPanic + GDELT keyword scoring)
- [ ] 13. Economic calendar overlay (events as vertical markers)
- [ ] 14. CSV import for custom OHLC
- [ ] 15. TradingView webhook receiver (alerts in via HTTP)

### Phase 4 — Collaboration & Sharing
- [ ] 16. Public strategy share links · [ ] 17. Telegram broadcast channel · [ ] 18. Embedded iframe charts · [ ] 19. Multi-user workspaces

### Phase 5 — Polish & Scale
- [ ] 20. Auth.js (credentials + OAuth) · [ ] 21. Stripe billing live · [ ] 22. Persisted per-user layouts/indicators · [ ] 23. Mobile responsive · [ ] 24. PWA + offline snapshot · [ ] 25. WASM indicator pass

### Phase 6 — PulseScript language & code terminal  ← ACTIVE, build via /loop
**Goal:** SuperCharts' own chart-scripting language + in-app coding terminal.
**Spec:** `docs/pulsescript-design.md`. **Package:** `packages/script-lang` (`@supercharts/script-lang`).
**Hard rule:** ORIGINAL language — never reproduce another product's API/identifiers, keywords, or
syntax. Reuse `@supercharts/indicators` for TA/math so scripts and chart indicators share one
tested implementation. Universal domain terms (`sma`, `close`) are fine; structure/declaration
keywords are ours (`meta`/`let`/`mut`/`persist`/`when`/`draw`/`mark`/`fn`, `#` comments, `{ }` blocks).

Do the next unchecked task per loop — verify, commit small, tick here.
- [x] 1. **Lexer** — `lexer.ts`+`tokens.ts` (# comments, brace blocks, `[]`, newline-sep). 8 tests.
- [x] 2. **AST + parser** — `ast.ts`+`parser.ts` (recursive-descent/precedence; `ParseError` line/col). 10 tests.
- [x] 3. **Interpreter core** — `interpreter.ts` bar-by-bar; `[]` history; let/mut/persist; if/when/both `for`; `fn`; price series; `draw line`/`mark`/`meta`. 10 tests.
- [x] 4. **Stdlib** — `stdlib.ts`: `math.*` + `ta.*` reusing `@supercharts/indicators` (sma/ema/wma/rma/stdev direct; rsi via Wilder `rma`; atr/vwap/macd/stoch off candles). Bare + `ta.` calls; `crossOver`/`crossUnder`/`rising`/`falling`/`change`/`highest`/`lowest`; `nz`/`na`; `draw hist`/`band`. 36 tests.
- [x] 5. **Inputs** — `collectInputs()` AST pre-pass → `RunResult.inputs` schema (id/kind/default/title/min/max/step/options); `runScript(…, { inputs })` overrides by id; `input.source` → chosen price series. 45 tests.
- [x] 6. **Web code terminal** — `code-terminal-dialog.tsx` (toolbar **Script** button): lazy CodeMirror 6 editor + sample script, Run, "On chart" toggle, console (errors with line/col, or a meta-name + plot/mark/input summary), and a schema-driven inputs panel. The run happens in `ChartPane` over that pane's own candle buffer (so plot values stay index-aligned) and pushes `draw line/band` → a dedicated **`pulse-script` IndicatorsLayer** (id/zIndex now constructor-settable) + `mark buy/sell/note` → colored dots. Store carries per-pane `pulse` state + a `pulseResults` channel. Browser-verified on BTCUSDT 1m: Fast/Slow EMA lines + buy marks render; inputs (Fast/Slow EMA) drive a re-run.
- [ ] 7. **Persistence** — save/list/load user scripts (API route + table, like layouts).
- [ ] 8. **Safety** — exec timeout, bar/loop caps, no IO, line-numbered runtime errors. (Pick up the `ta.*` period≤0 → empty-plot guard here.)

**Deferred follow-up (flagged, not a roadmap task):** `ta.*` memo recomputes each indicator's full
array every bar (O(n²); candle-only studies recompute a bar-invariant result n times) + a
pre-existing `persist`-declared-inside-a-conditional carry bug — batch into one hardening commit.

Then: Phase 3 · #11.

## Working agreement (for Claude loop)

- Never fabricate market data. Never fake API responses.
- Never break the live alerts or Telegram config that's already wired.
- Verify every feature with a browser screenshot before commit.
- Commit small. One feature → one commit.
- Update the **Recent log** / **Next pick** footer before each commit.
- If blocked, append to **Questions for owner** + skip to next item.

## Ops / gotchas

- **Laptop sleep drops the USB SSD → kills dev servers.** Recover: `lsof -ti tcp:4000 | xargs kill -9; lsof -ti tcp:3000 | xargs kill -9` then `pnpm -F @supercharts/api dev &; pnpm -F @supercharts/web dev &` (the tsx watcher's child holds the port; pkill alone leaves it). Code/commits are never at risk; the alert engine reloads on boot.
- **WS handler effects pin stale overlay flags** (effect dep `[symbol,interval]`) → read the flag from a live ref (the `tapeOnRef`/`domOnRef` pattern), and dedup re-delivered stream rows by id.
- **Price format ≥ 2 decimals** for ≥1000 prices so adjacent BTC levels don't collapse to one row.
- Vitest suite in `tests/` (import pure modules by relative source path); ESLint flat config (`eslint.config.mjs`).
- Feature-video assets live in `~/sc-video/` (final MP4s, Voicebox voice chunks, capture scripts) — **not** in the repo.

## Recent log

- 🧬 **PulseScript 1–6 done** — task 6 shipped the **in-app code terminal** (toolbar Script button → CodeMirror editor, Run, inputs panel, console; `draw`/`mark` render on the chart via a dedicated `pulse-script` layer, run in `ChartPane` over the pane's candles so overlays stay aligned). Added `@uiw/react-codemirror` (lazy) + `@supercharts/script-lang` to the web app. Browser-verified on BTCUSDT (EMA lines + buy marks). Next = task 7 (persistence: save/list/load scripts) then task 8 (safety). The flagged perf/persist follow-up landed separately (interpreter `persist` lazy-carry + ta cache hardening — script-lang now 47 tests).
- 🔭 **Order-flow + futures set shipped:** real footprint pipeline (`apps/ingestion/src/footprint-aggregator.ts` → WS → `FootprintLayer`), Time & Sales tape, DOM ladder, Open Interest (`routes/futures.ts`, Binance USD-M, 30s cache). Plus RVOL, VWAP σ-bands, Initial Balance, Naked POC, Market Profile/TPO (`MarketProfileLayer`).
- 📸 Alerts ship a rendered crossover PNG to Telegram (`alert-chart.ts`); cold-start false-alert flood fixed (backfill + watermark).

## Questions for owner

(none yet)
