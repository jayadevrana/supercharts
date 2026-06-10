# Session 12 — Phase 5 · #20 · Real auth: Auth.js credentials + OAuth (+ per-user WS scoping)

> One session = this task only. Effort XL — if it runs long, land credentials + session middleware + WS scoping first; OAuth providers can be a follow-up session.
> ⚠️ Highest-risk session in the list: the 48 live alerts, Telegram config, and saved layouts belong to the current implicit user — they must survive untouched and owned by your account.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/12-phase5-20-auth.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + curl auth flows + browser login/logout), commit small, tick Phase 5 #20 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Pre-flight (read before coding)

`apps/api/src/auth.ts` + `demo-guard.ts` (how the current implicit user works), `db.ts` (users/sessions tables already exist), `ws-gateway.ts` (the KNOWN unscoped-broadcast issue), `app/login` + `app/signup` pages (exist as shells?), `.env.example` (`AUTH_SECRET`, `ENCRYPTION_KEY`).

## Scope

1. **Auth.js (credentials provider)** in apps/web: signup (email+password, hashed with a vetted lib — argon2/bcrypt), login, logout, session cookie (httpOnly, sameSite, secure-in-prod). Reuse/migrate the existing `users`/`sessions` tables rather than parallel ones.
2. **API session middleware**: Fastify validates the session on every authed route (replaces the demo-guard implicit user). One shared user-resolution helper; routes keep their current handler signatures.
3. **Data migration**: everything currently owned by the implicit/demo user (alerts, telegram_configs/bots, layouts, watchlists, scripts, drawings, indicator_layouts, signal_recipes…) is assigned to YOUR real account on first login — write it as an idempotent boot/first-run migration with a dry-run log of row counts per table BEFORE applying. The 48 live 1d EMA(5)×EMA(10) alerts must re-subscribe clean afterwards.
4. **WS scoping (KNOWN issue)**: `ws-gateway.ts` broadcasts MT5 + alert events unscoped — scope every per-user event to that user's sockets. Market-data streams stay shared.
5. **OAuth (Google and/or GitHub)** via Auth.js providers, env-gated (skip silently when env keys absent) — only after 1–4 are verified; otherwise log it as the next session.
6. **Route protection**: `/terminal` redirects unauthenticated → /login; public pages (landing, pricing, /s/[token], /embed/*) stay open.

## Hard rules

- Secrets server-side only; never log password hashes or tokens; keep the Telegram bot token last-4 pattern.
- The alert engine must run exactly as before for your user after migration — verify alert count and a real Telegram test delivery if and only if one is normally part of boot (do NOT spam the live channel otherwise).

## Verify before commit

- Unit tests: password hash/verify round-trip, session validation, migration idempotency (run twice → same counts). Report counts.
- curl smoke: signup → login (cookie) → authed route 200 → logout → same route 401; unknown cookie 401.
- Browser: signup/login/logout flow; /terminal redirects when logged out; after login the 48 alerts + saved layouts are all present (count them in the UI/API and report the real number).
- `pnpm typecheck` clean (api + web).

## Done means

- [ ] Real sessions end-to-end, data migrated to your account, WS events scoped  ·  [ ] tests + curl green  ·  [ ] #20 ticked + Recent log + one commit
