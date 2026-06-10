# Session 14 — Phase 5 · #22 · Complete per-user persistence (workspace restore)

> One session = this task only. Effort M. **Depends on Session 12 (#20 auth)** for true per-user scoping.
> Much already persists — this session is an AUDIT + gap-fill, not a rebuild.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/14-phase5-22-per-user-persistence.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + a browser set-up→reload→restore round-trip), commit small, tick Phase 5 #22 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## What already persists (server-side, per user)

`chart_layouts` (panes/symbols/intervals) · `indicator_layouts` · `user_scripts` · `drawing_objects` · `watchlists` · `user_preferences` · alerts/signals. Client-side localStorage: indicator favorites/recents (`indicator-prefs.ts`).

## Scope

1. **Audit first (in-session, with evidence)**: build the real list of store state that does NOT survive reload/re-login. Expected gaps to check: per-pane overlay toggles (heatmap/footprint/economic events/maSignals…), SMC toggles, pulse state (enabled + which script), sub-pane heights/collapsed (INC-16), scale mode (INC-12 — if not yet built, note it), right-rail tab, chart type per pane, theme. Paste the audit table into the session log before coding.
2. **Server-side workspace snapshot**: extend the existing layout persistence (additive — version the payload) so the audited gaps ride `chart_layouts` (or a new `workspace_state` JSON column/table if cleaner). Debounced autosave on change; restore on /terminal load.
3. **Migrate favorites/recents** from localStorage to `user_preferences` (one-time client migration, localStorage kept as fallback for logged-out).
4. **Versioning rule**: old saved layouts (pre-this-session) must load unchanged — absent fields default to current behaviour. Add a `version` field for future migrations.

## Hard rules

- Additive schema only; never drop/rewrite existing rows. The 48 live alerts and current saved layouts must round-trip byte-identical where untouched.
- No silent failures: a restore error falls back to defaults AND logs, never a blank terminal.

## Verify before commit

- Unit tests: snapshot serialize/restore round-trip incl. version-absent defaults. Report count.
- Browser round-trip: configure a distinctive workspace (2nd pane symbol, footprint on, RSI pane resized, pulse script on, favorites starred) → hard reload → everything restored; then log out/in → still restored. Screenshot before/after.
- A layout saved BEFORE this session still loads (test with a real pre-existing row).
- `pnpm typecheck` clean.

## Done means

- [ ] Audit table produced, every gap closed or explicitly deferred  ·  [ ] round-trip proven in browser  ·  [ ] #22 ticked + Recent log + one commit
