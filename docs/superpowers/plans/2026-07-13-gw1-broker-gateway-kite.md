# GW-1: BrokerGateway + Kite Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `BrokerGateway` abstraction with a working Zerodha Kite adapter (validate, orders, positions), encrypted `broker_connections`/`broker_orders` tables, and a live verification against the owner's credentials — the foundation every later GW increment builds on.

**Architecture:** New `apps/api/src/broker/` module: `types.ts` (interface), `crypto.ts` (AES-256-GCM secret encryption), `kite-gateway.ts` (Kite Connect v3 REST adapter), `store.ts` (DB helpers). Two new tables in `db.ts` migrate(). NO routes and NO UI this increment (GW-2/3); nothing existing changes behavior.

**Tech Stack:** Node 22 `fetch` (no new deps), `node:crypto`, `node:sqlite` via the existing `AppDB` wrapper, zod at route-time later, Vitest with stubbed fetch.

## Global Constraints (from the spec — apply to every task)

- ADDITIVE ONLY: never touch the alert engine, MT5 bridge, or existing providers' behavior.
- The read-only lock in `packages/market-data/src/providers/kite.ts` STAYS. Order code lives ONLY in `apps/api/src/broker/`.
- Secrets: never in chat/git/logs; encrypted at rest with `ENCRYPTION_KEY` (AES-256-GCM); client sees last-4 only (route layer, GW-2).
- Kite REST specifics: base `https://api.kite.trade`, headers `X-Kite-Version: 3` + `Authorization: token <api_key>:<access_token>`; request bodies are **form-encoded** (never JSON); responses are `{ status: 'success', data: … }` or `{ status: 'error', message, error_type }`.
- Tests live in `tests/`, import by relative source path, run with `pnpm vitest run <file>`.
- Live order tests: 1-qty LIMIT far from market (or AMO when market closed), cancelled immediately, always announced.

---

### Task 1: Secret encryption helpers

**Files:**
- Create: `apps/api/src/broker/crypto.ts`
- Test: `tests/broker-crypto.test.ts`

**Interfaces:**
- Produces: `encryptSecret(plain: string, keyHex?: string): string` (format `v1$<ivHex>$<tagHex>$<cipherHex>`), `decryptSecret(stored: string, keyHex?: string): string`. `keyHex` defaults to `process.env.ENCRYPTION_KEY`. Throws `Error('encryption_key_missing')` when no key, `Error('decrypt_failed')` on tamper/wrong key.

- [ ] **Step 1: Write the failing test**

```ts
// tests/broker-crypto.test.ts
import { describe, expect, it } from 'vitest';
import { encryptSecret, decryptSecret } from '../apps/api/src/broker/crypto';

const KEY = 'a'.repeat(64); // 32-byte hex test key

describe('broker secret encryption', () => {
  it('round-trips a secret', () => {
    const stored = encryptSecret('my-api-secret-123', KEY);
    expect(stored.startsWith('v1$')).toBe(true);
    expect(stored).not.toContain('my-api-secret-123');
    expect(decryptSecret(stored, KEY)).toBe('my-api-secret-123');
  });

  it('produces a different ciphertext each call (fresh IV)', () => {
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY));
  });

  it('fails loudly on tamper or wrong key', () => {
    const stored = encryptSecret('secret', KEY);
    const tampered = stored.slice(0, -2) + (stored.endsWith('00') ? '11' : '00');
    expect(() => decryptSecret(tampered, KEY)).toThrow('decrypt_failed');
    expect(() => decryptSecret(stored, 'b'.repeat(64))).toThrow('decrypt_failed');
  });

  it('requires a key', () => {
    const prev = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrow('encryption_key_missing');
    if (prev !== undefined) process.env.ENCRYPTION_KEY = prev;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/broker-crypto.test.ts`
Expected: FAIL — cannot resolve `../apps/api/src/broker/crypto`

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/broker/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * At-rest encryption for broker secrets (api_secret, access_token, headless creds).
 * AES-256-GCM under ENCRYPTION_KEY (64-char hex → 32 bytes). Stored format:
 *   v1$<ivHex>$<authTagHex>$<cipherHex>
 * GCM authenticates: any tamper or wrong key throws `decrypt_failed` instead of
 * returning garbage.
 */
function keyBuffer(keyHex = process.env.ENCRYPTION_KEY): Buffer {
  if (!keyHex || keyHex.length < 64) throw new Error('encryption_key_missing');
  return Buffer.from(keyHex.slice(0, 64), 'hex');
}

export function encryptSecret(plain: string, keyHex?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1$${iv.toString('hex')}$${cipher.getAuthTag().toString('hex')}$${enc.toString('hex')}`;
}

export function decryptSecret(stored: string, keyHex?: string): string {
  const [version, ivHex, tagHex, dataHex] = stored.split('$');
  if (version !== 'v1' || !ivHex || !tagHex || !dataHex) throw new Error('decrypt_failed');
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBuffer(keyHex), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof Error && err.message === 'encryption_key_missing') throw err;
    throw new Error('decrypt_failed');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/broker-crypto.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/broker/crypto.ts tests/broker-crypto.test.ts
git commit -m "feat(broker): AES-256-GCM secret encryption helpers (GW-1)"
```

---

### Task 2: BrokerGateway types + Kite adapter (reads + token exchange)

**Files:**
- Create: `apps/api/src/broker/types.ts`
- Create: `apps/api/src/broker/kite-gateway.ts`
- Test: `tests/kite-gateway.test.ts`

**Interfaces:**
- Produces (`types.ts`):

```ts
export type BrokerId = 'kite' | 'oanda';
export interface AccountMeta { accountId: string; name: string; email?: string; broker: BrokerId; }
export interface OrderIntent {
  symbol: string;            // trading symbol, e.g. 'RELIANCE'
  exchange: string;          // 'NSE' | 'BSE' | 'NFO' | 'MCX' …
  side: 'buy' | 'sell';
  quantity: number;
  orderType: 'market' | 'limit' | 'sl' | 'sl-m';
  product: 'mis' | 'cnc' | 'nrml';
  price?: number;            // required for limit / sl
  triggerPrice?: number;     // required for sl / sl-m
  variety?: 'regular' | 'amo';
  validity?: 'day' | 'ioc';
}
export interface BrokerOrderRef { brokerOrderId: string; }
export interface BrokerOrder {
  brokerOrderId: string; symbol: string; exchange: string; side: 'buy' | 'sell';
  quantity: number; filledQuantity: number; orderType: string; product: string;
  price: number | null; triggerPrice: number | null;
  status: string;            // broker-native status string, passed through honestly
  statusMessage: string | null; placedAt: string; variety: string;
}
export interface BrokerPosition {
  symbol: string; exchange: string; product: string; quantity: number;  // signed: + long, − short
  averagePrice: number; lastPrice: number; pnl: number;
}
export interface BrokerGateway {
  broker: BrokerId;
  validate(): Promise<AccountMeta>;
  placeOrder(intent: OrderIntent): Promise<BrokerOrderRef>;
  modifyOrder(brokerOrderId: string, changes: Partial<Pick<OrderIntent, 'quantity' | 'price' | 'triggerPrice' | 'orderType'>>, variety?: string): Promise<BrokerOrderRef>;
  cancelOrder(brokerOrderId: string, variety?: string): Promise<void>;
  getOrders(): Promise<BrokerOrder[]>;
  getPositions(): Promise<BrokerPosition[]>;
  exitPosition(position: BrokerPosition): Promise<BrokerOrderRef>;
}
```

- Produces (`kite-gateway.ts`): `class KiteGateway implements BrokerGateway` with `constructor(opts: { apiKey: string; accessToken: string; fetchFn?: typeof fetch; proxyDispatcher?: unknown })` and `static exchangeRequestToken(apiKey: string, apiSecret: string, requestToken: string, fetchFn?: typeof fetch): Promise<{ accessToken: string; meta: AccountMeta }>`.
- Kite endpoint mapping: validate → `GET /user/profile`; orders list → `GET /orders`; positions → `GET /portfolio/positions` (use `data.net`); token exchange → `POST /session/token` with `api_key`, `request_token`, `checksum = sha256(api_key + request_token + api_secret)`.

- [ ] **Step 1: Write the failing tests (reads + auth + error surface)**

```ts
// tests/kite-gateway.test.ts
import { describe, expect, it } from 'vitest';
import { KiteGateway } from '../apps/api/src/broker/kite-gateway';

function stubFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return new Response(JSON.stringify({ status: 'error', message: 'no stub' }), { status: 404 });
    return new Response(JSON.stringify(hit[1].body), { status: hit[1].status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

describe('KiteGateway reads', () => {
  it('validate() maps /user/profile and sends the Kite auth header', async () => {
    const { fn, calls } = stubFetch({
      '/user/profile': { body: { status: 'success', data: { user_id: 'AB1234', user_name: 'Test Trader', email: 't@x.com' } } },
    });
    const gw = new KiteGateway({ apiKey: 'key1', accessToken: 'tok1', fetchFn: fn });
    const meta = await gw.validate();
    expect(meta).toEqual({ accountId: 'AB1234', name: 'Test Trader', email: 't@x.com', broker: 'kite' });
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('token key1:tok1');
    expect(headers['X-Kite-Version']).toBe('3');
  });

  it('surfaces Kite errors verbatim (never swallowed)', async () => {
    const { fn } = stubFetch({
      '/user/profile': { status: 403, body: { status: 'error', message: 'Incorrect `api_key` or `access_token`.', error_type: 'TokenException' } },
    });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 'bad', fetchFn: fn });
    await expect(gw.validate()).rejects.toThrow('TokenException: Incorrect `api_key` or `access_token`.');
  });

  it('getPositions maps data.net with signed quantities', async () => {
    const { fn } = stubFetch({
      '/portfolio/positions': { body: { status: 'success', data: { net: [
        { tradingsymbol: 'RELIANCE', exchange: 'NSE', product: 'MIS', quantity: 5, average_price: 2900.5, last_price: 2910, pnl: 47.5 },
        { tradingsymbol: 'INFY', exchange: 'NSE', product: 'MIS', quantity: -10, average_price: 1500, last_price: 1495, pnl: 50 },
      ] } } },
    });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    const pos = await gw.getPositions();
    expect(pos).toHaveLength(2);
    expect(pos[0]).toEqual({ symbol: 'RELIANCE', exchange: 'NSE', product: 'MIS', quantity: 5, averagePrice: 2900.5, lastPrice: 2910, pnl: 47.5 });
    expect(pos[1]!.quantity).toBe(-10);
  });

  it('getOrders maps the broker-native status through honestly', async () => {
    const { fn } = stubFetch({
      '/orders': { body: { status: 'success', data: [
        { order_id: '151220000000000', tradingsymbol: 'SBIN', exchange: 'NSE', transaction_type: 'BUY', quantity: 1,
          filled_quantity: 0, order_type: 'LIMIT', product: 'MIS', price: 700, trigger_price: 0,
          status: 'OPEN', status_message: null, order_timestamp: '2026-07-13 10:00:00', variety: 'regular' },
      ] } },
    });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    const orders = await gw.getOrders();
    expect(orders[0]).toMatchObject({ brokerOrderId: '151220000000000', symbol: 'SBIN', side: 'buy', status: 'OPEN', price: 700 });
  });

  it('exchangeRequestToken posts the sha256 checksum form-encoded', async () => {
    const { fn, calls } = stubFetch({
      '/session/token': { body: { status: 'success', data: { access_token: 'newtok', user_id: 'AB1234', user_name: 'Test Trader' } } },
    });
    const out = await KiteGateway.exchangeRequestToken('key1', 'sec1', 'req1', fn);
    expect(out.accessToken).toBe('newtok');
    expect(out.meta.accountId).toBe('AB1234');
    const body = String(calls[0]!.init!.body);
    expect(body).toContain('api_key=key1');
    expect(body).toContain('request_token=req1');
    expect(body).toMatch(/checksum=[0-9a-f]{64}/);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['content-type']).toContain('application/x-www-form-urlencoded');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/kite-gateway.test.ts`
Expected: FAIL — cannot resolve `kite-gateway`

- [ ] **Step 3: Write types.ts (verbatim from the Interfaces block above) and kite-gateway.ts**

```ts
// apps/api/src/broker/kite-gateway.ts
import { createHash } from 'node:crypto';
import type {
  AccountMeta, BrokerGateway, BrokerOrder, BrokerOrderRef, BrokerPosition, OrderIntent,
} from './types';

const KITE_REST = 'https://api.kite.trade';

/**
 * Zerodha Kite Connect v3 EXECUTION adapter — the deliberate, separate order path.
 * (The market-data provider in packages/market-data stays read-only by design.)
 * Bodies are form-encoded; responses are { status, data } envelopes; errors are
 * surfaced verbatim as `${error_type}: ${message}` so the UI can show the truth.
 */
export interface KiteGatewayOptions {
  apiKey: string;
  accessToken: string;
  fetchFn?: typeof fetch;
  restEndpoint?: string;
  /** undici ProxyAgent for the egress-IP write plane (GW-5); reads never set it. */
  proxyDispatcher?: unknown;
}

interface KiteEnvelope<T> { status: 'success' | 'error'; data?: T; message?: string; error_type?: string; }

export class KiteGateway implements BrokerGateway {
  public readonly broker = 'kite' as const;
  private readonly fetchFn: typeof fetch;
  private readonly rest: string;

  constructor(private readonly opts: KiteGatewayOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.rest = opts.restEndpoint ?? KITE_REST;
  }

  static async exchangeRequestToken(
    apiKey: string, apiSecret: string, requestToken: string, fetchFn: typeof fetch = fetch,
  ): Promise<{ accessToken: string; meta: AccountMeta }> {
    const checksum = createHash('sha256').update(apiKey + requestToken + apiSecret).digest('hex');
    const res = await fetchFn(`${KITE_REST}/session/token`, {
      method: 'POST',
      headers: { 'X-Kite-Version': '3', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum }).toString(),
    });
    const json = (await res.json()) as KiteEnvelope<{ access_token: string; user_id: string; user_name?: string; email?: string }>;
    if (json.status !== 'success' || !json.data) throw kiteError(json);
    return {
      accessToken: json.data.access_token,
      meta: { accountId: json.data.user_id, name: json.data.user_name ?? json.data.user_id, email: json.data.email, broker: 'kite' },
    };
  }

  async validate(): Promise<AccountMeta> {
    const data = await this.request<{ user_id: string; user_name?: string; email?: string }>('GET', '/user/profile');
    return { accountId: data.user_id, name: data.user_name ?? data.user_id, email: data.email, broker: 'kite' };
  }

  async placeOrder(intent: OrderIntent): Promise<BrokerOrderRef> {
    const variety = intent.variety ?? 'regular';
    const body: Record<string, string> = {
      tradingsymbol: intent.symbol,
      exchange: intent.exchange,
      transaction_type: intent.side.toUpperCase(),
      quantity: String(intent.quantity),
      order_type: intent.orderType.toUpperCase(),
      product: intent.product.toUpperCase(),
      validity: (intent.validity ?? 'day').toUpperCase(),
    };
    if (intent.price !== undefined) body.price = String(intent.price);
    if (intent.triggerPrice !== undefined) body.trigger_price = String(intent.triggerPrice);
    const data = await this.request<{ order_id: string }>('POST', `/orders/${variety}`, body);
    return { brokerOrderId: data.order_id };
  }

  async modifyOrder(
    brokerOrderId: string,
    changes: Partial<Pick<OrderIntent, 'quantity' | 'price' | 'triggerPrice' | 'orderType'>>,
    variety = 'regular',
  ): Promise<BrokerOrderRef> {
    const body: Record<string, string> = {};
    if (changes.quantity !== undefined) body.quantity = String(changes.quantity);
    if (changes.price !== undefined) body.price = String(changes.price);
    if (changes.triggerPrice !== undefined) body.trigger_price = String(changes.triggerPrice);
    if (changes.orderType !== undefined) body.order_type = changes.orderType.toUpperCase();
    const data = await this.request<{ order_id: string }>('PUT', `/orders/${variety}/${brokerOrderId}`, body);
    return { brokerOrderId: data.order_id };
  }

  async cancelOrder(brokerOrderId: string, variety = 'regular'): Promise<void> {
    await this.request<{ order_id: string }>('DELETE', `/orders/${variety}/${brokerOrderId}`);
  }

  async getOrders(): Promise<BrokerOrder[]> {
    const data = await this.request<Array<Record<string, unknown>>>('GET', '/orders');
    return (data ?? []).map((o) => ({
      brokerOrderId: String(o.order_id),
      symbol: String(o.tradingsymbol),
      exchange: String(o.exchange),
      side: String(o.transaction_type).toLowerCase() === 'sell' ? 'sell' as const : 'buy' as const,
      quantity: Number(o.quantity) || 0,
      filledQuantity: Number(o.filled_quantity) || 0,
      orderType: String(o.order_type),
      product: String(o.product),
      price: o.price == null ? null : Number(o.price),
      triggerPrice: o.trigger_price == null ? null : Number(o.trigger_price),
      status: String(o.status),
      statusMessage: o.status_message == null ? null : String(o.status_message),
      placedAt: String(o.order_timestamp ?? ''),
      variety: String(o.variety ?? 'regular'),
    }));
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const data = await this.request<{ net?: Array<Record<string, unknown>> }>('GET', '/portfolio/positions');
    return (data.net ?? []).map((p) => ({
      symbol: String(p.tradingsymbol),
      exchange: String(p.exchange),
      product: String(p.product),
      quantity: Number(p.quantity) || 0,
      averagePrice: Number(p.average_price) || 0,
      lastPrice: Number(p.last_price) || 0,
      pnl: Number(p.pnl) || 0,
    }));
  }

  async exitPosition(position: BrokerPosition): Promise<BrokerOrderRef> {
    if (position.quantity === 0) throw new Error('position_already_flat');
    return this.placeOrder({
      symbol: position.symbol,
      exchange: position.exchange,
      side: position.quantity > 0 ? 'sell' : 'buy',
      quantity: Math.abs(position.quantity),
      orderType: 'market',
      product: position.product.toLowerCase() as OrderIntent['product'],
    });
  }

  private async request<T>(method: string, path: string, body?: Record<string, string>): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        'X-Kite-Version': '3',
        Authorization: `token ${this.opts.apiKey}:${this.opts.accessToken}`,
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
    };
    if (this.opts.proxyDispatcher) (init as Record<string, unknown>).dispatcher = this.opts.proxyDispatcher;
    const res = await this.fetchFn(`${this.rest}${path}`, init);
    const json = (await res.json()) as KiteEnvelope<T>;
    if (json.status !== 'success') throw kiteError(json);
    return json.data as T;
  }
}

function kiteError(json: { message?: string; error_type?: string }): Error {
  return new Error(`${json.error_type ?? 'KiteError'}: ${json.message ?? 'unknown error'}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/kite-gateway.test.ts`
Expected: 5 passed

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm -F @supercharts/api typecheck
git add apps/api/src/broker/types.ts apps/api/src/broker/kite-gateway.ts tests/kite-gateway.test.ts
git commit -m "feat(broker): BrokerGateway interface + Kite execution adapter reads/auth (GW-1)"
```

---

### Task 3: Kite adapter write-path tests (place / modify / cancel / exit)

**Files:**
- Modify: `tests/kite-gateway.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `KiteGateway` from Task 2 (already implements writes — this task pins their wire format with tests).

- [ ] **Step 1: Append the failing-or-passing write tests**

```ts
describe('KiteGateway writes', () => {
  it('placeOrder posts form-encoded fields to /orders/regular', async () => {
    const { fn, calls } = stubFetch({ '/orders/regular': { body: { status: 'success', data: { order_id: 'OID1' } } } });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    const ref = await gw.placeOrder({ symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'limit', product: 'mis', price: 700 });
    expect(ref.brokerOrderId).toBe('OID1');
    const body = String(calls[0]!.init!.body);
    expect(body).toContain('tradingsymbol=SBIN');
    expect(body).toContain('transaction_type=BUY');
    expect(body).toContain('order_type=LIMIT');
    expect(body).toContain('product=MIS');
    expect(body).toContain('price=700');
    expect(calls[0]!.init!.method).toBe('POST');
  });

  it('placeOrder routes AMO variety to /orders/amo', async () => {
    const { fn, calls } = stubFetch({ '/orders/amo': { body: { status: 'success', data: { order_id: 'OID2' } } } });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    await gw.placeOrder({ symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'limit', product: 'cnc', price: 500, variety: 'amo' });
    expect(calls[0]!.url).toContain('/orders/amo');
  });

  it('modifyOrder PUTs only the changed fields; cancelOrder DELETEs', async () => {
    const { fn, calls } = stubFetch({ '/orders/regular/OID1': { body: { status: 'success', data: { order_id: 'OID1' } } } });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    await gw.modifyOrder('OID1', { price: 710 });
    expect(calls[0]!.init!.method).toBe('PUT');
    expect(String(calls[0]!.init!.body)).toBe('price=710');
    await gw.cancelOrder('OID1');
    expect(calls[1]!.init!.method).toBe('DELETE');
  });

  it('exitPosition flips side and uses market order; rejects flat positions', async () => {
    const { fn, calls } = stubFetch({ '/orders/regular': { body: { status: 'success', data: { order_id: 'OID3' } } } });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    await gw.exitPosition({ symbol: 'INFY', exchange: 'NSE', product: 'MIS', quantity: -10, averagePrice: 0, lastPrice: 0, pnl: 0 });
    const body = String(calls[0]!.init!.body);
    expect(body).toContain('transaction_type=BUY');
    expect(body).toContain('quantity=10');
    expect(body).toContain('order_type=MARKET');
    await expect(gw.exitPosition({ symbol: 'X', exchange: 'NSE', product: 'MIS', quantity: 0, averagePrice: 0, lastPrice: 0, pnl: 0 }))
      .rejects.toThrow('position_already_flat');
  });
});
```

- [ ] **Step 2: Run the file**

Run: `pnpm vitest run tests/kite-gateway.test.ts`
Expected: 9 passed (5 reads + 4 writes). Fix the adapter if any wire-format assertion fails.

- [ ] **Step 3: Commit**

```bash
git add tests/kite-gateway.test.ts
git commit -m "test(broker): pin Kite write-path wire format (GW-1)"
```

---

### Task 4: broker_connections + broker_orders tables and store helpers

**Files:**
- Modify: `apps/api/src/db.ts` (inside `migrate()`, append to the big `db.exec` block after the `accounts` table)
- Create: `apps/api/src/broker/store.ts`
- Test: `tests/broker-store.test.ts`

**Interfaces:**
- Consumes: `AppDB` from `../db`, `encryptSecret/decryptSecret` from `./crypto`, types from `./types`.
- Produces (`store.ts`):
  - `saveConnection(db, { userId, broker, apiKey, apiSecret, accessToken, accountMeta }): BrokerConnectionRow` (upserts on (user_id, broker); encrypts secret+token)
  - `listConnections(db, userId): BrokerConnectionSummary[]` (NO secrets — apiKeyLast4 only)
  - `getGatewayCredentials(db, userId, broker): { apiKey, apiSecret, accessToken } | null` (decrypted, server-side only)
  - `updateAccessToken(db, userId, broker, accessToken): void`
  - `deleteConnection(db, userId, broker): boolean`
  - `recordOrderAudit(db, { userId, broker, intent, placedVia, egressIp }): string` (returns audit id) and `completeOrderAudit(db, auditId, { brokerOrderId?, status, error? }): void`

- [ ] **Step 1: Add the schema (append inside migrate()'s exec, after the accounts table)**

```sql
    -- BYOB broker connections (GW-1). One per (user, broker); secrets encrypted at rest.
    CREATE TABLE IF NOT EXISTS broker_connections (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      broker        TEXT NOT NULL,
      api_key       TEXT NOT NULL,
      api_secret    TEXT NOT NULL,          -- encryptSecret() output
      access_token  TEXT,                   -- encryptSecret() output; NULL until first login
      status        TEXT NOT NULL DEFAULT 'pending',
      account_meta  TEXT,                   -- JSON AccountMeta
      last_login_at INTEGER,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      UNIQUE (user_id, broker),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Immutable order audit: a row lands BEFORE any request hits a broker (spec hard rule 5).
    CREATE TABLE IF NOT EXISTS broker_orders (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      broker          TEXT NOT NULL,
      intent          TEXT NOT NULL,        -- JSON OrderIntent
      broker_order_id TEXT,
      status          TEXT NOT NULL DEFAULT 'submitted',
      error           TEXT,
      placed_via      TEXT NOT NULL DEFAULT 'manual',
      egress_ip       TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
```

- [ ] **Step 2: Write the failing store test**

```ts
// tests/broker-store.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDB } from '../apps/api/src/db';
import {
  saveConnection, listConnections, getGatewayCredentials, updateAccessToken, deleteConnection,
  recordOrderAudit, completeOrderAudit,
} from '../apps/api/src/broker/store';

const dir = mkdtempSync(join(tmpdir(), 'sc-broker-'));
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'c'.repeat(64);
const db = openDB({ DATABASE_URL: `file:${join(dir, 'test.sqlite')}` } as NodeJS.ProcessEnv);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('broker store', () => {
  it('saves encrypted, lists with last-4 only, decrypts server-side', () => {
    saveConnection(db, {
      userId: 'demo', broker: 'kite', apiKey: 'apikey123', apiSecret: 'supersecret',
      accessToken: 'tok_abc', accountMeta: { accountId: 'AB1234', name: 'T', broker: 'kite' },
    });
    const raw = db.raw.prepare("SELECT api_secret, access_token FROM broker_connections WHERE user_id='demo'").get() as { api_secret: string; access_token: string };
    expect(raw.api_secret).not.toContain('supersecret');
    expect(raw.access_token).not.toContain('tok_abc');

    const list = listConnections(db, 'demo');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ broker: 'kite', apiKeyLast4: 'y123', status: 'active' });
    expect(JSON.stringify(list[0])).not.toContain('supersecret');

    const creds = getGatewayCredentials(db, 'demo', 'kite');
    expect(creds).toEqual({ apiKey: 'apikey123', apiSecret: 'supersecret', accessToken: 'tok_abc' });
  });

  it('upserts on (user, broker) and updates the daily token', () => {
    updateAccessToken(db, 'demo', 'kite', 'tok_day2');
    expect(getGatewayCredentials(db, 'demo', 'kite')!.accessToken).toBe('tok_day2');
    saveConnection(db, { userId: 'demo', broker: 'kite', apiKey: 'apikey123', apiSecret: 'rotated', accessToken: null, accountMeta: null });
    expect(listConnections(db, 'demo')).toHaveLength(1);
    expect(getGatewayCredentials(db, 'demo', 'kite')!.apiSecret).toBe('rotated');
  });

  it('audits an order before and after', () => {
    const auditId = recordOrderAudit(db, {
      userId: 'demo', broker: 'kite', placedVia: 'manual', egressIp: null,
      intent: { symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'limit', product: 'mis', price: 100 },
    });
    completeOrderAudit(db, auditId, { brokerOrderId: 'OID9', status: 'placed' });
    const row = db.raw.prepare('SELECT broker_order_id, status FROM broker_orders WHERE id=?').get(auditId) as { broker_order_id: string; status: string };
    expect(row).toEqual({ broker_order_id: 'OID9', status: 'placed' });
  });

  it('deletes a connection', () => {
    expect(deleteConnection(db, 'demo', 'kite')).toBe(true);
    expect(getGatewayCredentials(db, 'demo', 'kite')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run tests/broker-store.test.ts`
Expected: FAIL — cannot resolve `../apps/api/src/broker/store`

- [ ] **Step 4: Write store.ts**

```ts
// apps/api/src/broker/store.ts
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { decryptSecret, encryptSecret } from './crypto';
import type { AccountMeta, BrokerId, OrderIntent } from './types';

export interface BrokerConnectionSummary {
  id: string; broker: BrokerId; apiKeyLast4: string; status: string;
  accountMeta: AccountMeta | null; lastLoginAt: number | null; createdAt: number;
}

export function saveConnection(db: AppDB, input: {
  userId: string; broker: BrokerId; apiKey: string; apiSecret: string;
  accessToken: string | null; accountMeta: AccountMeta | null;
}): { id: string } {
  const now = Date.now();
  const existing = db.raw
    .prepare('SELECT id FROM broker_connections WHERE user_id = ? AND broker = ?')
    .get(input.userId, input.broker) as { id: string } | undefined;
  const id = existing?.id ?? `bc_${nanoid(14)}`;
  const status = input.accessToken ? 'active' : 'pending';
  const tokenEnc = input.accessToken ? encryptSecret(input.accessToken) : null;
  if (existing) {
    db.raw.prepare(
      `UPDATE broker_connections SET api_key=?, api_secret=?, access_token=?, status=?, account_meta=?,
         last_login_at=CASE WHEN ? IS NULL THEN last_login_at ELSE ? END, updated_at=? WHERE id=?`,
    ).run(input.apiKey, encryptSecret(input.apiSecret), tokenEnc, status,
      input.accountMeta ? JSON.stringify(input.accountMeta) : null, tokenEnc, now, now, id);
  } else {
    db.raw.prepare(
      `INSERT INTO broker_connections (id, user_id, broker, api_key, api_secret, access_token, status, account_meta, last_login_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.userId, input.broker, input.apiKey, encryptSecret(input.apiSecret), tokenEnc, status,
      input.accountMeta ? JSON.stringify(input.accountMeta) : null, input.accessToken ? now : null, now, now);
  }
  return { id };
}

export function listConnections(db: AppDB, userId: string): BrokerConnectionSummary[] {
  const rows = db.raw.prepare(
    `SELECT id, broker, api_key as apiKey, status, account_meta as accountMeta, last_login_at as lastLoginAt, created_at as createdAt
       FROM broker_connections WHERE user_id = ? ORDER BY created_at ASC`,
  ).all(userId) as Array<{ id: string; broker: BrokerId; apiKey: string; status: string; accountMeta: string | null; lastLoginAt: number | null; createdAt: number }>;
  return rows.map((r) => ({
    id: r.id, broker: r.broker, apiKeyLast4: r.apiKey.slice(-4), status: r.status,
    accountMeta: r.accountMeta ? (JSON.parse(r.accountMeta) as AccountMeta) : null,
    lastLoginAt: r.lastLoginAt, createdAt: r.createdAt,
  }));
}

export function getGatewayCredentials(db: AppDB, userId: string, broker: BrokerId):
  { apiKey: string; apiSecret: string; accessToken: string | null } | null {
  const row = db.raw.prepare(
    'SELECT api_key as apiKey, api_secret as apiSecret, access_token as accessToken FROM broker_connections WHERE user_id = ? AND broker = ?',
  ).get(userId, broker) as { apiKey: string; apiSecret: string; accessToken: string | null } | undefined;
  if (!row) return null;
  return {
    apiKey: row.apiKey,
    apiSecret: decryptSecret(row.apiSecret),
    accessToken: row.accessToken ? decryptSecret(row.accessToken) : null,
  };
}

export function updateAccessToken(db: AppDB, userId: string, broker: BrokerId, accessToken: string): void {
  db.raw.prepare(
    "UPDATE broker_connections SET access_token = ?, status = 'active', last_login_at = ?, updated_at = ? WHERE user_id = ? AND broker = ?",
  ).run(encryptSecret(accessToken), Date.now(), Date.now(), userId, broker);
}

export function deleteConnection(db: AppDB, userId: string, broker: BrokerId): boolean {
  const res = db.raw.prepare('DELETE FROM broker_connections WHERE user_id = ? AND broker = ?').run(userId, broker);
  return Number(res.changes) > 0;
}

export function recordOrderAudit(db: AppDB, input: {
  userId: string; broker: BrokerId; intent: OrderIntent; placedVia: 'manual' | 'alert' | 'indicator'; egressIp: string | null;
}): string {
  const id = `bo_${nanoid(14)}`;
  const now = Date.now();
  db.raw.prepare(
    `INSERT INTO broker_orders (id, user_id, broker, intent, status, placed_via, egress_ip, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?)`,
  ).run(id, input.userId, input.broker, JSON.stringify(input.intent), input.placedVia, input.egressIp, now, now);
  return id;
}

export function completeOrderAudit(db: AppDB, auditId: string, result: { brokerOrderId?: string; status: string; error?: string }): void {
  db.raw.prepare(
    'UPDATE broker_orders SET broker_order_id = COALESCE(?, broker_order_id), status = ?, error = ?, updated_at = ? WHERE id = ?',
  ).run(result.brokerOrderId ?? null, result.status, result.error ?? null, Date.now(), auditId);
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run tests/broker-store.test.ts && pnpm -F @supercharts/api typecheck`
Expected: 4 passed, typecheck clean

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db.ts apps/api/src/broker/store.ts tests/broker-store.test.ts
git commit -m "feat(broker): broker_connections + broker_orders tables and encrypted store (GW-1)"
```

---

### Task 5: Live verification against the owner's credentials

**Files:**
- Create: `apps/api/scripts/verify-kite-gw1.ts`

**Interfaces:**
- Consumes: `KiteGateway`, `loadEnvFile` from `../src/env`, store helpers + `openDB`.
- Reads `KITE_API_KEY` / `KITE_API_SECRET` / `KITE_ACCESS_TOKEN` from the root `.env`. Never prints secret values — only last-4 and results.

- [ ] **Step 1: Write the script**

```ts
// apps/api/scripts/verify-kite-gw1.ts
// GW-1 live verification. READ mode by default (profile/positions/orders).
//   pnpm tsx apps/api/scripts/verify-kite-gw1.ts            # reads only
//   pnpm tsx apps/api/scripts/verify-kite-gw1.ts --write    # + far-limit AMO place->cancel
// Requires KITE_API_KEY / KITE_ACCESS_TOKEN in the root .env (KITE_API_SECRET for token exchange).
import { loadEnvFile } from '../src/env';
import { KiteGateway } from '../src/broker/kite-gateway';

loadEnvFile();
const apiKey = process.env.KITE_API_KEY ?? '';
const accessToken = process.env.KITE_ACCESS_TOKEN ?? '';
if (!apiKey || !accessToken) {
  console.error('missing KITE_API_KEY / KITE_ACCESS_TOKEN in .env');
  process.exit(1);
}

async function main(): Promise<void> {
  const gw = new KiteGateway({ apiKey, accessToken });
  const meta = await gw.validate();
  console.log(`[validate] OK — account ${meta.accountId} (${meta.name}) key …${apiKey.slice(-4)}`);
  const positions = await gw.getPositions();
  console.log(`[positions] ${positions.length} net position(s)`);
  const orders = await gw.getOrders();
  console.log(`[orders] ${orders.length} order(s) today`);

  if (process.argv.includes('--write')) {
    // SAFE write probe: 1-qty LIMIT far below market as AMO (works when market closed), then cancel.
    const intent = {
      symbol: 'IDEA', exchange: 'NSE', side: 'buy', quantity: 1,
      orderType: 'limit', product: 'cnc', price: 1.0, variety: 'amo',
    } as const;
    console.log(`[write] placing ${JSON.stringify(intent)}`);
    const ref = await gw.placeOrder(intent);
    console.log(`[write] placed AMO order ${ref.brokerOrderId} — cancelling…`);
    await gw.cancelOrder(ref.brokerOrderId, 'amo');
    console.log('[write] cancelled OK — write plane verified');
  }
}

main().catch((err) => {
  console.error('[verify] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Run READ verification**

Run: `cd apps/api && pnpm tsx scripts/verify-kite-gw1.ts`
Expected: `[validate] OK — account <id> (<name>)`, positions + orders counts. If it fails with `TokenException`, the daily access token is stale → regenerate via the login URL and update `.env`.

- [ ] **Step 3: Run WRITE verification (announce first — places then cancels a ₹1 AMO limit for 1 share of IDEA)**

Run: `cd apps/api && pnpm tsx scripts/verify-kite-gw1.ts --write`
Expected: `placed AMO order <id> — cancelling… cancelled OK`. (Any rejection message is surfaced verbatim; a margin/price rejection still proves the wire format and cancel path.)

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/verify-kite-gw1.ts
git commit -m "chore(broker): GW-1 live verification script (read + safe write probe)"
```

---

### Task 6: Full-suite gate + safe deploy + STATUS

**Files:**
- Modify: `docs/STATUS.md` (Done row + In-progress), `docs/superpowers/plans/2026-07-13-gw1-broker-gateway-kite.md` (tick boxes)

- [ ] **Step 1: Full gates**

Run: `pnpm vitest run && pnpm -F @supercharts/api typecheck && pnpm -F @supercharts/web typecheck`
Expected: entire suite green (581 + ~17 new), both typechecks clean.

- [ ] **Step 2: Push + deploy (safe: module is dormant — no routes reference it yet; only additive tables)**

```bash
git push origin main
gcloud compute ssh supercharts --zone=asia-south1-a --command="cd ~/supercharts && git pull --ff-only && pm2 restart supercharts-api --update-env && sleep 6 && curl -s localhost:4000/api/health | head -c 120"
```
Expected: health `{"ok":true,…}`; pm2 online; the two new tables exist after boot.

- [ ] **Step 3: Verify prod untouched**

Run: `curl -s -o /dev/null -w '%{http_code}' https://supercharting.com/ && curl -s https://supercharting.com/api/health | head -c 80`
Expected: 200 + healthy JSON; alert engine reconnected (pm2 logs show binance connected).

- [ ] **Step 4: Update STATUS.md Done table (GW-1 row with real numbers) and commit + push**

```bash
git add docs/STATUS.md docs/superpowers/plans/2026-07-13-gw1-broker-gateway-kite.md
git commit -m "docs(status): GW-1 broker gateway landed + verified live"
git push origin main
```
