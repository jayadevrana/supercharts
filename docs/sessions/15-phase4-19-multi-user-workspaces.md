# Session 15 — Phase 4 · #19 · Multi-user workspaces (team sharing)

> One session = this task only. Effort XL. **Depends on Session 12 (#20 auth — real users + scoped WS) and ideally Session 14 (#22 persistence).**
> If anything here is ambiguous, write it to "Questions for owner" and build the unambiguous core.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/15-phase4-19-multi-user-workspaces.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + a two-account browser test), commit small, tick Phase 4 #19 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

A user can create a **workspace**, invite others by link, and share selected resources with members: watchlists, chart layouts, and strategies (SignalRecipes) — read-only or editable per resource.

## Scope v1

1. **Tables**: `workspaces` (id, name, ownerId), `workspace_members` (workspaceId, userId, role: owner/editor/viewer), `workspace_invites` (token, workspaceId, role, expiresAt — reuse the nanoid token pattern), `workspace_resources` (workspaceId, kind: watchlist|layout|recipe, resourceId, mode: view|edit).
2. **API** (`routes/workspaces.ts`): CRUD workspace (owner) · invite create/revoke · `POST /api/workspaces/join/:token` · share/unshare a resource · list "shared with me". Authorization helper as a pure tested module (`apps/api/src/workspace-acl.ts`): every access check goes through ONE function.
3. **Resource semantics v1 (keep simple)**: shared = live reference for `view` (reader sees owner's current version, read-only) and **copy-on-edit** for `edit` (editing clones into the editor's account — no concurrent co-editing, no CRDTs in v1).
4. **UI**: a Workspace dialog (top-bar): create, members list w/ roles, invite link copy, share pickers; shared resources appear in the existing watchlist/layout/strategy lists with a "shared · by <name>" badge.
5. **Never shared, ever**: alerts, Telegram bots/configs, OANDA/MT5 credentials, webhooks, broadcasts, paper trades. The ACL module must hard-deny these kinds.

## Hard rules

- Strategy sharing reuses the `strategy-share.ts` sanitizer field-allow-list for what members can SEE (no account/owner internals leak even inside a workspace).
- Every route enforces via `workspace-acl.ts` — no inline permission logic.
- Invite tokens expire (default 7d) and are single-role.

## Verify before commit

- Unit tests: ACL matrix (owner/editor/viewer/non-member × view/edit/share/deny-listed kinds), invite expiry, copy-on-edit clone. Report counts.
- curl smoke as two real users: A creates+shares, B joins via token and reads; B cannot read A's alerts/credentials (assert 403s).
- Browser with two sessions (normal + incognito): B sees A's shared watchlist with the badge; B editing an `edit`-mode layout gets their own copy; A's original untouched.
- `pnpm typecheck` clean.

## Done means

- [ ] Two-account share flow proven, deny-list enforced  ·  [ ] ACL tests green  ·  [ ] #19 ticked + Recent log + one commit
