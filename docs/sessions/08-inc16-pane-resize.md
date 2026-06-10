# Session 08 — INC-16 · Sub-pane resize separators + maximize/collapse

> One session = this task only. Severity high · Effort L.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/08-inc16-pane-resize.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot on /terminal), commit small, tick INC-16 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

Oscillator sub-panes become resizable by dragging a separator, with maximize/collapse buttons in each pane header — TradingView pane ergonomics.

## What already exists (extend, don't rebuild)

- `sub-pane-indicators.tsx` groups visible sub-pane indicators by `inst.paneId` into shared SVG panes (INC-13) with a fixed `HEIGHT` (~80px) per pane.
- `classicIndicators[]` persistence — `paneHeight` rides it for free.
- INC-11 time-axis alignment between sub-panes and the main chart — must be preserved through any height change.

## Spec (from `.audit/tv-parity/PUNCHLIST.md` § INC-16)

1. Optional `paneHeight?` / `collapsed?` / `maximized?` on `IndicatorInstance` (types).
2. A ~4px drag handle above each `SubPaneRow` → `updateIndicator({paneHeight})`, clamped (e.g. 48–400px); double-click resets to default; Arrow-key adjustment as the keyboard fallback.
3. Use `inst.paneHeight ?? 80` for the pane HEIGHT/svg viewBox.
4. Header buttons: **collapse** (header-only strip) and **maximize** (full height, hide sibling sub-panes while active).
5. The price-chart-vs-sub-panes boundary (flexing the chart container itself) is the heavier stretch — only attempt if the core lands early; otherwise note it in the log as deferred.

## Files

`apps/web/features/terminal/sub-pane-indicators.tsx` · `chart-pane.tsx` · `terminal-store.ts` · `packages/types/src/chart.ts` · (`packages/chart-core/src/viewport.ts` only if the stretch is attempted)

## Verify before commit

- Unit tests for the pure clamp/reset logic; report count.
- `pnpm typecheck` clean (types + web).
- Browser on /terminal: add RSI + MACD → drag the RSI handle: pane grows/shrinks live and crosshair/time alignment with the main chart stays exact (INC-11 regression check); collapse → header strip only; maximize → fills, siblings hidden, un-maximize restores; reload → heights persisted. Screenshot before/after a resize.

## Done means

- [ ] Resize + collapse + maximize working, INC-11 alignment intact  ·  [ ] tests green  ·  [ ] INC-16 ticked + Recent log + one commit
