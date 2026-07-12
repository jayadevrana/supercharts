# BYOB Broker Trading Platform — Design Spec

> **Status:** approved by owner 2026-07-13 (incl. the SEBI per-client static-IP correction).
> **Supersedes** the "personal Kite key" decision in `docs/markets-expansion.md` — this is now the
> PRIMARY GOAL, ahead of M6/PULSE-1.

## 1. Concept & pricing

Bring-Your-Own-Broker: each user connects **their own** broker account (Zerodha Kite first; OANDA
second; Angel/Dhan later) and gets that broker's charts, scanner, Telegram alerts, and **order
placement from the chart**. Users only ever see *their own* broker's data → SuperCharts buys **no
market data** and redistributes **nothing**.

**Pricing:** free tier = today's full terminal (Binance/Yahoo charts, PulseScript, backtesting,
paper trading). **Pro = $15/mo** unlocks: broker connect · live broker charts · scanner on broker
symbols · Telegram alerts · order placement · dedicated order-routing IP.
**Billing is MANUAL for now:** users contact the owner; owner activates/deactivates from a new
`/admin` panel (payment gateway approval is pending; Razorpay/Stripe integration deferred).

User-side broker costs (stated honestly in the UI): Zerodha order APIs = free (Kite Connect
Personal); live Indian chart data = the user's own Kite Connect data add-on (₹500/mo to Zerodha).

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Daily token custody | **Hybrid** — default: one-tap daily reconnect (store only api_key/secret); opt-in: fully headless auto-login with encrypted user-id/password/TOTP-secret behind an explicit signed risk acknowledgment |
| Plan model | $15/mo is THE plan; $400/$600 tiers retire |
| Payments | Manual activation via admin panel (gateway later) |
| Static IP model | **Egress IP pool with per-broker pinning** (SEBI: one IP ↔ one client per broker; 1 Zerodha + 1 Angel + 1 Dhan may share an IP, never 2 Zerodha) |
| Broker order | Kite (Zerodha) → OANDA → Angel/Dhan |
| Architecture | Unified `BrokerGateway` abstraction, per-broker adapters |

## 3. Architecture

### 3.1 BrokerGateway

`packages/broker-gateway` (or `apps/api/src/broker/`): one interface, per-broker adapters.

```ts
interface BrokerGateway {
  broker: 'kite' | 'oanda' | ...;
  validate(creds): Promise<AccountMeta>;          // used by the connect wizard
  placeOrder(o: OrderIntent, egress?: ProxyUrl): Promise<BrokerOrderRef>;
  modifyOrder(ref, changes, egress?): Promise<BrokerOrderRef>;
  cancelOrder(ref, egress?): Promise<void>;
  getOrders(): Promise<BrokerOrder[]>;
  getPositions(): Promise<BrokerPosition[]>;
  exitPosition(p, egress?): Promise<BrokerOrderRef>;
}
```

- **Read plane** (quotes/candles/WS/positions/holdings/order status): main VM IP — brokers do not
  IP-restrict reads. Reuses the existing `kite.ts`/`oanda.ts` data providers per-user.
- **Write plane** (place/modify/cancel/exit): routed through the user's **assigned egress IP**
  via undici `ProxyAgent`. Only this tiny path pays the IP cost.
- The existing read-only lock in `packages/market-data/src/providers/kite.ts` STAYS. Order
  endpoints live in the new gateway module only — a deliberate, separate, audited code path.

### 3.2 Egress IP pool (the SEBI-compliant smart pivot)

- `egress_ips` (id, ip, proxy_url encrypted, source: vm|proxy|vps, region, status, created_at)
- `ip_assignments` (id, egress_ip_id, broker, user_id, created_at, **UNIQUE(egress_ip_id, broker)**)
  — the DB constraint itself enforces "never two same-broker clients on one IP".
- Allocation = bin-packing: new Zerodha user → first IP with a free *Zerodha* slot (may already
  serve an Angel user) → else provision/require a new IP.
- Sources by cost: main VM IP ($0, slot 1 per broker) → dedicated datacenter proxies (~$1–2.5/mo)
  → tiny VPS (~€3.8/mo). Admin adds IPs manually first; provider-API auto-provisioning later.
- Onboarding: after connect, show the user THEIR assigned IP + a guided "whitelist this IP in your
  broker console" step. Order endpoints are blocked until they confirm.
- Unit economics: worst case ~$1.5–4/mo per same-broker paying user → 74–90% gross margin at $15.

### 3.3 Data model (new tables)

- `broker_connections` (id, user_id, broker, api_key, api_secret ENC, access_token ENC,
  status: pending|active|expired|error, account_meta JSON, last_login_at, created_at, updated_at)
- `broker_headless_credentials` (user_id+broker PK, login_id ENC, password ENC, totp_secret ENC,
  risk_ack_at, risk_ack_text) — separate table, stricter access, only for explicit opt-ins
- `broker_orders` — immutable audit: every intent, request, response, error (id, user_id, broker,
  connection_id, intent JSON, broker_order_id, status, placed_via: manual|alert|indicator,
  egress_ip, created_at)
- `egress_ips`, `ip_assignments` (above)
- `users` gains `plan` ('free'|'pro'), `plan_expires_at` (admin-managed)

All secrets AES-256-GCM under the existing `ENCRYPTION_KEY`; client only ever sees last-4.

### 3.4 API surface (all zod-validated, plan-gated, ownership-checked)

- `POST /api/broker/connect` · `GET /api/broker/connections` · `DELETE /api/broker/connections/:id`
- `POST /api/broker/reconnect` (daily token refresh; request-token exchange)
- `POST /api/broker/orders` (place) · `PUT /api/broker/orders/:id` · `DELETE /api/broker/orders/:id`
- `GET /api/broker/orders` · `GET /api/broker/positions` · `POST /api/broker/positions/exit`
- `GET/POST /api/admin/*` (role='admin' only): users, plan toggle, egress pool, kill-switch
- WS: order/position update events pushed to the owning user's sockets only

### 3.5 Trading UI

- Top-bar **Buy/Sell** buttons (visible when a broker is connected + symbol is that broker's) +
  right-rail **Trade** tab.
- Ticket: side, qty, market/limit/SL/SL-M, product (MIS/CNC/NRML), confirm dialog (est. margin).
- **Positions** panel: live P&L off the user's own feed, one-click Exit (confirm-gated).
- **Orders** panel: open/executed/cancelled; modify + cancel.
- Order fills render as chart marks. Errors surface verbatim from the broker (never swallowed).
- Kill-switch: reuse the dd-breaker pattern; a tripped breaker blocks *automated* orders.

### 3.6 Automation

- Scanner: user's broker instrument list as a scan universe (plan-gated).
- Alerts: existing engine untouched for delivery; NEW additive action type `broker_order` on an
  alert → routes through the same `/api/broker/orders` pipeline (audited, rate-limited, capped by
  per-user max-trades/day + the kill-switch). PulseScript `alert()` bridge rides the same path.
- Telegram: daily 9:00 IST "reconnect your broker" nudge (one-tap link) for users with active
  connections; order-fill notifications.

### 3.7 Security & compliance hard rules

1. Never break the live 48/144 alerts or the MT5 engine — all changes ADDITIVE.
2. Broker data is **never** fanned out across users (per-user feeds only) — no redistribution.
3. Data-provider read-only lock stays; order code lives only in the gateway module.
4. Secrets encrypted at rest, never in chat/git/logs; headless creds in the stricter table.
5. Every order attempt lands in `broker_orders` (immutable audit) BEFORE hitting the broker.
6. Plan + ownership checked server-side on every trading endpoint; per-user rate limits.
7. UI shows honest user-side costs (₹500/mo Kite data) and the daily-token reality.

## 4. Build order — one increment per 5-hour loop cycle (test → deploy → verify → next)

1. **GW-1**: BrokerGateway interface + Kite adapter (validate/orders/positions) + `broker_connections`
   + encryption helpers. Tested against the owner's `.env` creds (`KITE_API_KEY/SECRET/ACCESS_TOKEN`).
2. **GW-2**: Kite connect wizard (clone OANDA wizard) + daily one-tap reconnect + token-expiry UX.
3. **GW-3**: Trade tab — place/modify/cancel + Positions/Orders panels, browser-verified end-to-end
   with the owner's account (1-qty limit order far from market, then cancelled).
   **Interim gate:** until GW-4 ships, ALL broker endpoints (connect + trading) are restricted to
   `role='admin'` — no non-owner exposure of ungated trading in production.
4. **GW-4**: Plan gating (`users.plan`) + `/admin` panel (activate users, view connections/orders).
5. **GW-5**: Egress IP pool (tables, bin-packing allocator, ProxyAgent write-plane routing, admin
   pool management, user whitelist-onboarding step).
6. **GW-6**: Per-user broker charts — the user's Kite feed drives the chart/watchlists (KITE: symbols).
7. **GW-7**: Alert→order automation (additive `broker_order` action + caps + kill-switch) + Telegram
   reconnect nudge + fill notifications.
8. **GW-8**: OANDA trading adapter (same interface; no IP constraint) — forex BYOB complete.
9. **GW-9**: Headless auto-login opt-in worker (risk acknowledgment + encrypted creds + morning
   login replay + failure alerts). LAST because custody risk is highest.
10. **GW-10**: Scanner-on-broker-universe + polish + beta hardening (rate limits, load, docs).

Each increment: typecheck → vitest (new units) → full suite → browser-verify → commit → deploy to
VM → verify live → tick this list + STATUS.md.

## 5. Testing protocol (owner's credentials)

- Creds live ONLY in `.env` (local) / VM `.env` — never chat, never git (both gitignored).
- Order tests use 1-qty limit orders far from market price, cancelled immediately, ideally
  off-market-hours; every live-order test is announced in the increment's verification notes.
- The owner may revoke the API key at any time; nothing else stores it.

## 6. Success criteria

- A paying user can: connect Zerodha in <3 min → whitelist their assigned IP → see their charts →
  place/modify/cancel/exit from the chart → get Telegram alerts → (opt-in) auto-trade an indicator.
- Owner can activate a user + assign an IP slot in <1 min from /admin.
- Zero cross-user data leakage; zero orders without an audit row; suite green throughout.
