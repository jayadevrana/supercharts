# Session 07 — INC-9 · Per-plot enable / show-in-legend toggles (multi-plot indicators)

> One session = this task only. Severity medium · Effort L. Pairs naturally after INC-4 (per-plot names/colours exist).

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/07-inc9-per-plot-toggles.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot on /terminal), commit small, tick INC-9 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

Multi-plot indicators (MACD, Bollinger, Ichimoku, ADX) get per-plot control: enable/disable each plot and choose whether it appears in the legend/Data Window. The instance-level eye stays the master switch.

## What already exists (extend, don't rebuild)

- Tabbed settings modal with a real **Style** tab (M4b) — the checkboxes live there.
- `buildLegendRows` / `buildDataWindow` (pure, tested) — gate rows on the new flags.
- Chart-pane's overlay switch pushes each channel's line/band keyed by instance id.

## Spec (from `.audit/tv-parity/PUNCHLIST.md` § INC-9)

1. Optional `plots` field on `IndicatorInstance`, keyed channel → `{enabled, showInLegend}`, defaulted from `spec.channels`. **Absent flags default to enabled** so every existing saved instance is unaffected.
2. Per-plot checkboxes in the Style tab (one row per channel: swatch · name · enabled · in-legend).
3. Skip pushing a disabled channel's line/band in chart-pane's overlay switch.
4. Gate `buildLegendRows` and `buildDataWindow` on `showInLegend`.
5. The per-plot price-line is a **deferred stretch** (no horizontal-level primitive in IndicatorsLayer yet) — skip it.

## Files

`apps/web/features/terminal/indicator-panel.tsx` · `chart-pane.tsx` · `indicator-legend-util.ts` · `data-window-util.ts` · `packages/types/src/chart.ts`

## Verify before commit

- Unit tests: default-on behaviour for instances without `plots`; legend/data-window gating. Extend the existing util tests; report the count.
- `pnpm typecheck` clean (types + web).
- Browser on /terminal: add MACD → Style tab lists Histogram/Signal/MACD; disable Histogram → bars vanish from the sub-pane but the others stay; untick in-legend for Signal → it leaves the legend + Data tab but still draws; saved layouts from before this change still render identically. Screenshot.

## Done means

- [ ] Per-plot toggles live, old instances unaffected  ·  [ ] tests green  ·  [ ] INC-9 ticked + Recent log + one commit
