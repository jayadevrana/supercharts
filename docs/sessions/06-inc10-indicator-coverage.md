# Session 06 — INC-10 · Coverage: DEMA/TEMA reachable, VWMA, input bounds + tooltips, MA offset, Bollinger source

> One session = this task only. Severity medium · Effort M.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/06-inc10-indicator-coverage.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot on /terminal), commit small, tick INC-10 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

Close the registry/math coverage gaps — all reusing `@supercharts/indicators` (the single TA implementation).

## What already exists (extend, don't rebuild)

- DEMA/TEMA **runner cases already exist** — they only need registry+catalog rows (zero new math).
- `ma.ts` has sma/ema/wma/rma; `runner.ts` has `numberInput` plumbing; `volatility.ts` has Bollinger.

## Spec (from `.audit/tv-parity/PUNCHLIST.md` § INC-10)

1. **DEMA/TEMA**: add registry + catalog rows (reachable from the dialog).
2. **VWMA**: `vwma(values, volumes, length)` in `ma.ts` + runner case reading `candle.volume` — real volume only, never fabricated.
3. **Input bounds**: backfill `min`/`max`/`step` on all numeric inputs; optional `tooltip` on `IndicatorInputSpec` rendered as help text + an onChange clamp. Add a min-floor in `runner.numberInput` so length 0 can't blank a series.
4. **MA offset**: `offsetInput()` + `shiftSeries` for displaced MAs.
5. **Bollinger source**: `sourceInput()` + source plumbing via `pricesFromCandles` — Bollinger ONLY. Do **not** add a source picker to CCI/Williams/MFI/Stochastic (they are HLC-defined; a picker there would be misleading).

## Files

`packages/indicators/src/registry.ts` · `runner.ts` · `ma.ts` · `volatility.ts` · `apps/web/features/terminal/indicators-dialog.tsx` · `indicator-panel.tsx`

## Verify before commit

- Unit tests in `tests/`: VWMA hand-computed on a small candle set; shiftSeries offsets; clamp floor (length 0 → 1-bar window, not blank); Bollinger with source=hl2 vs close differ; DEMA/TEMA rows resolve from search. Report the count.
- `pnpm typecheck` clean (indicators + web).
- Browser on /terminal: add DEMA, TEMA, VWMA — lines render on real candles; set an MA offset → line shifts; Bollinger source picker works; a length input refuses 0. Screenshot.

## Done means

- [ ] All five gaps closed  ·  [ ] hand-computed tests green  ·  [ ] INC-10 ticked + Recent log + one commit
