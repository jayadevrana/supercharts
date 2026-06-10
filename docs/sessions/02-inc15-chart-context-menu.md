# Session 02 — INC-15 · Chart context-menu staples + cursor affordances

> One session = this task only. Severity high · Effort M. Builds on INC-14 (done) for add-alert-at-price.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/02-inc15-chart-context-menu.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot on /terminal), commit small, tick INC-15 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

Bring the right-click body menu and cursor up to TradingView staples: Copy price, Add indicator, Add alert at price, Reset chart — plus proper canvas cursors.

## What already exists (extend, don't rebuild)

- A `ChartContextMenu` with `MenuItem`/`MenuSeparator` primitives (used by the legend ⋯ menu, INC-13).
- `chart-pane.tsx` already computes price/time under the pointer (then throws them away).
- INC-14 alert-creation UI (settings-modal Alert tab) — open it **prefilled**, never auto-create an alert.
- INC-6 symbol status line already shows OHLC (which is why the cursor-tracking tooltip can default off).

## Spec (from `.audit/tv-parity/PUNCHLIST.md` § INC-15)

1. In `chart-pane.tsx` store `{x, y, price, time}` at context-menu open.
2. Extend the chart-body context menu with: **Copy price** (clipboard), **Add indicator…** (opens the indicators dialog), **Reset chart** (reuse `onResetZoom`), **Add alert at price…** (opens the INC-14 creation UI prefilled with the clicked price level — never auto-creates).
3. Default the cursor-tracking `TooltipLayer` off (or gate behind a per-pane flag) now that the status line shows OHLC; keep the candle-column highlight by moving it to `CrosshairLayer`.
4. Set the canvas cursor from the pointer handlers: `crosshair` (idle), `grab`/`grabbing` (pan), `ns-resize` (price-axis drag), `ew-resize` (time-axis drag).

## Files

`apps/web/features/terminal/chart-pane.tsx` · `packages/chart-core/src/chart-core.ts` · `layers/tooltip.ts` · `layers/crosshair.ts` · `indicator-legend.tsx` · `indicator-legend-util.ts`

## Verify before commit

- Unit tests for any pure helper extracted (e.g. menu-model builder).
- `pnpm typecheck` clean (chart-core + web).
- Browser on /terminal: right-click → all four entries work (copy puts the real price in clipboard; alert dialog opens prefilled at the clicked level; reset refits); cursors change across idle/pan/axis-drag. Screenshot the open menu.
- The 48+ live alerts: count unchanged after the session; "Add alert at price" was only ever opened, not submitted.

## Done means

- [ ] Menu + cursors working in browser  ·  [ ] tests green  ·  [ ] INC-15 ticked + Recent log + one commit
