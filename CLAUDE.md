# SuperCharts — Master Prompt

> Institutional-grade browser charting terminal for crypto & forex traders.
> Live tick data, multi-window grid, drawing tools, advanced indicators (SMC / footprint /
> heatmap / order flow), MA-crossover alerts (Telegram + web), MT5 automation bridge,
> Stripe-ready billing. Pricing: $400 / 6mo, $600 / 12mo.

Repo: `/Volumes/PortableSSD/new start/supercharts` (pnpm monorepo).
Codebase map: `docs/architecture.md` · Full build history: `docs/changelog.md`.

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
- [x] 11. **OANDA onboarding wizard** — `oanda_credentials` table + `routes/oanda.ts` (GET status / POST validate-against-real-OANDA-then-store / DELETE; token stays server-side, client sees only last4 + verified account meta). `OandaConnectDialog` (top-bar **OANDA** button → token / account / practice-live form → validate & connect, connected card + disconnect). Saved creds drive the live forex feed at boot (override env → Yahoo fallback). Verified: real OANDA rejects a dummy token with its own error message (nothing stored on failure); browser wizard flow.
- [x] 12. **News filter per watchlist** — original keyword-scoring engine (`apps/api/src/news-relevance.ts`): maps each watchlist symbol to factual market keywords (coin/currency/metal/index names, central banks, pair forms), biases the keyless GDELT query + CryptoPanic `currencies`, then re-ranks every headline by genuine relevance and reports the matched symbols. `GET /api/news/watchlist/:id` + News-tab scope chips (symbol vs each list) with a relevance bar + matched-symbol badges. 14 unit tests; browser-verified UI wiring.
- [x] 13. **Economic calendar overlay** — real keyless macro feed (Forex Factory weekly JSON mirror) → pure tested normalizer (`apps/api/src/economic-calendar.ts`) → `GET /api/calendar/economic` (30-min cache, honest `unavailable` on failure, impact filter). `EconomicEventsLayer` draws impact-coloured vertical dashed markers + currency tags + a hover tooltip (title/forecast/previous); per-pane toggle in the Layers tab. Added `ChartCore.invalidate()` for immediate repaint. 7 unit tests; browser-verified on /terminal (USD/EUR markers on real 06-01/06-02 events).
- [x] 14. **CSV import for custom OHLC** — pure, unit-tested parser (`apps/api/src/csv-ohlc.ts`: auto-detects delimiter/header/time-format, infers the bar interval, drops bad rows). `custom_datasets` table + `routes/custom-data.ts` (POST parse+store+seed candle store, GET list, DELETE) re-seeded at boot; serves under `CUSTOM:<slug>` via the existing `/api/candles` (unknown venue → cache-only). `ImportCsvDialog` (top-bar **Import**: file picker, lists/deletes datasets, opens the symbol on the active pane). Also fixed a chart-core fit-order bug so static data fills the price scale. 11 unit tests; browser-verified charting a real round-tripped BTC daily CSV.
- [x] 15. **Inbound webhook receiver** — each user gets a secret URL `/api/webhooks/in/<token>` that external systems (e.g. a TradingView alert) POST signals to. Pure tested parser (`apps/api/src/webhook-signal.ts`: own schema, accepts JSON or plain text + generic aliases, HTML-safe Telegram formatter). `webhook_endpoints` + `webhook_events` tables + `routes/webhooks.ts` (public token-auth receiver; authed manage / regenerate / forward-toggle / clear). Opt-in Telegram forward (default OFF, reuses the live bot read-only — never alters it). `WebhooksDialog` (top-bar **Webhook**: URL+copy, regenerate, forward switch, example payload, live recent-signals list). 10 unit tests; API smoke (json/text/form, 404 on bad token); browser-verified.

### Phase 4 — Collaboration & Sharing
- [x] 16. **Public strategy share links** — publish a strategy (SignalRecipe) to a read-only `/s/<token>` page. Pure tested sanitizer (`apps/api/src/strategy-share.ts`) strips owner/account/internal ids; `strategy_shares` table + `routes/share.ts` (authed POST/GET/DELETE `/api/signals/:id/share` + public no-auth `GET /api/public/strategy/:token`). Web: `lib/strategy-describe.ts` renders conditions/actions in plain English; public page `app/s/[token]` (branded SiteHeader/Footer, read-only rule cards, risk caps, CTA); Share button in the strategy-builder Active list (copies the link). 4 unit tests; API smoke (sanitize/404/revoke); browser-verified the public page + the builder entry point.
- [x] 17. **Telegram broadcast channel** — link a Telegram channel one of your bots admins and push one-to-many messages to it (separate from the private alert chat). Pure tested `normalizeChannelId` + read-only `getTelegramChat` validation (no message sent); `telegram_channels` + `telegram_broadcasts` tables + `routes/broadcast.ts` (list / add-with-validation / delete / broadcast via `sendTelegramMessage` parseMode None / log) reusing existing bots read-only. `BroadcastDialog` (top-bar **Broadcast**: pick a bot, link a channel, compose + send, recent-broadcast log). Never touches the live alert/Telegram config. 6 unit tests; API smoke (real getChat validation, error paths, no spam); browser-verified.
- [ ] 18. Embedded iframe charts · [ ] 19. Multi-user workspaces

### Phase 5 — Polish & Scale
- [ ] 20. Auth.js (credentials + OAuth) · [ ] 21. Stripe billing live · [ ] 22. Persisted per-user layouts/indicators · [ ] 23. Mobile responsive · [ ] 24. PWA + offline snapshot · [ ] 25. WASM indicator pass

### Phase 6 — PulseScript language & code terminal  ← COMPLETE (1–8 done)
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
- [x] 7. **Persistence** — `user_scripts` table + `routes/scripts.ts` (per-user list/create/get/update/delete, mirrors layouts). Code terminal gained **Open** (saved list → load / delete) + **Save** (name → create, or update / save-as) + a loaded-name badge. Verified: API CRUD round-trip (create→list→get→rename→delete; empty-name→400) and a browser save→list→load on /terminal.
- [x] 8. **Safety** — `RunOptions.timeoutMs` (default 2s; checked per-bar + every 4096 loop steps → line-numbered abort) and `maxBars` (default 50k) on top of the existing loop-step cap; scripts can't reach host globals/IO (unknown idents/calls throw — verified for `fetch`/`window`/`process`); `ta.*` periods clamp to ≥1 via `len()`, so `sma(close, 0)` floors to a 1-bar window instead of an empty series. 6 safety cases → **56 script-lang tests green, typechecks**. **← Phase 6 COMPLETE.**

**Hardening follow-up (done — not a roadmap task):** the `ta.*` memo no longer recomputes per bar —
series:0 studies cache once per (fn, params) and candle-derived series-based calls compute once over
the run (verified: each `compute` runs 1× over 400 bars), with a per-bar fallback kept for
`persist`/`mut`-driven series or varying params; and a `persist` declared inside a skipped
`if`/`when`/`for` now resumes from its last *defined* value instead of going NaN. Plus small cleanups
(dropped redundant `clean()`, shared `priceFromCandle`). script-lang now 50 tests, typechecks.

### MISSION — TradingView-style indicator system (ACTIVE)
**Goal:** extend the EXISTING indicator system to a TradingView-grade add/configure/view experience — not a rebuild.
**Already exists (DO NOT REBUILD, only extend):** registry of 38 indicators (`@supercharts/indicators` `registry.ts` + `computeAll` runner, unit-tested) · indicator browser (`indicators-dialog.tsx`) · right-rail panel (`indicator-panel.tsx`: list/add/settings/hide/delete) · canvas overlays (`IndicatorsLayer` — lines/bands/dots) + sub-pane oscillators (`sub-pane-indicators.tsx` — lines/histograms/reference bands) · crosshair OHLCV tooltip (`layers/tooltip.ts`, `ChartCore.onCrosshair`) · per-pane `classicIndicators[]` store + `indicator_layouts` persistence (`routes/indicators.ts`) · **PulseScript** (`@supercharts/script-lang`, complete original Pine-like language + CodeMirror editor + `user_scripts`) · alerts (MA-cross engine + `SignalCondition` union: indicator_compare/price_crosses/session/time_window/pattern).
**Rules:** ADD only — never remove/break a working feature; reuse `@supercharts/indicators`; never fabricate market data; never break the live alerts/Telegram config. One increment → verify (typecheck touched packages + relevant Vitest + browser screenshot on /terminal) → commit small → tick here.
- [x] M1. **Browser favorites + recently-used + keyboard nav** — star/persist (localStorage `indicator-prefs.ts`, 6 tests), Recently-used (cap 12), ↑/↓/Enter focus nav. Browser-verified incl. persistence across reload. (commit `2b4c537`)
- [x] M2. On-chart **indicator legend / status line** — top-left per pane: colour swatch + name + input summary (`EMA 21 · close`) + live value at the crosshair candle (accent-coloured; latest when off-chart) + hover controls eye(visibility)/gear/× . Gear opens the right-rail **Ind** tab focused on that instance (new controlled `rightRailTab` + `indicatorSettingsTarget` store fields). Pure tested `indicator-legend-util.ts` (summary/colour/format/`buildLegendRows`, 8 tests). Browser-verified: EMA(overlay)+RSI(sub-pane) values render and update with the crosshair; gear → Ind editor. (commit `6538574`)
- [x] M3. **Data Window** panel — new right-rail **Data** tab: time + crosshair/latest badge, OHLCV with Change/Change% (bull/bear) + K/M/B volume, then every visible indicator's **all** channel values at the crosshair candle (latest when off-chart; "—" for hidden/warmup/NaN). Pure tested `data-window-util.ts` (`buildDataWindow` + `formatVolume`, 4 tests). The active pane publishes a compact snapshot to the store (`dataWindow`); heavy series stay in the chart-pane ref. Browser-verified with EMA + MACD. (commit `b3b4c17`); EMA-of-NaN-prefix bug found here fixed in `310730d` so MACD signal/histogram now compute.
- [x] M4a. **Indicator manager — multi-instance + duplicate + reorder.** The right-rail **Ind** panel supports multiple instances of one type with numbered names (EMA, EMA 2, EMA 3…), a **duplicate** button (clones inputs/style with a fresh id), and **up/down reorder** (keyboard-accessible buttons; disabled at the edges); the legend + Data Window now show the numbered `inst.name`. New store `reorderIndicator`; the chart already keys every line/series by instance id so duplicates render distinctly. Pure tested `indicator-manager-util.ts` (`nextIndicatorName` + `reorderInstances`, 5 tests). Browser-verified: add 2 EMAs → duplicate → reorder; the legend tracks the new order. (commit `faab2d8`)
- [x] M4b. Indicator **settings as a tabbed modal** (Inputs / Style / About) — centered Dialog + Tabs, real Style controls (colour picker, line width, line style, reset), wired to the canvas. (parity INC-7 `9a55458` + INC-8 `14188fd`)
- [x] M5. **Create alert from an indicator** — additive `indicator`-type `AlertDefinition` (discriminated union; ma_cross path untouched). Shared `signal-eval.ts` evaluator (extracted from the MT5 runner, reused by both); engine `initIndicatorSubscription`/`evaluateIndicator` deliver via the existing Telegram/web path. Launched from a new **Alert** tab in the settings modal (plot · condition · level · side · Telegram bot). 8 evaluator unit tests; the 144 live ma_cross alerts re-subscribed clean. (parity INC-14)
- [x] M6. **Drag-and-drop** — drag an indicator row from the browser dialog onto the chart to add it (HTML5 DnD: rows `draggable` set `application/x-sc-indicator`; the chart pane resolves it via an exported `ENTRY_INDEX` + `buildInstance` on drop, with a "Drop to add" dashed-overlay hint and `dropEffect=copy`). Overlay/SMC entries turn on (idempotent), classic entries add an instance. Keyboard/menu fallback = the existing click-to-add. **Remaining DnD refinements (tracked as INC-16/17):** legend drag-reorder (up/down buttons already exist as the fallback) and pane-separator resize. (parity INC-17 core)

#### TradingView-parity audit (2026-06-06) — live-capture + 23-agent workflow → 64 gaps / 18 increments (`.audit/tv-parity/PUNCHLIST.md`). Parity 42→ climbing. Done so far:
- [x] **INC-1** acronym/alias search ("EMA"/"BB"/"SAR" resolve) `4d1ba0f`
- [x] **INC-3** legible manager rows (swatch · params · tooltip · On price/Lower panes groups) `a966318`
- [x] **INC-11 (BLOCKER)** oscillator sub-panes share the chart's real time axis + pan/zoom + crosshair + auto-scale `efe6d69`
- [x] **INC-6** TradingView-style symbol status line (OHLC + change) + legend double-click/collapse `46a27a2`
- [x] **INC-7 + INC-8 (= M4b)** tabbed settings modal + real style controls
- [x] **INC-14 (= M5)** create-alert-from-indicator — discriminated `AlertDefinition` union + shared `signal-eval.ts` + settings-modal **Alert** tab
- [x] **INC-13 (legend ⋯ menu + move-to-pane)** per-row overflow menu — Settings · Move up · Move down · Reset to defaults · **Move to ▸ New pane / Merge into <pane>** · Remove. paneId is now LIVE: `sub-pane-indicators` groups visible sub-pane indicators by `inst.paneId` into shared panes (one SVG, shared auto-scale, combined header), and "Move to" rewrites `inst.paneId` via the existing `updateIndicator` — INC-11 alignment preserved. Browser-verified: MFI + MACD merged into one pane, then splittable to New pane.
- [ ] Remaining (recommended order): INC-4 Data Window per-plot colour/names · INC-15 chart context-menu staples · INC-12 log/percent/auto scale modes · INC-5 surface Pulse/SMC/STS in Data Window · INC-2 browser fast-path · INC-10 coverage (DEMA/TEMA/VWMA) · INC-9 per-plot toggles · INC-16 pane resize · INC-17 drag-reorder/legend-drag · INC-18 interaction feel

**Phase 6 done**; **Phase 3 COMPLETE**; Phase 4 · #16–#17 done. **Active focus: the indicator-system MISSION above** (roadmap Phase 4 · #18 is deferred).

## Working agreement (for Claude loop)

- Never fabricate market data. Never fake API responses.
- **Every number must be traceable.** Any metric reported (return %, win rate, trade/test counts) must be copy-pasted from a command actually run in THIS session (Vitest, curl, browser measurement). No raw output behind it → it's fabricated; don't report it.
- Never break the live alerts or Telegram config that's already wired.
- Verify every feature with a browser screenshot before commit.
- Commit small. One feature → one commit.
- Update the **Recent log** before each commit — keep only the **newest ~5 entries** here; move older ones (verbatim) to `docs/changelog.md`.
- If blocked, append to **Questions for owner** + skip to next item.

## Session protocol (context hygiene)

Long sessions hallucinate: when the context window fills and compacts, precise state is lost and
output drifts toward plausible-looking fabrication (e.g. "best EMA results" with no command behind them).

1. **One increment per session.** Read CLAUDE.md + `docs/architecture.md` (don't re-explore the repo) → do ONE task → verify → commit → update the log → STOP. Never start a second feature in a long/compacted session.
2. **End ritual:** Recent log updated → committed → session ends. The next session reboots at full fidelity from these files.
3. **Fabrication tripwire:** if numbers appear that no command in this session produced, the context is poisoned — stop and restart the session instead of correcting in place.
4. **Keep this file lean:** log ≤ 5 entries (older → `docs/changelog.md`); structure lives in `docs/architecture.md`.

## Ops / gotchas

- **Laptop sleep drops the USB SSD → kills dev servers.** Recover: `lsof -ti tcp:4000 | xargs kill -9; lsof -ti tcp:3000 | xargs kill -9` then `pnpm -F @supercharts/api dev &; pnpm -F @supercharts/web dev &` (the tsx watcher's child holds the port; pkill alone leaves it). Code/commits are never at risk; the alert engine reloads on boot.
- **WS handler effects pin stale overlay flags** (effect dep `[symbol,interval]`) → read the flag from a live ref (the `tapeOnRef`/`domOnRef` pattern), and dedup re-delivered stream rows by id.
- **Price format ≥ 2 decimals** for ≥1000 prices so adjacent BTC levels don't collapse to one row.
- Vitest suite in `tests/` (import pure modules by relative source path); ESLint flat config (`eslint.config.mjs`).
- Feature-video assets live in `~/sc-video/` (final MP4s, Voicebox voice chunks, capture scripts) — **not** in the repo.

## Recent log

- 🎛️ **Script INPUT optimizer — MetaTrader EA-style optimization for coded strategies (8d36230).** `optimizeScript` (apps/api/src/script-optimizer.ts) sweeps a PulseScript's own `input.num` parameters: {from,step,to} per input (≤4 inputs, ≤1000 combos), re-runs the script per combination on the same real candles, backtests its marks, ranks with the SAME filters/metrics/objectives as the MA optimizer (helpers + `robustnessFlags` now exported from optimizer.ts; generic N-D ±1-step neighbour robustness; honest note + below-bar fallback). **Time-budgeted** (10s default) with a deterministic fixed-seed shuffle so truncation samples evenly — "evaluated N of M" reported, same inputs ⇒ same results. `POST /api/optimize/script` validates the script once (line-numbered 400) before sweeping. Pine dock gained an **Optimizer** tab (Console | Tester | Optimizer): Run discovers numeric inputs → sweep toggles + ranges + live combo count → objective/win-floor → ranked table → **Apply** writes values into the script inputs + re-runs on chart. Verified: 246/246 tests (6 new incl. strict determinism + truncation honesty), live 221-combo sweep 5.7s (#1 fastLen=12 slowLen=18 +27.16% robust), browser e2e 760-combo sweep with honest truncation + Apply; 0 console errors.
- 🏁 **MetaTrader-style optimizer in the Strategy Tester (87a1020).** `POST /api/optimize` — standalone sweep over the active chart (no alert needed): MetaTrader `{from,step,to}` ranges per parameter, default grid = **1,048 combinations** (fast 2–35×1, slow 5–110×3, cap 5000), each a REAL backtest of the last 1000 candles; reuses `runOptimizer` objective ranking + hard filters + robustness + realism pass-through verbatim. Strategy Tester dialog gained mode tabs **Single test | Optimizer · N combinations**: from/step/to inputs with live count, objective toggle, min-win-rate slider, ranked pass table ($ profit, win %, trades, DD, capped PF, robustness chip) and per-row **Use** (loads into Single test + plots BUY/SELL on chart). Honesty: on 1m ALL 1,048 combos fail PF≥1 and the sweep says so (accuracy objective shows the real negative returns) instead of crowning the least-bad loser. Verified live: 1h sweep 1,048 evaluated / 42ms, #1 EMA 13×17 +29.3% robust, Use plotted 214 crossovers; 236/236 tests.
- 🧪 **PulseScript Strategy Tester — code a strategy, backtest its marks (the TradingView model).** A script's `mark buy`/`mark sell` ARE the strategy: new `runSignalBacktest(candles, {index,side}[], interval, realism?)` in backtester.ts (trade walks generalized over a price source + shared summary builder; signal path ≡ MA-cross path, **pinned by exact-equivalence tests** with and without realism). New `POST /api/backtest/script` runs the user's script server-side (same sandbox: loop caps, 2s timeout) over the last 1000 real candles and trades its marks; line-numbered `script_error` 400s, `no_signals` explainer. Pine dock right column now tabs **Console | Strategy Tester** — Backtest button pushes the script to the chart (traded marks visible on real candles) and renders stat grid / equity sparkline / trade list with SL-TP exit chips / realism inputs. **Fail-loud fix in script-lang:** `input.num` with a non-numeric default (the title-first habit from other platforms) used to silently coerce to the min — live it turned EMA 9×21 into EMA 2×3 and produced a 259-trade garbage backtest; now a line-numbered RuntimeError. `docs/strategy-backtesting.md` = the full how-to. Verified: 236/236 tests (9 new incl. equivalence + footgun), typechecks clean, live API (footgun→400; correct script→39 trades +17.51% matching a local run), browser (sample backtested on 1000 real candles: 15 buy/16 sell marks, honest losing stats, marks on chart, 0 console errors). NOTE: `reserch/` is the owner's personal research — gitignored, never commit it.
- 📜 **Older entries → `docs/changelog.md`** (full history archived 2026-06-10 — nothing deleted).

## Questions for owner

(none yet)
