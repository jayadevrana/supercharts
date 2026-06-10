# Session 13 — Phase 5 · #21 · Stripe billing live ($400/6mo · $600/12mo)

> One session = this task only. Effort L. **Depends on Session 12 (#20 auth)** — subscriptions attach to real users.
> Work in Stripe TEST mode this whole session; flipping to live keys is a 5-minute owner action afterwards.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/13-phase5-21-stripe-billing.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session. Use Stripe TEST keys only.
Verify (typecheck + Vitest + stripe-cli webhook smoke + browser checkout in test mode), commit small, tick Phase 5 #21 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Pre-flight

`apps/api/src/routes/billing.ts` (Stripe-ready scaffold — what exists?), `db.ts` `subscriptions` table, `.env.example` `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_PRICE_ID_6_MONTH` / `STRIPE_PRICE_ID_12_MONTH`, `app/pricing` page. If test keys are missing from `.env`, STOP and add to **Questions for owner** — do not mock Stripe.

## Scope

1. **Checkout**: pricing page buttons → `POST /api/billing/checkout` → Stripe Checkout Session (mode=subscription… note: 6/12-month one-time vs recurring — implement what the price IDs are configured as; if ambiguous, ask via Questions for owner) → redirect; success/cancel pages.
2. **Webhook** `POST /api/billing/webhook`: raw-body signature verification (`STRIPE_WEBHOOK_SECRET`), handle `checkout.session.completed`, `invoice.paid`/`payment_failed`, `customer.subscription.updated`/`deleted` → upsert the `subscriptions` row (status, period end, price id). Idempotent on event redelivery.
3. **Gating**: a `requireActiveSubscription` check on /terminal (web) + the heavyweight API routes; the owner account is exempt (flag on users). Expired → friendly paywall screen, data never deleted.
4. **Portal**: `POST /api/billing/portal` → Stripe customer portal for cancel/renew.

## Hard rules

- Never log full Stripe keys/payloads with PII; verify webhook signatures (reject unsigned with 400).
- Webhook route must be exempt from auth middleware + JSON body parsing (raw body needed for signature).
- No fake subscription states — gate logic reads only what webhooks wrote.

## Verify before commit

- Unit tests: webhook event → subscription row mapping (fixtures for each handled event), idempotent redelivery, gating logic (active/expired/owner). Report counts.
- `stripe listen --forward-to localhost:4000/api/billing/webhook` + `stripe trigger checkout.session.completed` → row written (paste the real row).
- Browser test-mode checkout with card 4242…: completes → /terminal accessible; flip the row to canceled in SQLite → paywall renders.
- `pnpm typecheck` clean.

## Done means

- [ ] Test-mode checkout → webhook → gated access loop proven  ·  [ ] tests + stripe-cli smoke green  ·  [ ] #21 ticked + Recent log + one commit
