# STATUS — live progress track (read this first, any agent)

> **Purpose:** the single up-to-date "what's done / what's next" file so any agent (Claude
> sessions, Codex, humans) can pick up cold. Update this file in the SAME commit as the work.
> Master goal + full backlog: `docs/LAUNCH-PLAN.md`. Working rules: `CLAUDE.md` (mirrored in
> `AGENTS.md`). Codebase map: `docs/architecture.md`.

## Mission

Launch SuperCharts publicly as the TradingView alternative for algo crypto/forex traders.
25-session ordered backlog in `docs/LAUNCH-PLAN.md` — work it top to bottom, one verified
increment per session, tick the box there AND log here.

## Hard rules (non-negotiable, any agent)

1. **Never break the live alert/Telegram config** — 48 armed production alerts (1d EMA5×EMA10).
   Read-only against `/api/alerts`; never mutate alert or trading data while testing.
2. **Never fabricate market data** — no fake candles/results; unavailable states stay honest.
3. One increment → typecheck touched packages → relevant Vitest → **full `pnpm test`** →
   browser-verify on live `/terminal` → small commit → tick LAUNCH-PLAN + update this file.
4. PulseScript stays an ORIGINAL language (never copy Pine identifiers/syntax); indicator math
   only in `packages/indicators`; chart engine stays our Canvas `chart-core`.
5. Tests live in `tests/` and import pure modules by RELATIVE SOURCE PATH (no build step).
   Commands: `pnpm test` · `pnpm -F @supercharts/<pkg> typecheck` · dev servers usually already
   running on :3000 (web) / :4000 (api) — check before starting new ones
   (`lsof -i tcp:3000 -i tcp:4000`); restart recipe in CLAUDE.md → Ops.

## Done (newest first)

> ⚠️ The owner rewrote git history between sessions (public-repo prep) — hashes older than
> `3f446d6` below no longer resolve; the ITEM entries + file contents are the ground truth.
> Also landed by the owner meanwhile: a **Zerodha Kite data provider** (instruments, candles,
> search; env loading) with its own tests — now part of the suite.

| Date | Item | Commits | Evidence |
|---|---|---|---|
| 2026-07-13 | **M5/DOCS-3** — PulseScript **cookbook** (`/docs/cookbook`, 12 runnable recipes across Trend/Momentum/Volatility/Alerts/MTF — each interpreter-tested) + **Backtesting & optimization** guide (`/docs/backtesting` — honest scorecard: trades/win%/return/maxDD/Sharpe/PF, optimizer grid sweep, walk-forward OOS; features verified in `optimizer.ts`/`walk-forward.ts`/`routes/alerts.ts`) + **"Coming from Pine"** migration page (`/docs/from-pine`: 17-row concept cheat-sheet + key differences; ORIGINAL-language rule respected — Pine referenced nominatively, no copied code) + **SEO** (`app/sitemap.ts` 17 URLs, `app/robots.ts`, canonical `metadataBase` + OG/Twitter from `NEXT_PUBLIC_APP_URL`). New data module `features/docs/cookbook.ts`; sidebar "Guides" section + docs-hub card; fixed a stale "reference coming" line in the language tour. | LOCAL — **ready to push** | web typecheck clean; **581/581** (13 new cookbook tests — every recipe runs + produces output); browser: cookbook + from-pine render, 0 console errors, "Run in terminal" deep-link loaded the MA-cross recipe into the live editor, sitemap.xml = 17 locs, robots.txt correct (private routes disallowed). |
| 2026-07-13 | **AUTH — email verification + Google-first** — password signups now email a **6-digit code** (`/verify` page → unlocks terminal); Google signups skip it (Google verifies). New `apps/api/src/email.ts` (Resend HTTP API, **no dep**) + `email_verifications` table + `users.email_verified` (existing users grandfathered to 1). **Self-protecting gate:** verification is required ONLY when `RESEND_API_KEY` is set (or `EMAIL_DEV_LOG=1`) — the live site keeps instant signup until email is wired, so no lockout. Endpoints: register returns `needsVerification`; `verify-email` (attempts+expiry limited), `resend-verification` (cooldown); `/me` returns `emailVerified`. Terminal guard bounces unverified→`/verify`. **Google-first:** "Continue with Google" is now the primary button on `/login`+`/signup`, email form secondary. | `0880e3e` (**deployed LIVE**) | api+web typecheck; **568/568** (4 new email tests); **prod:** register→`needsVerification:false` (email not wired → instant signup preserved, no lockout), `emailVerified:true`, `/verify`→307, homepage 200; curl w/ `EMAIL_DEV_LOG`: register→`needsVerification:true`, wrong code→`wrong_code`, right (dev-logged) code→ok→`emailVerified:true`, re-verify→`alreadyVerified`; browser: UI signup→`/verify` (renders code box), enter code→`/terminal`, Google-first layout screenshotted (dummy creds), 0 console errors. |
| 2026-07-12 | **AUTH — account settings page** — `/account` (gated): Profile (display name), Security (**change** password, or **set** a first password for Google-only users), Connected sign-in methods (Google **connect** via `google/start?link=1` link-mode → callback attaches to the signed-in account, 409 on already-linked). Backend: `PATCH /api/auth/profile`, `POST /api/auth/change-password` (verifies current when one exists), `/api/auth/me` now returns `hasPassword`+`providers`. Header name links to `/account`. | `95425eb` (**deployed LIVE**) | api+web typecheck; **564/564**; prod curl: `/account`→**307** /login, register→me shows `hasPassword`, change-password ok (old pw→**401**, new→**200**), profile PATCH **200**; browser: all 3 cards render, 0 console errors (smoke user cleaned up). |
| 2026-07-12 | **AUTH — Google OAuth + email/password** (Phase 5 #20). Fastify-native (NOT Auth.js — the app proxies all `/api/*` to Fastify): `routes/auth.ts` = `/api/auth/google/start`+`/callback`, `register`, `login`, `logout`, `me`. Uses the pre-existing `sessions` table + httpOnly `sc_session` cookie; scrypt password hashing via `node:crypto` (**zero new deps**); new `accounts` OAuth-link table; per-user `seedUserWorkspace` (namespaced `wl_<uid>` ids). `getUser` now resolves the cookie (`AUTH_ENABLED=0` → legacy `demo` fallback for local/single-user); WS lifts the session off the upgrade req. Web: `SessionProvider`, wired `/login`+`/signup`, header account menu, `middleware.ts` gates `/terminal`. | `502287f` (**deployed LIVE**) | api+web typecheck clean; **564/564** (5 new scrypt tests); curl flow: register→me→**200** protected / anon→**401** / wrong-pw→**401** / dup→**409** / new user seeded `wl_u_*` 10 syms; browser: `/terminal`→`/login` gate, UI sign-in→live terminal, header shows account + Sign out, 0 console errors. **Prod (https://supercharting.com) verified:** `/terminal`→**307** /login, register **200** with **HttpOnly+Secure** `sc_session` cookie (NODE_ENV=production set on VM), me+protected **200**. Google flow structurally complete; needs the OAuth client + `GOOGLE_CLIENT_ID/SECRET` in the VM `.env` (blank now → button hidden) to go end-to-end. | Fastify-native (NOT Auth.js — the app proxies all `/api/*` to Fastify): `routes/auth.ts` = `/api/auth/google/start`+`/callback`, `register`, `login`, `logout`, `me`. Uses the pre-existing `sessions` table + httpOnly `sc_session` cookie; scrypt password hashing via `node:crypto` (**zero new deps**); new `accounts` OAuth-link table; per-user `seedUserWorkspace` (namespaced `wl_<uid>` ids). `getUser` now resolves the cookie (`AUTH_ENABLED=0` → legacy `demo` fallback for local/single-user); WS lifts the session off the upgrade req. Web: `SessionProvider`, wired `/login`+`/signup`, header account menu, `middleware.ts` gates `/terminal`. | `502287f` (**deployed LIVE**) | api+web typecheck clean; **564/564** (5 new scrypt tests); curl flow: register→me→**200** protected / anon→**401** / wrong-pw→**401** / dup→**409** / new user seeded `wl_u_*` 10 syms; browser: `/terminal`→`/login` gate, UI sign-in→live terminal, header shows account + Sign out, 0 console errors. **Prod (https://supercharting.com) verified:** `/terminal`→**307** /login, register **200** with **HttpOnly+Secure** `sc_session` cookie (NODE_ENV=production set on VM), me+protected **200**. Google flow structurally complete; needs the OAuth client + `GOOGLE_CLIENT_ID/SECRET` in the VM `.env` (blank now → button hidden) to go end-to-end. |
| 2026-07-12 | **DEPLOY live** — `https://supercharting.com` up. Deleted the mining-flagged VM; clean **e2-standard-2** (Ubuntu 24.04, asia-south1 Mumbai, **reused IP 35.200.208.191** so DNS unchanged). Firewall hardened: only **80/443** public; closed the old 3000/4000/7878. 2G swap + pm2 reboot-persistence via `infra/deploy/vm-bootstrap.sh` (one-shot). | `6dbb09f` | homepage 200 (title "SuperCharts…"); TLS **Let's Encrypt** valid Jul 12→Oct 10; `/api/health` binance **connected** (9 subs); pm2 both online; boot service enabled |
| 2026-07-11 | **DEPLOY infra** — GCP VM provisioned (e2-medium, Ubuntu 22, **asia-south1** Mumbai, static IP **35.200.208.191**, Node 22/pnpm/git/Caddy, firewall 22/80/443/3000/4000/7878) + **DEPLOY-1 artifacts**: pm2 ecosystem (2 procs — API embeds ingestion), `.env.production.example`, Caddyfile, `docs/deploy-runbook.md` | `7fb549c` | prod `next build` OK (20 routes static); pm2 paths validated; suite 559/559. On-VM boot pending user running the runbook (secrets pasted on VM, never chat) |
| 2026-07-11 | **M4/DOCS-2** — exhaustive API reference: /docs/reference/{ta,math,inputs,outputs}. 61 ta.* (grouped) + 24 math.* + 6 input.* + outputs, each signature+params+return+runnable example. Typed content modules; TA/MATH re-exported from the package. | `c515dd9` | 109 tests → 559/559; drift guard = runtime coverage test, PROVEN by injecting ta.__driftTest → test failed; browser: 61 entries/5 groups/61 run links; alerts intact 144 |
| 2026-07-11 | **M3/DOCS-1** — public /docs (Overview + Getting started + Language tour), server-side highlighting from the language's own keyword sets, copy + `?pulse=` run-in-terminal deep link, header Docs link; all 9 samples interpreter-executed in tests | feat(docs): public PulseScript docs | 10 tests → 450/450; browser: pages render w/ colors, deep link loaded a docs sample into the live dock, URL stripped; 0 console errors |
| 2026-07-11 | **M2/SCAN-4** — PulseScript scans: `runScriptScan` (parse once → 400 w/ line/col; 500ms/symbol sandbox; matched = mark/alert() on LAST closed bar; per-symbol `script_error` rows) + `scriptId` on POST /api/scanner/scan + Script mode in the tab (saved-script dropdown + Run) | see `git log` (feat(scanner): PulseScript-powered scans) | 6 tests → 440/440; script matches agreed 16/16 + 26/26 with the independent emaDistPct metric; UI run 15 matched; 404/400 paths; 0 console errors |
| 2026-07-10 | **M1/SCAN-3** — Custom screen builder (RSI/Close-vs-EMA/RVOL rows → SignalCondition via pure `scanner-screen-util.ts`, ALL/ANY, explicit Run) + per-user saved screens (`scanner_screens` table + CRUD `/api/scanner/screens`, chips w/ load+delete) | `dad7d64` | 5 tests → 434/434; UI screen RSI>55∧RVOL>1.5 = exactly API matches (DOT/ETH); save→load→delete round-trip server-verified; 0 console errors |
| 2026-07-10 | **SCAN-2** — Scanner tab is a real screener: mode chips (Movers + All + 6 presets), timeframe pills, sortable columns (pure `scanner-tab-util.ts`), click-to-open, refresh, error+Retry, honest footer. New `scanner-tab.tsx` extracted from right-rail | `dac7efe` | 5 util tests → suite 429/429; browser: Volume-surge preset = exactly the API's 7 matches (RVOL>2), sort asc/desc verified, row click loaded BTCUSDT, honest 0-match state, 0 console errors |
| 2026-07-10 | **SCAN-1** — screener query engine: pure `runScan` (apps/api/src/scanner.ts) + 6 presets (scan-presets.ts) + `ensureBarsMany` (candle-window.ts) + `POST /api/scanner/scan` / `GET /api/scanner/presets` (routes/scanner.ts) | `3868ebb` | 8 tests → suite 414/414; live 1h oversold: 48 scanned, 42 ok/6 insufficient/1 match; BTC RSI cross-checked 72.185 both paths |
| 2026-07-10 | **LAUNCH PLAN** set — north star, pricing rec, 25-session backlog, GTM, kill list | `8508123` `01375aa` | docs/LAUNCH-PLAN.md; designs in .audit/launch/*.json |
| 2026-07-10 | **PulseScript ergonomics + editor colors** — `pulse 1` header, colon bodies, no-let assignment; CodeMirror tokenizer + palette (pulse-language.ts) | `d352f2c` `8c90707` | 10 tests → 406/406; browser: 7+ token colors, sample runs live |
| 2026-07-10 | **Rebuild Slice 1** — dead-control sweep (magnet/lock/hide real, settings cog, replay interval, cursor modes, orphan deleted) + 2 latent bugs fixed (drawing id adoption; api.ts DELETE content-type 400) | `f79dcfb`…`0bbbaad` | 16 tests → 396/396; drawing round-trip 2→0 server-verified |
| 2026-07-10 | **Phase 0 audit** — baseline, control inventory, MT5 WS leak pinned, arch risks | `3580797` | .audit/terminal-rebuild/PHASE0-BASELINE.md |

## In progress

- **DEPLOYED + AUTH LIVE**: https://supercharting.com (Google OAuth structurally done, needs the OAuth client; email/password + email verification via Resend LIVE; account settings live). **DOCS TRACK COMPLETE (DOCS-1..3).**
- **NEW GOAL (owner, 2026-07-13): Forex + Indian market charts** → `docs/markets-expansion.md`. Providers ALREADY BUILT (`oanda.ts`/`kite.ts`/`yahoo.ts`) — this is credentials+catalog+UX+compliance. **Decision:** Forex=**OANDA free** (public); India=**owner's own Kite key, personal use, gated to owner only** (live NSE/BSE redistribution to other users = exchange-license breach ~₹20L; BYOK deferred as MKT-5). Milestones MKT-1..5 in the doc. **This is now the active work** (ahead of M6/PULSE-1).

## Next

**Owner goal (2026-07-10): 10-milestone track in LAUNCH-PLAN Phase A** — SCANNER (SCAN-1..4) ✅ · DOCS (DOCS-1..3) ✅.
Next **M6-M10/PULSE**: sub-pane plots → script drawing objects (line/label/box API) → `alert()`
bridge to the Telegram alert engine → interpreter optimization w/ benchmark (see perf note below)
→ editor autocomplete/hover/squiggles → then IND-1..2. Phase B (auth) already largely landed
out-of-order this session.

## Perf findings queued for M9 (interpreter optimization)

- A `ta.*` call INSIDE a user `fn` body defeats the run-cache (locals present) → O(n²):
  6000 bars × ta.stdev hit the 2s sandbox timeout. Fix candidates: memoize ta calls whose
  args are fn-params bound to stable series, or hoist-detect. Found by tests/docs-samples.test.ts.

## Docs drift-guard note (M4)

- The API-reference completeness guard is the RUNTIME test `tests/docs-reference.test.ts`
  (`Object.keys(TA/MATH)` ⊆ doc keys + every example runs), NOT typecheck — `TA`/`MATH` are
  annotated `Record<string, …>` for the interpreter's dynamic `TA[name]` lookups, so
  `keyof typeof TA` is `string`. Add a `ta.*` fn ⇒ add a doc entry or `pnpm test` fails.

## Known landmines for newcomers

- `lib/api.ts` only sends the JSON content-type when a body exists — don't "fix" it back;
  body-less DELETEs 400 otherwise (FST_ERR_CTP_EMPTY_JSON_BODY).
- The indicator runner has process-wide metadata (`setIndicatorMetadata`) — always set it
  synchronously right before a synchronous compute (see scanner.ts for the pattern).
- Scanner evaluates the last CLOSED bar (still-forming bar trimmed) — same as the alert engine.
- Zustand store is a God store pending split (rebuild S7) — add slices, don't grow it.
- React 19 RC + Next 15: HMR occasionally serves stale chunks after mid-edit saves — clear
  `.next` + restart if imports "disappear".
- Installing deps (`pnpm add`) can kill both dev watchers — restart per CLAUDE.md Ops.
