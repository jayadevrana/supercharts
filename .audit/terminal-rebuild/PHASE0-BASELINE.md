# Terminal production rebuild — Phase 0 baseline (2026-07-10)

Spec: `docs/terminal-production-rebuild-prompt.md`. Scope: `/terminal` workspace only.
Every number below is from a command run in this session.

## 1. Baseline evidence

| Check | Result | Command |
| --- | --- | --- |
| Typecheck | clean, 9/9 workspace projects | `pnpm typecheck` (exit 0) |
| Test suite | **48 files / 380 tests, all pass** in 1.99s | `pnpm test` (exit 0) |
| Web boot | `/terminal` HTTP 200 | curl 127.0.0.1:3000 |
| API health | `ok:true`; providers binance/mock/yahoo `connected`; mt5BridgePort 7878 | curl 127.0.0.1:4000/api/health |
| Console errors on fresh `/terminal` load | **0** | Chrome MCP, fresh reload |
| Live render | BTC/USDT 1m candles streaming, bid/ask chips ticking, countdown live | screenshot ss_9105m6xx5 |

Dynamic right-rail spot-checks (browser): **Indicators** tab → real empty state + Add · **Data Window** → live OHLCV/change/H-L/volume · **Scanner** → live Binance 24h top movers · **News** → honest empty state ("No live news… GDELT and CryptoPanic adapters", last-checked stamp, Refresh). Right-rail tabs today: Trade · Indicators · Data Window · Watchlist · News · Scanner · Layers.

## 2. Punchlist reconciliation (`.audit/tv-parity/PUNCHLIST.md` vs source)

Landed since the 2026-06-06 audit (verified in CLAUDE.md log + source): INC-1 (alias search), INC-3 (manager rows), INC-6 (status line + legend QoL), INC-7/8 (tabbed settings modal + style controls = M4b), INC-11 (sub-pane shared time axis — the old blocker), INC-12 (scale modes + axis menu + footer), INC-13 (legend ⋯ menu + move-to-pane), INC-14 (create-alert-from-indicator = M5), INC-15 (context menus + cursors), plus M1–M6, smooth auto-fit, TV-style top bar redesign.

**Still open:** INC-2 (browser fast-path), INC-4 (Data Window per-plot colour/names), INC-5 (Pulse/SMC/STS in Data Window), INC-9 (per-plot toggles), INC-10 (DEMA/TEMA/VWMA coverage), INC-16 (pane resize/maximize/collapse), INC-17 (drag-reorder legend), INC-18 (interaction feel).

## 3. Control inventory — UI chrome (audited this session)

Verdicts: WIRED = end-to-end real · PARTIAL = incomplete/mislabeled · DEAD = no-op · UNAVAIL-OK = disabled with reason.

> **Slice 1 status (2026-07-10, commits `f79dcfb`…`0bbbaad`):** D1–D7 and P1–P2 below are
> **FIXED and verified** (396/396 tests; browser evidence in the session log). The same pass
> surfaced and fixed two latent data-loss bugs: (a) client/server drawing-id mismatch — the
> POST assigns a new nanoid the client never adopted, so same-session PUT/DELETE 404'd; and
> (b) `lib/api.ts` sent a JSON content-type on body-less DELETEs → Fastify 400 → **every UI
> drawing delete silently failed**. P3–P9 remain for slices S2/S3.

### DEAD controls (fix first — spec §5 no-dead-control contract)

| # | Control | Location | Defect |
| --- | --- | --- | --- |
| D1 | Settings (cog) | `terminal-top-bar.tsx:578` | No onClick at all; has aria-label, no tooltip |
| D2 | Magnet tool | `left-rail.tsx:38` | Not handled by drawing-controller; **silently disables panning** while selected |
| D3 | Lock all | `left-rail.tsx:39` | Unwired anywhere; breaks pan while selected |
| D4 | Hide all | `left-rail.tsx:40` | Unwired; breaks pan while selected |
| D5 | Overflow ⋯ | `left-rail.tsx:71` | No onClick, no aria-label, no tooltip |

### PARTIAL controls

| # | Control | Location | Defect |
| --- | --- | --- | --- |
| P1 | Replay step back/forward "1 bar" | `replay-bar.tsx:85,115` | `stepRef` hardcoded 60_000ms — steps 1 minute on every interval; mislabeled on non-1m charts |
| P2 | Crosshair tool | `left-rail.tsx` | Cosmetic only — no behavior distinct from Cursor |
| P3 | Saved layout "Apply grid" | `terminal-top-bar.tsx:547` | Restores grid only; saved pane symbols/intervals never re-applied (label is honest) |
| P4 | `demo · read-only` badge | `terminal-top-bar.tsx:582` | Claims "changes are disabled" but nothing is gated client-side (server demo-guard only) |

### DEAD / stale (panels + dialogs sweep)

| # | Finding | Location |
| --- | --- | --- |
| D6 | `signal-builder-dialog.tsx` (627 lines) orphaned — never imported anywhere; superseded by strategy-builder | `features/terminal/signal-builder-dialog.tsx` |
| D7 | `code-terminal-dialog.tsx` referenced in `docs/architecture.md` but does not exist (PulseScript editor is `pulse-editor-panel.tsx`) | docs staleness |

### PARTIAL (panels + dialogs sweep)

| # | Control | Defect |
| --- | --- | --- |
| P5 | Alerts Active list / Strategy ActiveList / Watchlists manager | load failure → toast only, list stays `null` → **permanent spinner**, no inline error/retry |
| P6 | Scanner + Watchlist quotes | fetch error swallowed → blank body / skeleton forever, no error state |
| P7 | PulseScript Save | no in-flight disable → double-POST possible; Delete swallows errors silently |
| P8 | MT5 "Generate new token" | no in-flight disable (double-request) |
| P9 | Webhooks forward toggle | optimistic without error toast (does self-revert) |

Dialogs otherwise strongly wired: async guards + input-preserve + human errors near-universal; **no fabricated data found anywhere**; DOM ladder / Time & Sales / Open Interest / order-flow rows all honestly "Binance crypto only" or "No futures market". Order submit shows real server state.

### A11y gaps (chrome)

- ~17 unlabeled buttons in the live accessibility tree (left-rail drawing tools have Tooltip but **no aria-label**, no `aria-pressed`).
- Missing `aria-pressed`: interval pills, Sync crosshair, Script toggle, left-rail tools.
- Replay/Live top-bar toggle: no title, no aria-label.

### WIRED highlights (preserve, don't touch)

Symbol search (curated+remote), chart-type select (22 types), interval pills + favorites (localStorage), snapshot download (real blob, honest fallback), fullscreen (honest fallback), Save layout (server-confirmed toast, ⌘S), layouts history (loading/error/retry states), sync crosshair, layout picker (cleanest file — full aria), chart footer presets/%/log/auto (aria-pressed everywhere), replay play/slider/speeds, 13 drawing tools end-to-end, WS status badge.

## 4. Security / hardening findings (apps/api)

| # | Finding | Where | Severity |
| --- | --- | --- | --- |
| S1 | **MT5 WS cross-user leak**: `subscribe_mt5` attaches an unfiltered listener to the global `mt5Store` emitter — every socket gets every user's `account_snapshot`/`positions`/`tick`/`order_result`/`log` | `ws-gateway.ts:112-122`; emit sites `mt5/state.ts:103-255` | critical (pre-multi-user blocker) |
| S2 | WS upgrade unauthenticated; `req` discarded, `userId:'demo'` hardcoded per socket | `ws-gateway.ts:68,73` | critical (same blocker) |
| S3 | Auth is a stub — `getUser` ignores request, always returns demo row; IDOR guards exist in shape but unexercised | `auth.ts:14-22` | blocker for multi-user |
| S4 | No secure headers (no @fastify/helmet), no readiness/liveness split, no correlation IDs, single flat rate-limit bucket, no CSRF | `main.ts` | high |
| S5 | `PATCH /mt5/positions/:id` body (SL/TP) unvalidated → reaches EA | `routes/mt5.ts:254` | high (trading path) |
| S6 | `calendar.ts:25` uses `.parse()` → 500 instead of 400; `signals.ts:50` `conditions: z.unknown()` passthrough | routes | medium |

Alert-event WS path **is** structurally user-scoped (`ws-gateway.ts:163`, engine passes `alert.userId`) — collapses today only because every socket is 'demo'. MT5 path has no hook at all.

## 5. Frontend architecture findings (apps/web)

Top file sizes: `alerts-dialog.tsx` 3567 · `chart-pane.tsx` 2289 (28 useEffects) · `strategy-builder-dialog.tsx` 1234 · `right-rail.tsx` 1041 · `pulse-editor-panel.tsx` 920.

| # | Finding | Impact |
| --- | --- | --- |
| F1 | Per-tick full re-render: every `candle_update` bumps `setCandleTick`/`setLast` component state → whole 2289-line ChartPane re-renders per tick; crosshair move writes store `crosshairTime` when sync on; **no rAF batching anywhere** | top perf liability, ×N panes |
| F2 | God store: single Zustand store, ~22 fields + ~38 actions; deep `PaneState` (13 overlay flags, 11 smc, 21 stsSettings) recloned via `panes.map` spread on every toggle | broad re-renders, unmaintainable |
| F3 | Entire working set ephemeral — no persist middleware; refresh loses layout/indicators/pulse unless manually saved to `/layouts` | workflow blocker |
| F4 | WS client (`lib/ws-client.ts`): good backoff/heartbeat/resubscribe, but **no sequence/gap protection**, and reconnect re-subscribes a hardcoded overlay set (footprint drops silently until effect re-runs) | correctness under reconnect |
| F5 | `lib/api.ts` shared client exists (13 files; only 5 raw fetches left) but errors are stringly-typed, no cancellation (one AbortController in whole feature), no dedupe | error UX, races |
| F6 | Design tokens real (42 CSS vars + Tailwind mapping) BUT 49 hardcoded hex in canvas/SVG paths (chart-pane 25, drawing-controller 10) and 18 raw z-index literals | theme drift, stacking bugs |
| F7 | ChartPane owns ~everything: WS fan-in (8 msg types), candles/renko rebuilds, heatmap/footprint/tape/DOM buffers, indicators, PulseScript, drawings, menus, DnD, replay | monolith; cleanup is solid though |

## 6. Prioritized gap list (spec order: inert → workflow blockers → consistency → parity)

1. **Dead/inert controls** — D1–D7, P1–P2, P5–P8 (+ a11y labels on the same controls).
2. **Workflow blockers** — F3 (workspace lost on refresh), P3 (layout restore drops symbols), F4 (overlay drop on reconnect), S1/S2 (MT5 scoping before any multi-user exposure).
3. **Visual/structural consistency** — F1/F2 splits (chart-runtime boundary, store slices), F6 token adoption in canvas code, right-rail panel primitives, F5 typed API errors.
4. **Advanced parity** — remaining INC-2/4/5/9/10/16/17/18 from the punchlist.

## 7. Session verification protocol

Per slice: typecheck touched packages → focused Vitest → browser flow on live `/terminal` (Chrome MCP) → screenshot → control-inventory row updated → small commit. Live alerts/Telegram config untouched at all times — verified by never calling alert/telegram mutation routes during testing.
