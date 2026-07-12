# GW-2: Kite Connect Wizard + Daily Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** A user (owner-only until GW-4) connects their Zerodha Kite app from the terminal UI, completes the Kite login to mint the daily access token, and re-mints it each morning with one tap — no CLI needed.

**Architecture:** `routes/broker.ts` (admin-gated) wraps the GW-1 store + `KiteGateway.exchangeRequestToken`; `BrokerConnectDialog` clones the shipped OANDA wizard UX; `/broker/callback` auto-captures `request_token` when the user's Kite app redirect points at us. `SessionUser` gains `role` so the UI can show the button to admins only.

**Tech Stack:** Fastify + zod (existing), GW-1 broker module, Radix dialog components (existing).

## Global Constraints
- All broker endpoints `role='admin'`-gated until GW-4 (spec §4 GW-3 note).
- Secrets server-side only; client sees `apiKeyLast4`. Never log secrets.
- Additive only; never touch the alert engine/providers.
- Kite login URL: `https://kite.zerodha.com/connect/login?v=3&api_key=<key>`; redirect carries `request_token`.

### Task 1: `role` on SessionUser + `requireAdmin`
**Files:** Modify `apps/api/src/auth.ts` (add `role` to SessionUser + queries; add `requireAdmin`), Modify `apps/api/src/routes/auth.ts` (`/me` returns role). Test: `tests/broker-routes-util.test.ts` (pure pieces).
**Produces:** `requireAdmin(req, db): SessionUser` (throws 403 `admin_required` unless `role==='admin'`).

### Task 2: `routes/broker.ts` + registration
**Files:** Create `apps/api/src/routes/broker.ts`, Modify `apps/api/src/main.ts`.
**Endpoints (all requireAdmin):**
- `GET /api/broker/connections` → `{ items: BrokerConnectionSummary[], loginUrl }`
- `POST /api/broker/connect` `{ broker:'kite', apiKey, apiSecret, requestToken? }` → without token: save pending, return `{ status:'pending', loginUrl }`; with token: exchange against real Kite, save active, return summary
- `POST /api/broker/reconnect` `{ broker:'kite', requestToken }` → exchange with stored key/secret → `updateAccessToken`
- `DELETE /api/broker/connections/:broker`
**Pure helper:** `buildKiteLoginUrl(apiKey)` exported for tests.

### Task 3: `BrokerConnectDialog` + top-bar button (admin-only) + `/broker/callback`
**Files:** Create `apps/web/features/terminal/broker-connect-dialog.tsx`, Create `apps/web/app/broker/callback/page.tsx`, Modify `apps/web/features/terminal/terminal-top-bar.tsx`, Modify `apps/web/lib/auth.tsx` (AuthUser.role).
**UX:** not-connected → key+secret form → Connect → "Open Zerodha login" + request-token paste → Complete. Connected → account card (name, last-4, status badge, last login) + Reconnect + Disconnect. Callback page auto-posts `request_token` to `/api/broker/reconnect` and reports the result.

### Task 4: Verify + deploy
- `pnpm vitest run` full + both typechecks.
- Local curl: non-admin → 403; flag local demo user admin → connect flow with real key/secret returns pending + loginUrl.
- Browser: dialog renders, states correct, 0 console errors (screenshot).
- Deploy to VM; flag the owner's prod account admin (only if email matches the owner's known emails); prod smoke: `/api/broker/connections` 401 anon / 403 non-admin; site 200.
- STATUS.md row + spec tick + push.
