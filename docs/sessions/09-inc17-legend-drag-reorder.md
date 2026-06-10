# Session 09 — INC-17 (remainder) · Legend drag-reorder + precise drop targeting

> One session = this task only. Severity medium · Effort M.
> NOTE: the dialog→chart **drag-to-add half of INC-17 already shipped as M6** — do NOT redo it. This session is the remainder.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/09-inc17-legend-drag-reorder.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot on /terminal), commit small, tick INC-17 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

Drag legend rows to reorder indicators, and make drops pane-aware (drop an oscillator onto an existing sub-pane to merge, or below to create a new pane) — on top of the now-live `paneId` (INC-13).

## What already exists (extend, don't rebuild)

- M6: dialog rows are `draggable` with `application/x-sc-indicator` payload; chart-pane resolves drops via exported `ENTRY_INDEX` + `buildInstance`; "Drop to add" overlay hint.
- `reorderIndicator` store action + up/down chevrons (keep them — they're the keyboard fallback).
- INC-13 made `inst.paneId` live state (`updateIndicator` rewrites it; sub-panes group by it).

## Spec (from `.audit/tv-parity/PUNCHLIST.md` § INC-17, minus the shipped half)

1. Legend rows become draggable; drag-over shows an insertion line; drop reorders via the existing `reorderIndicator`.
2. Add a `moveIndicatorTo(id, index)` store action for precise drops (chevrons keep using the relative version).
3. Pane-aware drop targeting for sub-pane indicators: dropping onto an existing sub-pane sets that `paneId` (merge); dropping on the "new pane" zone assigns a fresh `paneId` — reuse the INC-13 move-to logic, don't fork it.
4. Keep click/Enter toggle and chevrons fully working (keyboard accessibility unchanged).

## Files

`apps/web/features/terminal/indicator-legend.tsx` · `chart-pane.tsx` · `sub-pane-indicators.tsx` · `terminal-store.ts`

## Verify before commit

- Unit tests: `moveIndicatorTo` (bounds, no-op same-index, id-keyed) — extend `indicator-manager-util` tests; report count.
- `pnpm typecheck` clean.
- Browser on /terminal: 3 EMAs + RSI + MACD → drag EMA 3 above EMA 1 in the legend → legend + Ind panel + draw order all track; drag MFI onto the MACD pane → merged (one pane, INC-13 style); drag it to the new-pane zone → splits; chevrons still work. Screenshot mid-drag with the insertion line.

## Done means

- [ ] Legend DnD + pane-aware drops working, keyboard fallback intact  ·  [ ] tests green  ·  [ ] INC-17 ticked + Recent log + one commit
