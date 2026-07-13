# GW-4: Plan gating (`users.plan`) + `/admin` panel

> **For agentic workers:** strict TDD, small commits, one task at a time. Steps use checkbox
> (`- [ ]`) syntax. Spec: `docs/superpowers/specs/2026-07-13-byob-broker-platform-design.md`
> §2 (locked: $15/mo IS the plan, manual admin activation), §3.3 (`users` gains `plan` +
> `plan_expires_at`), §3.4 (`/api/admin/*` role='admin' only), §4 GW-4.

**Goal:** Introduce the manual Pro-plan model that the BYOB broker endpoints gate on, plus an
owner `/admin` panel to activate/deactivate users and inspect connections + the order audit trail.
This is the gate that lets broker endpoints open **beyond `role='admin'`** — a signed-in user with
an active `plan='pro'` now gets broker connect + trading; free users get 403; admin always passes.

**Architecture:**
- Backend: pure `apps/api/src/plan.ts` (`resolvePlanAccess` + `resolvePlanUpdate`, no DB). DB
  migration adds `users.plan` ('free'|'pro') + `plan_expires_at`. New `requirePro(req, db, now?)`
  in `auth.ts` (admin bypass; 401 anon / 403 no-access). `routes/broker.ts` swaps every
  `requireAdmin` → `requirePro`. New `routes/admin.ts` (all `requireAdmin`): users list + plan
  toggle + connections + order audit. `/api/auth/me` surfaces `plan` + `planExpiresAt` + `brokerAccess`.
- Frontend: `apps/web/app/admin/page.tsx` (admin-only guard) — users table with Free/Pro toggle +
  duration, connections list (last-4 only), recent orders. `middleware.ts` gates `/admin`. Session
  `AuthUser` carries `plan`/`planExpiresAt`/`brokerAccess`.

**Global constraints (every task):**
- ADDITIVE ONLY. Never touch the alert engine, MT5 bridge, or the read-only kite data provider.
- Secrets never leave the server — admin views show only last-4 + status, never api_secret/token.
- Migration is idempotent (ALTER … ADD COLUMN, catch duplicate-column) like `email_verified`.
- Tests live in `tests/`, import by relative source path, run `pnpm vitest run <file>`.
- No live broker order needed for GW-4 (no execution-path change beyond the auth guard).

---

### Task 1: Pure plan resolver (`plan.ts`)

**Files:** Create `apps/api/src/plan.ts` + `tests/plan.test.ts`.

**Interfaces:**
- `type PlanTier = 'free' | 'pro'`.
- `resolvePlanAccess({ role?, plan?, planExpiresAt? }, now): { allowed: boolean; tier: PlanTier; reason: 'admin'|'active'|'expired'|'free' }`
  — admin ⇒ allowed, reason 'admin'; plan!='pro' ⇒ !allowed, 'free'; pro + expiry≤now ⇒ !allowed,
  'expired'; pro + (no expiry | future) ⇒ allowed, 'active'.
- `resolvePlanUpdate({ plan: 'free'|'pro', durationDays?, expiresAt? }, now): { plan: PlanTier; expiresAt: number|null }`
  — free ⇒ expiresAt null; pro + durationDays ⇒ now + days·86400e3; pro + explicit expiresAt ⇒ that;
  pro + neither ⇒ null (lifetime).

- [ ] **Step 1: Failing test** covering: admin bypass, free denied, pro active (no expiry + future),
  pro expired denied; update: free→null, pro+30d→future ts, pro+lifetime→null.
- [ ] **Step 2:** `pnpm vitest run tests/plan.test.ts` → FAIL (cannot resolve).
- [ ] **Step 3: Implement** `plan.ts`.
- [ ] **Step 4:** run → green.
- [ ] **Step 5: Commit** `feat(broker): pure plan resolver — access + admin update (GW-4)`.

---

### Task 2: DB plan columns + `requirePro` + broker gate

**Files:** Modify `apps/api/src/db.ts` (migration), `apps/api/src/auth.ts` (`requirePro`),
`apps/api/src/routes/broker.ts` (`requireAdmin`→`requirePro`), `apps/api/src/routes/auth.ts`
(`/me` returns plan). Extend `tests/broker-trade-routes.test.ts`.

**Interfaces:**
- Migration: idempotent `ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'` +
  `ADD COLUMN plan_expires_at INTEGER` (catch duplicate-column).
- `requirePro(req, db, now = Date.now()): SessionUser` — `getUser` (401) then reads `plan`,
  `plan_expires_at`, applies `resolvePlanAccess`; throws `{ statusCode: 403, message: 'plan_required' }`
  when not allowed. Admin passes.
- `/api/auth/me` user object gains `plan`, `planExpiresAt`, `brokerAccess` (the `allowed` boolean).

- [ ] **Step 1: Failing test** — add to `broker-trade-routes.test.ts`: a `seedProConnection`
  (role='user', plan='pro', token set) → `GET /api/broker/orders` 200; an expired-pro seed → 403.
  The existing "anon 401 / non-admin free 403" case stays green (free user still 403).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** migration + `requirePro`; swap the 10 `requireAdmin` calls in broker.ts;
  extend `/me`.
- [ ] **Step 4:** run `tests/broker-trade-routes.test.ts` → all green; re-run
  `tests/kite-market-routes.test.ts` + `tests/auth-password.test.ts` (unchanged).
- [ ] **Step 5:** `pnpm -F @supercharts/api typecheck`; commit
  `feat(broker): users.plan + requirePro gate opens broker to Pro users (GW-4)`.

---

### Task 3: Admin routes (`routes/admin.ts`)

**Files:** Create `apps/api/src/routes/admin.ts`, register in `apps/api/src/main.ts`, test
`tests/admin-routes.test.ts`.

**Interfaces (all `requireAdmin` — 401 anon / 403 non-admin):**
- `GET /api/admin/users` → `{ items: [{ id, email, displayName, role, plan, planExpiresAt, createdAt, connectionCount, orderCount }] }` newest first.
- `POST /api/admin/users/:id/plan` — body `{ plan: 'free'|'pro', durationDays?, expiresAt? }` (zod) →
  `resolvePlanUpdate` → `UPDATE users SET plan=?, plan_expires_at=?`; 404 if user missing;
  returns the updated `{ id, plan, planExpiresAt }`.
- `GET /api/admin/connections` → `{ items: [{ id, userId, email, broker, apiKeyLast4, status, lastLoginAt, createdAt }] }` (NEVER secrets).
- `GET /api/admin/orders?limit=` → `{ items: [{ id, userId, email, broker, intent, brokerOrderId, status, error, placedVia, createdAt }] }` (limit ≤ 200).

- [ ] **Step 1: Failing test** (Fastify inject): anon→401, non-admin→403; admin lists users (incl.
  `demo`), toggles a user to pro (durationDays 30 → planExpiresAt in the future), then back to free
  (null); lists connections showing only last-4; lists orders. 404 on unknown user id.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `admin.ts` + register `adminRoutes(app, db)` in main.ts.
- [ ] **Step 4:** run → green; full `pnpm vitest run` sanity.
- [ ] **Step 5:** `pnpm -F @supercharts/api typecheck`; commit
  `feat(admin): /api/admin users·plan·connections·orders panel API (GW-4)`.

---

### Task 4: Web `/admin` page + session plan

**Files:** Modify `apps/web/middleware.ts` (matcher +`/admin`), `apps/web/lib/auth.tsx`
(`AuthUser` + `plan`/`planExpiresAt`/`brokerAccess`, `MeResponse`). Create
`apps/web/app/admin/page.tsx`.

**Interfaces:**
- `AuthUser` gains `plan?: string`, `planExpiresAt?: number | null`, `brokerAccess?: boolean`.
- `/admin` page: client-guarded (`user?.role === 'admin'` else bounce to `/terminal`); three cards —
  Users (email · role · plan badge · connection/order counts · Activate Pro 30d/90d/365d/Lifetime ·
  Deactivate), Broker connections (email · broker · ••last4 · status), Recent orders (email · intent
  summary · status · time). Uses `api()`; refresh after a plan change.

- [ ] **Step 1:** wire `AuthUser` plan fields + middleware matcher.
- [ ] **Step 2: Build** `app/admin/page.tsx` (reuse `SiteHeader`/`SiteFooter`/`Button`/`Input`
  primitives; match `/account` styling).
- [ ] **Step 3:** `pnpm -F @supercharts/web typecheck`; commit
  `feat(admin): /admin owner panel — activate Pro + view connections/orders (GW-4)`.

---

### Task 5: Full gate + browser verify + deploy + STATUS

- [ ] **Step 1:** `pnpm vitest run && pnpm -F @supercharts/api typecheck && pnpm -F @supercharts/web typecheck` — all green.
- [ ] **Step 2: Browser verify** on local dev (`api`/`web` from `.claude/launch.json`): sign in as
  the owner/admin, open `/admin`, confirm the users table renders, toggle the demo/a test user to
  Pro (planExpiresAt appears), Deactivate back to free; confirm a non-admin gets bounced. Screenshot.
- [ ] **Step 3: Deploy** — `git push origin main`; on VM `git pull --ff-only &&
  pnpm -F @supercharts/web build && pm2 restart all --update-env`; verify `https://supercharting.com/`
  200, `/api/health` ok:true + binance connected, `/api/admin/users` → 401 anon.
- [ ] **Step 4: STATUS** — add the GW-4 Done row with REAL test numbers; tick spec §4 GW-4; update
  In-progress/Next; commit + push `docs(status): GW-4 plan gate + admin panel landed`.
