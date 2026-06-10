# Session 01 — INC-4 · Data Window: per-plot colours, friendly names, hidden-dim, change bar

> One session = this task only. Severity medium · Effort M.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/01-inc4-data-window-per-plot.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot on /terminal), commit small, tick INC-4 in CLAUDE.md + update the Recent log (cap 5 — move older entries to docs/changelog.md verbatim), then STOP.
```

## Goal

Bring the right-rail **Data** tab to TradingView's per-plot fidelity: each channel row shows its real plot colour and a readable name; hidden indicators render dimmed with an EyeOff icon; Change/Change% rows get a thin bull/bear colour bar.

## What already exists (extend, don't rebuild)

- `apps/web/features/terminal/data-window-util.ts` — pure `buildDataWindow` + `formatVolume`; tests in `tests/data-window-util.test.ts`.
- Data tab renderer in `apps/web/features/terminal/right-rail.tsx` (EyeOff already imported there); active pane publishes a compact `dataWindow` snapshot to the store.
- Colour-resolution logic lives in `sub-pane-indicators.tsx` (`colorFor`) — lift it, don't duplicate it.

## Spec (from `.audit/tv-parity/PUNCHLIST.md` § INC-4)

1. New exported `channelColor(spec, inst, channel)` helper: lift the `colorFor` logic out of `sub-pane-indicators.tsx`, with an explicit channel→styleKey alias map for the ADX/Bollinger mismatches.
2. Add `color` to `DataWindowChannel`, resolved via that helper in `buildDataWindow`.
3. Add optional `channelLabels` to `IndicatorSpec` in `packages/indicators/src/registry.ts` for friendly plot names (MACD/Signal/Histogram, %K/%D, +DI/−DI, Span A, %B, …); `buildDataWindow` reads them, falling back to the raw channel key.
4. Carry `visible` on `DataWindowIndicator`; render hidden instances dimmed + EyeOff in the Data tab.
5. Prepend a thin bull/bear colour bar on the Change/Change% rows keyed off `o.up`.

## Files

`data-window-util.ts` · `right-rail.tsx` · `indicator-legend-util.ts` · `sub-pane-indicators.tsx` · `packages/indicators/src/registry.ts`

## Verify before commit

- Unit tests extended in `tests/data-window-util.test.ts`: alias map, labels, visible flag, change-bar input. Report the real pass count from Vitest output.
- `pnpm typecheck` clean for touched packages.
- Browser on /terminal: add MACD + Bollinger + 1 EMA, hide the EMA → Data tab shows colour swatches matching the chart, friendly plot names, the dimmed hidden row, and the change bar flipping colour on an up vs down candle. Screenshot it.
- Alert list count unchanged (live config untouched).

## Done means

- [ ] Steps 1–5 working in browser  ·  [ ] tests green (count from output)  ·  [ ] INC-4 ticked + Recent log entry + one commit
