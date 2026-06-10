# Session 16 — Phase 5 · #23 · Mobile responsive terminal

> One session = this task only. Effort XL — if it runs long, land the layout shell (rails→drawers, top-bar overflow) first; touch gestures second.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/16-phase5-23-mobile-responsive.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + browser screenshots at mobile viewports), commit small, tick Phase 5 #23 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

/terminal is usable on a phone (390×844 baseline, 768 tablet): rails collapse into drawers, dialogs become bottom sheets, the chart canvas gets touch gestures. Desktop behaviour must be pixel-unchanged above the breakpoint.

## Scope

1. **Breakpoints**: `lg` desktop (unchanged) · below: left rail → floating tool button opening a drawer; right rail → bottom drawer with the same tabs; top bar → essential controls + overflow menu (Script/Backtest/Import/OANDA/Webhook/Broadcast move into it).
2. **Grid**: mobile defaults to 1 pane (layout picker constrained); pane header/status line wraps cleanly.
3. **Touch on canvas** (pointer events already used — extend, don't fork): 1-finger drag = pan · pinch = zoom (anchor between fingers, reuse the eased-zoom path) · long-press = crosshair mode · two-finger vertical = price-scale drag (or skip; note it). Drawing tools on touch: tap-move-tap (the click-gesture path from `drawing-controller.ts` — verify it works with taps).
4. **Dialogs/sheets**: `DialogContent` gains a mobile bottom-sheet variant (full-width, max-h, scroll). PulseScript dock: full-screen takeover on mobile.
5. **Landing/pricing/login** pages: straightforward responsive pass.
6. Viewport meta + touch-action CSS on the canvas (prevent browser pan/zoom stealing gestures).

## Hard rules

- Desktop ≥ lg renders byte-identical (screenshot-compare a desktop viewport before/after).
- No separate mobile component tree — responsive variants of the existing components only.
- Canvas gestures must not break mouse: all existing pointer interactions re-verified.

## Verify before commit

- `pnpm typecheck` + full Vitest (no regressions; report count).
- Headless browser at 390×844 and 768×1024: drawers open/close, overflow menu complete, 1-finger pan + pinch zoom work (CDP touch events), long-press crosshair, a trend line drawn by tap-move-tap, bottom-sheet dialog. Screenshots of each.
- Desktop 1440×900 screenshot matches pre-change layout.

## Done means

- [ ] Phone-usable terminal, desktop untouched  ·  [ ] gesture checks pass via CDP touch  ·  [ ] #23 ticked + Recent log + one commit
