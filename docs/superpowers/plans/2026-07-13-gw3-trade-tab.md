# GW-3: Trade tab — place / modify / cancel + Positions / Orders panels

> **For agentic workers:** strict TDD, small commits, one task at a time. Steps use checkbox
> (`- [ ]`) syntax for tracking. Spec: `docs/superpowers/specs/2026-07-13-byob-broker-platform-design.md` §3.4–§3.5, §4 GW-3.

**Goal:** Wire the already-built `KiteGateway` + encrypted store into a live trading surface — the
broker order pipeline (place/modify/cancel/orders/positions/exit) behind zod-validated,
**admin-gated** (interim, until GW-4), ownership-checked routes that write an immutable audit row
BEFORE hitting the broker; and a right-rail **Trade** tab that places orders, lists open orders
(cancel/modify) and positions (one-click exit, confirm-gated), surfacing every broker error verbatim.

**Architecture:**
- Backend: new pure `apps/api/src/broker/order-intent.ts` (zod schema + `validateOrderIntent`), and 6
  new endpoints appended to the existing `apps/api/src/routes/broker.ts` with an **injectable
  `gatewayFactory`** (default builds a real `KiteGateway` from decrypted creds; tests inject a stub).
- Frontend: new `apps/web/features/terminal/broker-trade-panel.tsx` rendered inside the existing
  right-rail Trade tab when the active symbol is a `KITE:` symbol AND the user is admin (else the
  existing MT5 `OrderPanel` stays). Pure `apps/web/lib/broker-symbol.ts` for `KITE:NSE:PART` parsing.

**Global constraints (from the spec — every task):**
- ADDITIVE ONLY. Never touch the alert engine, MT5 bridge, or the read-only kite data provider.
- Order code lives ONLY in `apps/api/src/broker/` + `routes/broker.ts`. Reads (orders/positions) use
  the main VM IP; the write plane's egress-IP routing is GW-5 — pass `egressIp: null` for now.
- Every place/modify/cancel/exit records a `broker_orders` audit row BEFORE the broker call (hard rule 5).
- Broker errors surface verbatim (`${error_type}: ${message}`) — never swallowed.
- ALL broker endpoints stay `requireAdmin` (401 anon / 403 non-admin) until GW-4.
- Tests live in `tests/`, import by relative source path, run `pnpm vitest run <file>`.
- Live order tests: only the approved safe probe (1-qty far-limit / ₹1 AMO, cancelled immediately).
  If the daily token is stale (TokenException), skip the live probe and note it in STATUS.

---

### Task 1: Order-intent validation (pure)

**Files:**
- Create: `apps/api/src/broker/order-intent.ts`
- Test: `tests/broker-order-intent.test.ts`

**Interfaces:**
- Produces: `orderIntentSchema` (zod) and `validateOrderIntent(raw: unknown): { ok: true; intent: OrderIntent } | { ok: false; error: string }`.
- Rules: `quantity` integer ≥ 1; `limit` requires `price > 0`; `sl` requires both `price > 0` and `triggerPrice > 0`; `sl-m` requires `triggerPrice > 0`; `market` ignores price/trigger. Also `modifyChangesSchema` for PUT (partial: quantity/price/triggerPrice/orderType) and a `varietySchema` (`regular`|`amo`).

- [ ] **Step 1: Failing test**

```ts
// tests/broker-order-intent.test.ts
import { describe, expect, it } from 'vitest';
import { validateOrderIntent } from '../apps/api/src/broker/order-intent';

const base = { symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, product: 'mis' };

describe('validateOrderIntent', () => {
  it('accepts a market order and defaults variety/validity', () => {
    const r = validateOrderIntent({ ...base, orderType: 'market' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.intent).toMatchObject({ symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'market', product: 'mis' });
  });
  it('requires a price for limit orders', () => {
    expect(validateOrderIntent({ ...base, orderType: 'limit' }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'limit', price: 700 }).ok).toBe(true);
  });
  it('requires a trigger for sl-m and both price+trigger for sl', () => {
    expect(validateOrderIntent({ ...base, orderType: 'sl-m' }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'sl-m', triggerPrice: 690 }).ok).toBe(true);
    expect(validateOrderIntent({ ...base, orderType: 'sl', triggerPrice: 690 }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'sl', price: 700, triggerPrice: 690 }).ok).toBe(true);
  });
  it('rejects non-positive / non-integer quantity and bad enums', () => {
    expect(validateOrderIntent({ ...base, orderType: 'market', quantity: 0 }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'market', quantity: 1.5 }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'market', product: 'xxx' }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'weird' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2:** `pnpm vitest run tests/broker-order-intent.test.ts` → FAIL (cannot resolve).

- [ ] **Step 3: Implement** `order-intent.ts` — zod enums matching `OrderIntent`, `.superRefine` for the price/trigger rules, return `{ ok, intent }` / `{ ok:false, error }` (first zod issue message). Also export `modifyChangesSchema`, `varietySchema`.

- [ ] **Step 4:** run → 4 passed.

- [ ] **Step 5: Commit** `feat(broker): order-intent zod validation (GW-3)`

---

### Task 2: Trading routes (place/modify/cancel/orders/positions/exit)

**Files:**
- Modify: `apps/api/src/broker/store.ts` (broaden `recordOrderAudit` intent type to `OrderIntent | Record<string, unknown>` so modify/cancel actions can be audited — no behaviour change)
- Modify: `apps/api/src/routes/broker.ts` (append 6 endpoints + `BrokerGatewayFactory` injection)
- Modify: `apps/api/src/main.ts` (no signature change needed — default factory)
- Test: `tests/broker-trade-routes.test.ts`

**Interfaces:**
- `export type BrokerGatewayFactory = (creds: { apiKey: string; accessToken: string }) => BrokerGateway;`
- `brokerRoutes(fastify, db, ingestion?, gatewayFactory: BrokerGatewayFactory = defaultKiteFactory)`.
- Endpoints (all `requireAdmin`, broker fixed to `kite` for GW-3):
  - `POST /api/broker/orders` — body = OrderIntent. `getGatewayCredentials`; no active token → `409 token_expired`. `recordOrderAudit(placedVia:'manual', egressIp:null)` → `gw.placeOrder` → `completeOrderAudit`. Success `{ ok:true, brokerOrderId, auditId }`; broker error → `502 { error:'broker_rejected', message }` + audit `status:'rejected', error`.
  - `PUT /api/broker/orders/:id` — body `{ changes, variety? }` → audit `{ action:'modify', brokerOrderId, changes }` → `gw.modifyOrder`.
  - `DELETE /api/broker/orders/:id?variety=` → audit `{ action:'cancel', brokerOrderId }` → `gw.cancelOrder`.
  - `GET /api/broker/orders` → `{ items: gw.getOrders() }` (no audit; read).
  - `GET /api/broker/positions` → `{ items: gw.getPositions() }`.
  - `POST /api/broker/positions/exit` — body = a BrokerPosition → derive the closing OrderIntent, audit it, `gw.exitPosition`.
- A shared `withGateway(user, reply, fn)` helper: loads creds, 409 if no token, builds the gateway, runs `fn`, and maps thrown broker errors to `502 { error:'broker_rejected', message }`.

- [ ] **Step 1: Failing test** (Fastify inject + stub factory; mirrors `tests/kite-market-routes.test.ts`)

```ts
// tests/broker-trade-routes.test.ts
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { brokerRoutes, type BrokerGatewayFactory } from '../apps/api/src/routes/broker';
import { openDB } from '../apps/api/src/db';
import { saveConnection, updateAccessToken } from '../apps/api/src/broker/store';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Fastify = apiRequire('fastify').default as typeof import('fastify').default;
const cookie = apiRequire('@fastify/cookie');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'e'.repeat(64);
const dir = mkdtempSync(join(tmpdir(), 'sc-trade-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let placed: unknown[] = [];
const stubFactory: BrokerGatewayFactory = () => ({
  broker: 'kite',
  validate: async () => ({ accountId: 'AB1', name: 'T', broker: 'kite' }),
  placeOrder: async (intent) => { placed.push(intent); return { brokerOrderId: 'OID1' }; },
  modifyOrder: async (id) => ({ brokerOrderId: id }),
  cancelOrder: async () => {},
  getOrders: async () => [{ brokerOrderId: 'OID1', symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, filledQuantity: 0, orderType: 'LIMIT', product: 'MIS', price: 700, triggerPrice: null, status: 'OPEN', statusMessage: null, placedAt: '', variety: 'regular' }],
  getPositions: async () => [{ symbol: 'INFY', exchange: 'NSE', product: 'MIS', quantity: -10, averagePrice: 1500, lastPrice: 1495, pnl: 50 }],
  exitPosition: async () => ({ brokerOrderId: 'OID2' }),
});

function appWith(db: ReturnType<typeof openDB>, factory = stubFactory) {
  const app = Fastify();
  app.register(cookie);
  brokerRoutes(app, db, undefined, factory);
  return app;
}
function seedAdminConnection(db: ReturnType<typeof openDB>) {
  db.raw.prepare("UPDATE users SET role='admin' WHERE id='demo'").run();
  saveConnection(db, { userId: 'demo', broker: 'kite', apiKey: 'k1', apiSecret: 's1', accessToken: null, accountMeta: null });
  updateAccessToken(db, 'demo', 'kite', 'tok');
}

describe('broker trade routes', () => {
  beforeEach(() => { placed = []; });

  it('anon → 401, non-admin → 403', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'gate.sqlite')}` } as NodeJS.ProcessEnv);
    const prev = process.env.AUTH_ENABLED; delete process.env.AUTH_ENABLED;
    const anon = appWith(db);
    expect((await anon.inject({ method: 'GET', url: '/api/broker/orders' })).statusCode).toBe(401);
    await anon.close();
    process.env.AUTH_ENABLED = '0'; // demo user resolves, role='user'
    const nonAdmin = appWith(db);
    expect((await nonAdmin.inject({ method: 'GET', url: '/api/broker/orders' })).statusCode).toBe(403);
    await nonAdmin.close();
    if (prev === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prev;
  });

  it('places an order, audits BEFORE the broker, surfaces id', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'place.sqlite')}` } as NodeJS.ProcessEnv);
    seedAdminConnection(db);
    const prev = process.env.AUTH_ENABLED; process.env.AUTH_ENABLED = '0';
    const app = appWith(db);
    const res = await app.inject({ method: 'POST', url: '/api/broker/orders', payload: { symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'limit', product: 'mis', price: 700 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, brokerOrderId: 'OID1' });
    expect(placed).toHaveLength(1);
    const audit = db.raw.prepare("SELECT status, broker_order_id as bid, placed_via FROM broker_orders WHERE user_id='demo'").get() as { status: string; bid: string; placed_via: string };
    expect(audit).toMatchObject({ status: 'placed', bid: 'OID1', placed_via: 'manual' });
    await app.close();
    if (prev === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prev;
  });

  it('rejects an invalid intent (limit without price) with 400 and no broker call', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'bad.sqlite')}` } as NodeJS.ProcessEnv);
    seedAdminConnection(db);
    const prev = process.env.AUTH_ENABLED; process.env.AUTH_ENABLED = '0';
    const app = appWith(db);
    const res = await app.inject({ method: 'POST', url: '/api/broker/orders', payload: { symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'limit', product: 'mis' } });
    expect(res.statusCode).toBe(400);
    expect(placed).toHaveLength(0);
    await app.close();
    if (prev === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prev;
  });

  it('409 when connected but the daily token is missing', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'notok.sqlite')}` } as NodeJS.ProcessEnv);
    db.raw.prepare("UPDATE users SET role='admin' WHERE id='demo'").run();
    saveConnection(db, { userId: 'demo', broker: 'kite', apiKey: 'k1', apiSecret: 's1', accessToken: null, accountMeta: null });
    const prev = process.env.AUTH_ENABLED; process.env.AUTH_ENABLED = '0';
    const app = appWith(db);
    const res = await app.inject({ method: 'GET', url: '/api/broker/orders' });
    expect(res.statusCode).toBe(409);
    await app.close();
    if (prev === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prev;
  });

  it('surfaces broker errors verbatim as 502 and audits the rejection', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'err.sqlite')}` } as NodeJS.ProcessEnv);
    seedAdminConnection(db);
    const prev = process.env.AUTH_ENABLED; process.env.AUTH_ENABLED = '0';
    const failing: BrokerGatewayFactory = () => ({ ...stubFactory({ apiKey: 'k', accessToken: 't' }), placeOrder: async () => { throw new Error('InputException: Missing field.'); } });
    const app = appWith(db, failing);
    const res = await app.inject({ method: 'POST', url: '/api/broker/orders', payload: { symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'market', product: 'mis' } });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toContain('InputException');
    const audit = db.raw.prepare("SELECT status, error FROM broker_orders WHERE user_id='demo'").get() as { status: string; error: string };
    expect(audit.status).toBe('rejected');
    expect(audit.error).toContain('InputException');
    await app.close();
    if (prev === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prev;
  });

  it('lists orders/positions and exits a position', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'read.sqlite')}` } as NodeJS.ProcessEnv);
    seedAdminConnection(db);
    const prev = process.env.AUTH_ENABLED; process.env.AUTH_ENABLED = '0';
    const app = appWith(db);
    expect((await app.inject({ method: 'GET', url: '/api/broker/orders' })).json().items[0].brokerOrderId).toBe('OID1');
    expect((await app.inject({ method: 'GET', url: '/api/broker/positions' })).json().items[0].symbol).toBe('INFY');
    const exit = await app.inject({ method: 'POST', url: '/api/broker/positions/exit', payload: { symbol: 'INFY', exchange: 'NSE', product: 'MIS', quantity: -10, averagePrice: 1500, lastPrice: 1495, pnl: 50 } });
    expect(exit.statusCode).toBe(200);
    expect(exit.json().brokerOrderId).toBe('OID2');
    await app.close();
    if (prev === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prev;
  });
});
```

- [ ] **Step 2:** run → FAIL (routes/factory not exported).

- [ ] **Step 3: Implement** — broaden `recordOrderAudit`; add `BrokerGatewayFactory`, `defaultKiteFactory`, `withGateway` helper, and the 6 endpoints in `routes/broker.ts`. `completeOrderAudit(status:'placed'|'modified'|'cancelled'|'exited'|'rejected')`.

- [ ] **Step 4:** run → 6 passed. Also re-run `pnpm vitest run tests/broker-store.test.ts` (unchanged) + `tests/kite-market-routes.test.ts`.

- [ ] **Step 5:** `pnpm -F @supercharts/api typecheck`; commit `feat(broker): trading routes place/modify/cancel/orders/positions/exit (GW-3)`.

---

### Task 3: Trade tab UI (broker ticket + orders/positions)

**Files:**
- Create: `apps/web/lib/broker-symbol.ts` (pure) + `tests/broker-symbol.test.ts`
- Create: `apps/web/features/terminal/broker-trade-panel.tsx`
- Modify: `apps/web/features/terminal/right-rail.tsx` (Trade tab: admin + `KITE:` symbol → `BrokerTradePanel`, else existing `OrderPanel`)

**Interfaces:**
- `parseBrokerSymbol(symbolId: string): { broker: 'kite'; exchange: string; tradingSymbol: string } | null` — `KITE:NSE:PART` → `{ broker:'kite', exchange:'NSE', tradingSymbol: PART.replace(/_/g,' ') }`; non-KITE → null.
- `BrokerTradePanel({ pane })`: fetches `/broker/connections` (kite active?), renders a ticket (Buy/Sell, qty, Market/Limit/SL/SL-M, product MIS/CNC/NRML, price/trigger when needed), a confirm dialog (side · qty · type · symbol), POSTs `/broker/orders`; lists `/broker/orders` (cancel via DELETE, modify price via PUT) and `/broker/positions` (Exit via POST /positions/exit, confirm-gated). Refresh on submit + a 5s poll. Broker error text shown verbatim.

- [ ] **Step 1: Failing test** for `parseBrokerSymbol`

```ts
// tests/broker-symbol.test.ts
import { describe, expect, it } from 'vitest';
import { parseBrokerSymbol } from '../apps/web/lib/broker-symbol';
describe('parseBrokerSymbol', () => {
  it('parses a KITE equity id', () => {
    expect(parseBrokerSymbol('KITE:NSE:RELIANCE')).toEqual({ broker: 'kite', exchange: 'NSE', tradingSymbol: 'RELIANCE' });
  });
  it('restores spaces from canonical underscores', () => {
    expect(parseBrokerSymbol('KITE:NFO:NIFTY_50')).toEqual({ broker: 'kite', exchange: 'NFO', tradingSymbol: 'NIFTY 50' });
  });
  it('returns null for non-broker symbols', () => {
    expect(parseBrokerSymbol('BINANCE:BTCUSDT')).toBeNull();
    expect(parseBrokerSymbol('OANDA:EUR_USD')).toBeNull();
  });
});
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement `broker-symbol.ts`. **Step 4:** run → 3 passed.

- [ ] **Step 5: Build** `BrokerTradePanel` (reuse `Button`/`Input`/`Badge`/`Dialog`/`Tabs`/`Switch` primitives + `toast`; match `order-panel.tsx` styling). Wire the Trade tab in `right-rail.tsx`:

```tsx
const { user } = useSession();
const isKite = activePane.symbol.startsWith('KITE:');
// inside TabsContent value="trade":
{user?.role === 'admin' && isKite ? <BrokerTradePanel pane={activePane} /> : <OrderPanel pane={activePane} />}
```

- [ ] **Step 6:** `pnpm -F @supercharts/web typecheck`; commit `feat(broker): right-rail Trade tab — Kite ticket + orders/positions (GW-3)`.

---

### Task 4: Full gate + browser verify + deploy + STATUS

- [ ] **Step 1:** `pnpm vitest run && pnpm -F @supercharts/api typecheck && pnpm -F @supercharts/web typecheck` — all green (603 + ~13 new).
- [ ] **Step 2: Browser verify** on local dev (`api`/`web` from `.claude/launch.json`): sign in as the owner/admin, open a `KITE:` symbol, confirm the Trade tab shows the broker ticket (honest "connect/reconnect" state if the token is stale), the confirm dialog renders, and a rejected/insufficient-token order surfaces the broker message verbatim. Screenshot. (No live order unless the token is fresh AND a safe far-limit probe — otherwise note the skip.)
- [ ] **Step 3: Live read/write probe** (optional): `cd apps/api && pnpm tsx scripts/verify-kite-gw1.ts` — if `TokenException`, skip live order verification and note it in STATUS.
- [ ] **Step 4: Deploy** — `git push origin main`; on VM `git pull --ff-only && pnpm -F @supercharts/web build && pm2 restart all --update-env`; verify `https://supercharting.com/` 200 + `/api/health` ok:true + binance connected + `/api/broker/orders` → 401 anon.
- [ ] **Step 5: STATUS** — add the GW-3 Done row with REAL numbers; tick the spec §4 GW-3 box; commit + push `docs(status): GW-3 trade tab landed + verified`.
