# Session 10 — INC-18 (remainder) · Magnet crosshair + multi-pane Data Window

> One session = this task only. Severity low · Effort M (remainder).
> NOTE: momentum pan + eased cursor-anchored wheel zoom **already shipped** (commit `b039b8c`) — verify they still pass, do NOT redo. Source-symbol indicators + left price scale stay **deferred** (XL, needs no-data honesty for unfed symbols) — out of scope here.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/10-inc18-interaction-feel.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot on /terminal), commit small, tick INC-18 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

Two remaining feel items: an opt-in **magnet crosshair** that snaps to the hovered bar's OHLC, and letting a **hovered non-active pane publish the Data Window** snapshot.

## What already exists (extend, don't rebuild)

- `layers/tooltip.ts` has `findCandleAt` logic buried inside it.
- The Data Window publish path is gated to the active pane (single-writer by design).
- The smooth auto-fit + momentum/eased-zoom machinery in ChartCore's rAF loop — don't disturb it.

## Spec (from `.audit/tv-parity/PUNCHLIST.md` § INC-18, remainder)

1. Factor `findCandleAt` out of `tooltip.ts` into a shared chart-core helper (tooltip keeps using it — zero behaviour change there).
2. **Magnet crosshair (opt-in)**: a crosshair mode that snaps the horizontal line/price label to the nearest of the hovered bar's O/H/L/C. Toggle lives with the crosshair/cursor settings (store flag, default off). Snapping must not affect drawing-tool coordinates unless magnet is on.
3. **Multi-pane Data Window**: relax only the active-pane guard so the pane under the cursor publishes the snapshot; keep single-writer (exactly one publisher at a time — hovered pane wins, falls back to active).
4. Re-verify momentum pan + eased zoom still behave (regression only).

## Files

`packages/chart-core/src/layers/tooltip.ts` · `layers/crosshair.ts` · `chart-core.ts` · `apps/web/features/terminal/chart-pane.tsx` · `right-rail.tsx` · `terminal-store.ts`

## Verify before commit

- Unit tests: `findCandleAt` extraction (same results as before on a fixture), snap-target picker (cursor price → nearest OHLC). Report count.
- `pnpm typecheck` clean (chart-core + web).
- Browser on /terminal, 4-pane grid: magnet on → crosshair sticks to OHLC of the hovered bar; magnet off → free; hover pane B (active = A) → Data tab shows B's symbol values, mouse-leave reverts to A; pan fling + wheel zoom unchanged. Screenshot magnet-on.

## Done means

- [ ] Magnet + hovered-pane Data Window working, single-writer kept  ·  [ ] tests green  ·  [ ] INC-18 ticked (note deferred source-symbol) + Recent log + one commit
