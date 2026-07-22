# SuperCharts — Master Prompt

> Institutional-grade browser charting terminal for crypto & forex traders.
> Live tick data, multi-window grid, drawing tools, advanced indicators (SMC / footprint /
> heatmap / order flow), MA-crossover alerts (Telegram + web), MT5 automation bridge,
> Stripe-ready billing. Pricing: $400 / 6mo, $600 / 12mo.

Repo: `/Volumes/PortableSSD/new start/supercharts` (pnpm monorepo).

> **🤝 Multi-agent handoff:** live progress track = **`docs/STATUS.md`** — read it FIRST before
> touching code (what's done with commit hashes, what's in progress, hard rules, landmines).
> Master goal + ordered backlog = `docs/LAUNCH-PLAN.md`. Update BOTH in the same commit as work.

Codebase map: `docs/architecture.md` · Full build history: `docs/changelog.md` · Per-task session prompts: `docs/sessions/`.

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
Telegram bot and chat are configured locally (values intentionally redacted for public source).

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

### Phase 6 — PulseScript language & code terminal  ← COMPLETE (1–8 done; PARITY WAVE 9–13 done 2026-06-12)
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
- [x] 9–13. **Pine-parity wave (2026-06-12, commits `77ffecc`→`ef6d1fd`)** — language core (ternary/while/break/continue/lists+methods/text methods/records/date-time+bar-context built-ins), 40+ new `ta.*` incl. multi-output records (bands/channel/donchian/dmi/supertrend/ichimoku/aroon/macdFull/stochFull) + full `math.*`, visual outputs (area/steps/dots/hist styles, `draw level`, 9-shape `draw marker`, `paint bg` ShadeLayer behind candles, `paint candles`, `alert()` capture), `input.select`/`input.color`, and `onTf(tf, expr)` multi-timeframe with strict no-repaint completed-bar mapping. Reference: `docs/pulsescript-language.md` · honest gap audit: `docs/pulsescript-parity.md` (next: match/destructuring, sub-pane plots, drawing-object API, `trade.*`, alert-engine bridge).

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
- [x] **INC-15** chart context-menu staples (Copy price · Add indicator… · Create alert… via store `requestDialog` · Reset · hover-panel toggle) + cursor affordances + fixed status line is the OHLC surface (floating panel opt-in)
- [x] **INC-12** price-scale modes — log decade ticks + ratio-space pan/zoom, percent axis re-baselined to the first visible close, shared `priceTickValues`, ChartCore scale API + `onScaleState`, per-pane `scaleMode`, price-axis context menu + footer `% log auto` toggles. **Chart-area extras the same pass:** volume-band collapse bug fix, thousands separators + adaptive gutter + denser ticks, dated crosshair tag, live bar-close countdown, range-preset footer (1D…All) + UTC clock, venue tag, watermark.
- [ ] Remaining (recommended order): INC-4 Data Window per-plot colour/names · INC-5 surface Pulse/SMC/STS in Data Window · INC-2 browser fast-path · INC-10 coverage (DEMA/TEMA/VWMA) · INC-9 per-plot toggles · INC-16 pane resize · INC-17 drag-reorder/legend-drag · INC-18 interaction feel (magnet crosshair, multi-pane Data Window remain)

**Phase 6 done**; **Phase 3 COMPLETE**; Phase 4 · #16–#17 done.

### 🚀 LAUNCH MISSION (ACTIVE — supersedes all other ordering)
**Goal: launch SuperCharts publicly as the TradingView alternative for algo crypto/forex traders.**
The master plan — north star, positioning, pricing decision, launch definition, 25-session ordered
backlog (Phase A launch surface: scanner → PulseScript public docs → indicators; B multi-user
foundation; C revenue; D hosting; E beta → launch), GTM, kill list, risks — lives in
**`docs/LAUNCH-PLAN.md`**. Work the backlog top to bottom, one item per session, tick the box
there. Design specs: `.audit/launch/*.json`. The indicator-system mission above and rebuild
slices are FOLDED INTO that backlog — don't work them out of order.

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

1. **One increment per session.** Read CLAUDE.md + `docs/architecture.md` (don't re-explore the repo) → do ONE task → verify → commit → update the log → STOP. Never start a second feature in a long/compacted session. Every remaining work item has a prompt file in `docs/sessions/` (see `00-README.md` for order) — start each session from the next file's kickoff prompt.
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

- 🔐 **AUTH — forgot/reset password flow shipped (owner: "why no reset password on the site").** The live auth only had in-account change-password (needs current pw + a session); a user who FORGOT their password had no recovery. Added the standard email-link reset. Pure DB-only core `apps/api/src/auth-reset.ts`: `issuePasswordReset` (base64url token, stores only its **SHA-256 hash** + 30-min expiry, one active reset/user replaced on re-request) + `consumePasswordReset` (validates, **single-use burns**, cleans expired). New `password_resets` table. Two routes: `POST /api/auth/forgot-password` (**always 200** — no account enumeration; emails a link only if the account exists) + `POST /api/auth/reset-password` (valid token → new password + **kills all sessions** = logs out every device). `email.ts` gained `sendPasswordResetEmail` (Resend, reuses the self-protecting `emailConfigured`/`EMAIL_DEV_LOG` gate). Web: `/forgot-password`, `/reset-password?token=…`, and a "Forgot password?" link on `/login`. Additive — login/register/verify/Google/change-password + the live 48/144 alert engine all untouched. Real emails still need `RESEND_API_KEY` on the VM (same gate as verification) — flow is code-complete, key-wiring is a separate owner call. **772/772** (+11 `tests/auth-reset.test.ts`: hash-not-raw stored · single-use · unknown/expired rejected+cleaned · re-issue invalidates old · forgot no-enumeration (unknown→200/0 tokens, known case-insensitive→1) · reset changes pw + kills sessions + burned-token 400 leaves pw unchanged + short-pw 400). api+web typecheck clean; local prod build clean (both pages prerender static). Browser on :3000 (after the documented stale-HMR `.next` clear + dev restart — brand-new routes hadn't hydrated): reset page hydrates token→form, forgot renders, login link present, 0 console errors. Deployed to **`supercharts3`** (web rebuild + `pm2 restart supercharts-web` ONLY — API/alert engine untouched; no `RESEND_API_KEY` set yet so no live mail).
- 📡 **/docs/screener shipped — "Code a market screener" PulseScript guide (owner ask: docs for coding multi-symbol screeners).** Pure content module `apps/web/features/docs/screener-guide.ts` (4 runnable example screens — RSI snap-back, uptrend volume surge via bare `alert()`, fresh 20-bar breakout, MACD momentum turn — plus match rules, 5 scan steps, honest status table, documented limits) rendered by `app/docs/screener/page.tsx`; wired into the docs sidebar (Guides), sitemap, and a hub card (Radar icon). **Drift-guarded against the REAL scan engine:** `tests/docs-screener.test.ts` runs every displayed script through `runScriptScan` (all rows `ok` over a 3-symbol universe) and behaviorally pins every documented claim — breakout ON the newest closed bar matches / historical-only doesn't / the still-forming bar is trimmed (no repaint); a bare `alert()` matches; 59 closed bars → `insufficient_data` vs 60 → evaluated; empty → `unavailable`; runtime errors isolate per symbol (only the close>1000 symbol errors, the other stays ok); a runaway `while` is sandbox-aborted (test ran 501ms ≈ the documented 500ms budget); documented statuses == the full `ScanRowStatus` union. Language gotcha the tests caught: colon-form `when` bodies must be same-line — multi-line bodies need braces. 14 new tests → suite **761/761** (first cold run showed the 1 documented perf flake; two subsequent full runs clean); web typecheck clean; **prod build clean** (`/docs/screener` prerendered static). Browser-verified on :3000 (full render + sidebar active, 0 console errors; sitemap.xml carries the URL). Deployed to **`supercharts3`** (web rebuild + `pm2 restart supercharts-web` ONLY — docs-only web change, API/alert engine untouched).
- 🔐 **AUTH shipped — Google OAuth + email/password, terminal gated (Phase 5 #20) + SuperCharts went LIVE at https://supercharting.com.** Chose a **Fastify-native** design (not Auth.js — the app proxies every `/api/*` to Fastify): new `routes/auth.ts` (`/api/auth/google/start`+`/callback`, `register`, `login`, `logout`, `me`) on the pre-existing `sessions` table + an httpOnly `sc_session` cookie; **zero new deps** — scrypt hashing via `node:crypto`, Google via global `fetch`. Added an `accounts` OAuth-link table + per-user `seedUserWorkspace` (namespaced `wl_<uid>` ids). The one seam that flips the app multi-user: `getUser` resolves the cookie (`AUTH_ENABLED=0` → legacy `demo` fallback so local/single-user is unchanged), and the WS gateway lifts the session off the upgrade req (anonymous sockets still get public market data, no per-user fanout). Web: `SessionProvider` in the root layout, wired `/login`+`/signup` (Google button hidden until `googleEnabled`), header account menu + Sign out, `middleware.ts` gates `/terminal` + client guard for expired cookies. **Verified:** api+web typecheck clean; suite **564/564** (5 new scrypt tests); curl register→me→**200** protected, anon→**401**, wrong-pw→**401**, dup→**409**, new user auto-seeded `wl_u_*` (10 syms); browser — `/terminal`→`/login` when logged out, UI sign-in→live terminal (0 console errors), header showed account + Sign out. Google login structurally complete but needs the OAuth **client + `GOOGLE_CLIENT_ID/SECRET`** in the VM `.env` to run end-to-end. Live 48/144 alerts untouched (engine loads from DB independent of `getUser`). **Deploy this session:** deleted the mining-flagged GCP VM → clean **e2-standard-2** (Ubuntu 24.04, Mumbai, reused IP 35.200.208.191), firewall hardened to 80/443, LE TLS, pm2 reboot-persist — all via `infra/deploy/vm-bootstrap.sh`. **Next: create the Google OAuth client, then deploy auth** (push + set env + rebuild); decide gate-now vs wait-for-Google.
- 🔎 **SCAN-2 shipped — the Scanner tab is a real screener (commit `dac7efe`) + `docs/STATUS.md` multi-agent handoff (`3f446d6`).** New `scanner-tab.tsx` (extracted from right-rail): mode chips (legacy Movers + All-metrics + the 6 server presets), 15m/1h/4h/1d pills, sortable columns via pure tested `scanner-tab-util.ts` (nulls last both directions), click-row→open symbol on the active pane, 30s auto + manual refresh, error+Retry, honest footer counts. Browser-verified on live data: Volume-surge preset rendered EXACTLY the API's 7 matches (all RVOL>2, curl cross-check), sort asc/desc correct, row click loaded BTCUSDT, Overbought showed the honest '42 scanned · 0 matched' state; 0 console errors. Suite **429/429** (now incl. the owner's separately-landed Kite provider tests). **Note: git history was rewritten between sessions (public-repo prep)** — older hashes in logs don't resolve; content intact. `docs/STATUS.md` is now the live what's-done/what's-next track any agent (incl. Codex) must read first — pointer added to CLAUDE.md/AGENTS.md heads. **Next: SCAN-3** (custom screen builder + per-user saved screens; server side mostly exists via POST /api/scanner/scan `screen`).
- 🚀 **LAUNCH MISSION set + SCAN-1 shipped (commits `8508123` `3868ebb`).** Owner call: launch SuperCharts publicly as the TradingView alternative. 5-workstream analysis (competitor/pricing research w/ live TV pricing cites, launch roadmap, scanner+docs technical designs, GTM) synthesized into **`docs/LAUNCH-PLAN.md`** — north star (chart→script→backtest→alert→Telegram→MT5 in one stack vs the ~$1-1.5k/yr TV+PineConnector+VPS pile), pricing recommendation ($600/12mo flagship, cut the 6-mo tier to ~$349, 14-day trial + founding-member 50% capped at 30), concrete launch definition, and a 25-session ordered backlog (A: scanner→public PulseScript docs→indicators · B: auth/WS-scoping/workspace · C: Stripe · D: VPS/backups/load-smoke · E: beta→launch) + kill list. CLAUDE.md + docs/sessions/00-README now point at it; designs archived in `.audit/launch/`. **Backlog #1 SCAN-1 shipped the same session:** pure `runScan` (metrics: close/chg%/vol/RSI/EMA-dist/ATR%/RVOL via computeIndicatorChannel; matching via the shared signal-eval on the last CLOSED bar) + 6 presets as pure SignalCondition data + `ensureBarsMany` backfill (alert-engine pattern, engine untouched) + `POST /api/scanner/scan` (zod, TTL+coalescing). 8 tests → suite **414/414**. Live: 1h oversold across 48 symbols → 42 ok / 6 insufficient_data (honest) / 1 match (CHF_JPY); BTC RSI cross-checked independently — 72.185 both paths. 144 live alerts untouched. **Next: SCAN-2** (screener UI in the Scanner tab).
- 📜 **Older entries → `docs/changelog.md`** (full history archived 2026-06-10 — nothing deleted).

## Questions for owner

(none yet)
