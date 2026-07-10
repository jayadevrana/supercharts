# Terminal production rebuild — master plan

> Companion to `docs/terminal-production-rebuild-prompt.md` (the spec) and
> `.audit/terminal-rebuild/PHASE0-BASELINE.md` (audited baseline, 2026-07-10).
> One vertical slice per session (CLAUDE.md protocol). Detailed per-slice task plans live in
> `docs/superpowers/plans/`.

## Baseline (evidence in PHASE0-BASELINE.md)

380/380 tests green · typecheck clean 9/9 projects · 0 console errors on `/terminal` load ·
live Binance/Yahoo feeds · most of the 2026-06 parity punchlist already landed (INC-1..15).
The terminal is NOT a rebuild candidate — it is a hardening/completion candidate. The spec's
"no dead controls / production architecture" bar is reachable by slices, not a rewrite.

## Before/after workspace map

| Zone | Today | Target |
| --- | --- | --- |
| Top bar | TV-style, 1 dead control (Settings cog), partial layout-restore | all controls live; Settings = real workspace settings; layout restore includes pane symbols/intervals |
| Left rail | 13 wired draw tools + 3 dead meta tools + dead ⋯ (dead ones silently break panning) | meta tools = real magnet/lock/hide toggles; ⋯ = real menu; full aria |
| Chart | strong (scale modes, context menus, auto-fit, countdown) | + crosshair/cursor mode distinction, magnet snap, rAF-batched ticks |
| Right rail | 7 tabs, honest data, some silent-error/infinite-spinner states | shared panel primitives: every tab has loading/empty/error+retry |
| Bottom dock | PulseScript editor + tester + optimizer (wired) | + double-submit guards, error surfacing on delete |
| Persistence | manual named layouts only; refresh loses workspace | versioned autosaved workspace + migration-aware models |
| API/WS | single-user stub auth; MT5 events broadcast unscoped | per-socket identity, MT5 ownership filter, secure headers, readiness |

## State ownership (documented target)

- **Imperative chart runtime** (no React on hot paths): ChartCore + layers + DrawingController;
  ticks/crosshair/pointer stay in refs + rAF-coalesced core calls.
- **Shared client state (Zustand)**: layout/panes (structural), UI chrome (rails/dock/tabs),
  ephemeral one-shot requests (dialogRequest pattern). Split into slices when touched — no new
  fields on the God store for hot data.
- **Server-persisted**: named layouts, drawings, alerts, scripts, indicator layouts, watchlists
  (+ planned: autosaved workspace snapshot, versioned).
- **localStorage**: cosmetic prefs only (favorites, interval pills, account-size draft).

## Slice sequence (spec priority: inert → blockers → consistency → parity)

- **S1 — Dead-control sweep (chrome)**: fix D1–D7/P1–P2 from the baseline audit + aria on
  touched controls. Plan: `docs/superpowers/plans/2026-07-10-slice1-dead-controls.md`.
- **S2 — Async-state consistency**: shared `PanelState` primitives (loading/empty/error+retry);
  fix P5–P9 (infinite spinners, silent errors, double-submit gaps).
- **S3 — Workspace persistence**: versioned workspace autosave/restore (debounced, migration-aware),
  full layout restore (P3), save/offline indicator.
- **S4 — WS + API client hardening (web)**: typed ApiError, AbortController adoption, WS
  sequence/gap guard, overlay-set-preserving resubscribe (F4/F5).
- **S5 — MT5 scoping + API hardening**: per-socket userId from session, MT5 ownership filter
  (S1/S2 findings), helmet, readiness, correlation IDs, PATCH validation (S4–S6).
- **S6 — Chart runtime boundary**: rAF tick batching, hot state out of React (F1), begin
  chart-pane decomposition (F7) — extract `useMarketFeed` + overlay modules.
- **S7 — Store slicing + token adoption**: split God store along documented ownership (F2),
  canvas token map + z-index tokens (F6).
- **S8+ — Parity tail**: INC-2/4/5/9/10/16/17/18 from the punchlist, then a11y/e2e/visual
  regression harness (spec §8) and perf budgets.

Each slice: typecheck touched packages → focused Vitest → live-browser verification via Chrome
MCP → screenshot → control inventory + docs updated → one commit. Live alerts/Telegram config is
never touched; UI testing never mutates alert or trading data.

## Non-negotiables carried from the spec

Original SuperCharts product (no TV assets/copy) · chart-core stays ours · indicator math stays
in `@supercharts/indicators` · PulseScript stays original · never fabricate market data · honest
provider-limited states · backwards-compatible persisted models (versioned migrations).
