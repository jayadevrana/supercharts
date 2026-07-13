import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { brokerRoutes, type BrokerGatewayFactory } from '../apps/api/src/routes/broker';
import { openDB } from '../apps/api/src/db';
import { saveConnection, updateAccessToken } from '../apps/api/src/broker/store';
import { seedVmEgress, assignEgress, confirmWhitelist } from '../apps/api/src/broker/egress-store';
import type { BrokerGateway } from '../apps/api/src/broker/types';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Fastify = apiRequire('fastify').default as typeof import('fastify').default;
const cookie = apiRequire('@fastify/cookie');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'e'.repeat(64);
const dir = mkdtempSync(join(tmpdir(), 'sc-trade-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let placed: unknown[] = [];
const stubFactory: BrokerGatewayFactory = (): BrokerGateway => ({
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
function seedAdminConnection(db: ReturnType<typeof openDB>, whitelist = true) {
  db.raw.prepare("UPDATE users SET role='admin' WHERE id='demo'").run();
  saveConnection(db, { userId: 'demo', broker: 'kite', apiKey: 'k1', apiSecret: 's1', accessToken: null, accountMeta: null });
  updateAccessToken(db, 'demo', 'kite', 'tok');
  // GW-5: writes require a whitelisted egress IP. Seed the VM IP + assign + confirm by default.
  seedVmEgress(db, '35.0.0.1');
  assignEgress(db, 'kite', 'demo');
  if (whitelist) confirmWhitelist(db, 'kite', 'demo');
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

  it('a Pro (non-admin) user with an active plan may trade; an expired plan is 403 (GW-4)', async () => {
    // Active Pro: role stays 'user', plan='pro', no expiry → broker access allowed.
    const okDb = openDB({ DATABASE_URL: `file:${join(dir, 'pro-ok.sqlite')}` } as NodeJS.ProcessEnv);
    okDb.raw.prepare("UPDATE users SET role='user', plan='pro', plan_expires_at=NULL WHERE id='demo'").run();
    saveConnection(okDb, { userId: 'demo', broker: 'kite', apiKey: 'k1', apiSecret: 's1', accessToken: null, accountMeta: null });
    updateAccessToken(okDb, 'demo', 'kite', 'tok');
    const prev = process.env.AUTH_ENABLED; process.env.AUTH_ENABLED = '0';
    const okApp = appWith(okDb);
    expect((await okApp.inject({ method: 'GET', url: '/api/broker/orders' })).statusCode).toBe(200);
    await okApp.close();

    // Expired Pro: plan='pro' but the expiry is in the past → 403 (not 401/200).
    const expDb = openDB({ DATABASE_URL: `file:${join(dir, 'pro-exp.sqlite')}` } as NodeJS.ProcessEnv);
    expDb.raw.prepare("UPDATE users SET role='user', plan='pro', plan_expires_at=1 WHERE id='demo'").run();
    saveConnection(expDb, { userId: 'demo', broker: 'kite', apiKey: 'k1', apiSecret: 's1', accessToken: null, accountMeta: null });
    updateAccessToken(expDb, 'demo', 'kite', 'tok');
    const expApp = appWith(expDb);
    expect((await expApp.inject({ method: 'GET', url: '/api/broker/orders' })).statusCode).toBe(403);
    await expApp.close();
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
    const failing: BrokerGatewayFactory = (creds) => ({
      ...stubFactory(creds),
      placeOrder: async () => { throw new Error('InputException: Missing field.'); },
    });
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

  it('GW-5: writing an order before the egress IP is whitelisted is blocked (409); reads still work; the audit records the egress IP', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'wl.sqlite')}` } as NodeJS.ProcessEnv);
    seedAdminConnection(db, false); // assigned an egress but NOT whitelisted
    const prev = process.env.AUTH_ENABLED; process.env.AUTH_ENABLED = '0';
    const app = appWith(db);
    const blocked = await app.inject({ method: 'POST', url: '/api/broker/orders', payload: { symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'market', product: 'mis' } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: 'ip_not_whitelisted', ip: '35.0.0.1' });
    expect(placed).toHaveLength(0); // never reached the broker
    // Reads are unaffected (brokers allow reads from any IP).
    expect((await app.inject({ method: 'GET', url: '/api/broker/orders' })).statusCode).toBe(200);
    // Confirm the whitelist → the order now goes through and the audit carries the egress IP.
    expect((await app.inject({ method: 'POST', url: '/api/broker/whitelist-confirm', payload: { broker: 'kite' } })).json()).toMatchObject({ ok: true, whitelisted: true });
    const ok = await app.inject({ method: 'POST', url: '/api/broker/orders', payload: { symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'market', product: 'mis' } });
    expect(ok.statusCode).toBe(200);
    const audit = db.raw.prepare("SELECT egress_ip as egressIp, status FROM broker_orders WHERE status='placed'").get() as { egressIp: string; status: string };
    expect(audit).toEqual({ egressIp: '35.0.0.1', status: 'placed' });
    await app.close();
    if (prev === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prev;
  });
});
