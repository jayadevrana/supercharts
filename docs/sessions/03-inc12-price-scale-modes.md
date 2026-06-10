# Session 03 — INC-12 · Price-scale modes + axis context menu (log / percent / auto / invert)

> One session = this task only. Severity high · Effort XL — if it runs long, land log mode + menu first and tick partially in the log.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/03-inc12-price-scale-modes.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot on /terminal), commit small, tick INC-12 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

Make the declared-but-inert scale modes reachable and correct: Log, Percent, Regular, Auto, Invert — switched from a right-click menu on the price axis, persisted per pane.

## What already exists (extend, don't rebuild)

- `scale.ts` declares modes but nothing branches on them.
- The smooth auto-fit state machine (`price-fit.ts` + `priceAutoFit` in ChartCore) — `setAutoFit` must reuse its eased re-fit, and mode switches must re-arm it cleanly.
- `MenuItem`/`MenuSeparator` primitives from the existing context menus.
- `saveLayout` panes serialization (scaleMode rides it).

## Spec (from `.audit/tv-parity/PUNCHLIST.md` § INC-12)

1. **Log ticks first (hard prerequisite):** add a log-aware tick generator in `grid.ts`; branch `GridLayer`/`AxisLayer` on `mode === 'log'` — linear ticks at log positions bunch unusably.
2. `ChartCore.setPriceScaleMode(mode)` — sets state, refits, `markDirty()`. Percent/indexed math (rebase against first-visible close) in `priceToY`/`yToPrice`.
3. `setAutoFit()` (extract the dblclick fit body so both share it) + `setInverted(bool)`.
4. Detect `region: 'price-axis'` in `onContextMenu` (reuse the onPointerDown boundary tests) → `PriceScaleContextMenu`: Auto / Log / Percent / Regular / Invert, with checkmarks for the active state.
5. Persist `scaleMode` on `PaneState` (rides existing layout serialization); restore on load.

## Files

`packages/chart-core/src/layers/grid.ts` · `layers/axis.ts` · `scale.ts` · `chart-core.ts` · `apps/web/features/terminal/terminal-store.ts` · `chart-pane.tsx`

## Verify before commit

- Unit tests for the pure parts: log tick generator (known ranges → expected ticks), percent rebase math round-trip (`priceToY(yToPrice(y)) ≈ y`).
- `pnpm typecheck` clean (chart-core + web + types if PaneState moves).
- Browser on /terminal (BTC/USDT): axis right-click menu renders; Log on a wide range shows sane tick spacing; Percent rebases to 0% at the first visible candle; Invert flips; dblclick still re-fits; pan/zoom + the smooth auto-fit still behave in every mode; reload restores the saved mode. Screenshots of log + percent.

## Done means

- [ ] All five modes correct in browser  ·  [ ] tick/rebase tests green  ·  [ ] INC-12 ticked + Recent log + one commit
