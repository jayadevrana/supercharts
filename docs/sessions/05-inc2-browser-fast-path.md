# Session 05 — INC-2 · Indicators-dialog fast path: category rail, scripts section, row info

> One session = this task only. Severity medium · Effort L.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/05-inc2-browser-fast-path.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot on /terminal), commit small, tick INC-2 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

Make the Indicators dialog browsable at scale: favorites stay visible while searching, a left category rail filters sections, saved PulseScripts get their own section, and every classic row exposes its registry description.

## What already exists (extend, don't rebuild)

- `indicators-dialog.tsx`: favorites/recents (M1, localStorage `indicator-prefs.ts`), alias search (INC-1), keyboard nav (`flatRows`), DnD rows (M6).
- `GET /api/scripts` (same endpoint the Pulse editor uses) for the user's saved scripts.
- `setPulseSource`/`setPulseEnabled` on the store — PulseScript is **single-slot per pane** (a new selection replaces, it does not stack).
- Registry descriptions already exist in `packages/indicators/src/registry.ts` but are stranded (never rendered).

## Spec (from `.audit/tv-parity/PUNCHLIST.md` § INC-2)

1. Keep matching **Favorites** surfaced during search — drop the `if (!lower)` guard on the favorites partition.
2. Left **category rail** bound to a new `activeGroup` state that the existing sections `useMemo` loop respects; keep `flatRows`/keyboard-nav intact.
3. **"My scripts" section** sourced from `GET /api/scripts`; clicking one toggles the pane's pulse source via `setPulseSource`/`setPulseEnabled` (replaces the current script).
4. Per-row **info affordance** for classic rows surfacing `INDICATOR_LOOKUP[type].description` (tooltip or expandable line).

## Files

`apps/web/features/terminal/indicators-dialog.tsx` · `packages/indicators/src/registry.ts` (descriptions only if gaps) · pulse wiring already in store/chart-pane

## Verify before commit

- Unit tests for any pure partition/filter helpers extracted; report count.
- `pnpm typecheck` clean.
- Browser on /terminal: search "E" → starred EMA still pinned on top; click a category in the rail → only that section; My scripts lists a saved script and clicking it runs it on the pane (replacing the previous); info affordance shows a real description; ↑/↓/Enter still navigate. Screenshot.

## Done means

- [ ] All four behaviours in browser  ·  [ ] tests green  ·  [ ] INC-2 ticked + Recent log + one commit
