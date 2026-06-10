# Session 04 — INC-5 · Surface PulseScript + SMC + STS in the Data Window

> One session = this task only. Severity high · Effort L.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/04-inc5-pulse-smc-sts-data-window.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot on /terminal), commit small, tick INC-5 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

The flagship original features — PulseScript plots, SMC overlays (anchored VWAP / CVD), Signals & Trend Score — become visible rows in the Data Window at the crosshair candle, like any classic indicator.

## What already exists (extend, don't rebuild)

- `buildDataWindow` (pure, tested) + the `dataWindow` store snapshot published by the active pane; heavy series stay in chart-pane refs (`indChannelsRef` is the pattern to mirror).
- PulseScript runs in `chart-pane.tsx` over the pane's candle buffer → `RunResult.plots`.
- SMC anchored-VWAP / CVD frames are already computed and written to `layer.frame`; STS scalars are already in React state (`stsFrame`).

## Spec (from `.audit/tv-parity/PUNCHLIST.md` § INC-5)

1. Extend `buildDataWindow`'s inputs **additively** (existing signature/tests keep passing).
2. Stash the latest `RunResult.plots` in a ref (mirroring `indChannelsRef`) → emit one `DataWindowIndicator` per pulse plot, named from the script's `draw` labels/meta.
3. Stash the already-computed `anchoredVwap.vwap` / `cvd.cvd` frames in a ref and surface them; read `stsFrame` scalars at the crosshair index.
4. Gate each behind its enabled flag: `pane.pulse.enabled` / `pane.smc.*` / `overlays.signalsTrendScore`.
5. **Read the existing per-bar Float64Arrays — never recompute, never duplicate math, never touch PulseScript identifiers.**

## Files

`apps/web/features/terminal/data-window-util.ts` · `apps/web/features/terminal/chart-pane.tsx`

## Verify before commit

- Unit tests: `buildDataWindow` with pulse/SMC/STS sections present, absent, and disabled — extend `tests/data-window-util.test.ts`; report the real count.
- `pnpm -F @supercharts/web typecheck` (or root) clean.
- Browser on /terminal: run the sample PulseScript + enable anchored VWAP + STS → Data tab shows their rows updating with the crosshair; values match the on-chart legend/plot at the same candle; disable each → row disappears. Screenshot.

## Done means

- [ ] Pulse + SMC + STS rows live and crosshair-accurate  ·  [ ] tests green  ·  [ ] INC-5 ticked + Recent log + one commit
