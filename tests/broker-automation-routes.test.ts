import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { brokerAutomationRoutes } from '../apps/api/src/routes/broker-automation';
import type { BrokerGatewayFactory } from '../apps/api/src/broker/write-gateway';
import { openDB } from '../apps/api/src/db';
import { saveConnection, updateAccessToken } from '../apps/api/src/broker/store';
import { seedVmEgress, assignEgress, confirmWhitelist } from '../apps/api/src/broker/egress-store';
import type { BrokerGateway } from '../apps/api/src/broker/types';
import type { AlertDefinition } from '@supercharts/types';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Fastify = apiRequire('fastify').default as typeof import('fastify').default;
const cookie = apiRequire('@fastify/cookie');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'e'.repeat(64);
const dir = mkdtempSync(join(tmpdir(), 'sc-autoroute-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The gate builds gateways but the arm route NEVER places an order — a stub proves it.
const stubFactory: BrokerGatewayFactory = (): BrokerGateway => ({
  broker: 'kite',
  validate: async () => ({ accountId: 'AB1', name: 'T', broker: 'kite' }),
  placeOrder: async () => { throw new Error('the arm route must not place orders'); },
  modifyOrder: async (id) => ({ brokerOrderId: id }),
  cancelOrder: async () => {},
  getOrders: async () => [],
  getPositions: async () => [],
  exitPosition: async () => ({ brokerOrderId: 'x' }),
});

/** Records subscribe/unsubscribe so we can assert both legs are wired to the engine. */
function stubEngine() {
  const subscribed: AlertDefinition[] = [];
  const unsubscribed: string[] = [];
  return {
    subscribe: (a: AlertDefinition) => { subscribed.push(a); },
    unsubscribe: (id: string) => { unsubscribed.push(id); },
    subscribed,
    unsubscribed,
  };
}

function appWith(db: ReturnType<typeof openDB>, engine = stubEngine(), factory = stubFactory) {
  const app = Fastify();
  app.register(cookie);
  brokerAutomationRoutes(app, db, engine, factory);
  return { app, engine };
}

function seedProConnection(db: ReturnType<typeof openDB>, whitelist = true) {
  db.raw.prepare("UPDATE users SET role='user', plan='pro', plan_expires_at=NULL WHERE id='demo'").run();
  saveConnection(db, { userId: 'demo', broker: 'kite', apiKey: 'k1', apiSecret: 's1', accessToken: null, accountMeta: null });
  updateAccessToken(db, 'demo', 'kite', 'tok');
  seedVmEgress(db, '35.0.0.1');
  assignEgress(db, 'kite', 'demo');
  if (whitelist) confirmWhitelist(db, 'kite', 'demo');
}

const armPayload = {
  symbol: 'KITE:NSE:RELIANCE',
  interval: '15m',
  atrLength: 10,
  multiplier: 3,
  tradingSymbol: 'RELIANCE',
  exchange: 'NSE',
  quantity: 1,
  product: 'mis',
  maxTradesPerDay: 5,
  telegram: true,
};

describe('broker automation (arm) routes', () => {
  let prevAuth: string | undefined;
  beforeEach(() => { prevAuth = process.env.AUTH_ENABLED; });
  afterAll(() => { if (prevAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prevAuth; });

  it('anon → 401; free (non-pro) user → 403', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'gate.sqlite')}` } as NodeJS.ProcessEnv);
    delete process.env.AUTH_ENABLED;
    const anon = appWith(db);
    expect((await anon.app.inject({ method: 'POST', url: '/api/broker/automation/supertrend', payload: armPayload })).statusCode).toBe(401);
    await anon.app.close();
    process.env.AUTH_ENABLED = '0'; // demo resolves, plan='free'
    const free = appWith(db);
    expect((await free.app.inject({ method: 'POST', url: '/api/broker/automation/supertrend', payload: armPayload })).statusCode).toBe(403);
    await free.app.close();
  });

  it('404 when no Kite connection exists', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'noconn.sqlite')}` } as NodeJS.ProcessEnv);
    db.raw.prepare("UPDATE users SET plan='pro' WHERE id='demo'").run();
    process.env.AUTH_ENABLED = '0';
    const { app } = appWith(db);
    const res = await app.inject({ method: 'POST', url: '/api/broker/automation/supertrend', payload: armPayload });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_connected');
    await app.close();
  });

  it('409 ip_not_whitelisted before whitelisting — and NOTHING is persisted or subscribed', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'nowl.sqlite')}` } as NodeJS.ProcessEnv);
    seedProConnection(db, false); // assigned egress, NOT whitelisted
    process.env.AUTH_ENABLED = '0';
    const { app, engine } = appWith(db);
    const res = await app.inject({ method: 'POST', url: '/api/broker/automation/supertrend', payload: armPayload });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'ip_not_whitelisted', ip: '35.0.0.1' });
    const count = db.raw.prepare("SELECT COUNT(*) as n FROM alerts WHERE user_id='demo'").get() as { n: number };
    expect(count.n).toBe(0);
    expect(engine.subscribed).toHaveLength(0);
    await app.close();
  });

  it('arms a whitelisted connection: persists BOTH legs (shared automation_id, opposite flip conditions, one brokerOrder) and subscribes both', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'arm.sqlite')}` } as NodeJS.ProcessEnv);
    seedProConnection(db);
    process.env.AUTH_ENABLED = '0';
    const { app, engine } = appWith(db);
    const res = await app.inject({ method: 'POST', url: '/api/broker/automation/supertrend', payload: armPayload });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.automationId).toBeTruthy();
    expect(body.buy.id).toBeTruthy();
    expect(body.sell.id).toBeTruthy();
    expect(body.buy.id).not.toBe(body.sell.id);
    expect(body.egressIp).toBe('35.0.0.1');

    const rows = db.raw
      .prepare("SELECT id, type, automation_id as automationId, config FROM alerts WHERE user_id='demo' ORDER BY id")
      .all() as Array<{ id: string; type: string; automationId: string; config: string }>;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.automationId))).toEqual(new Set([body.automationId]));
    expect(rows.every((r) => r.type === 'indicator')).toBe(true);
    const configs = rows.map((r) => JSON.parse(r.config) as { side: string; conditions: Array<{ operator: string }>; delivery: { brokerOrder?: { tradingSymbol: string; maxTradesPerDay?: number } } });
    const buy = configs.find((c) => c.side === 'buy')!;
    const sell = configs.find((c) => c.side === 'sell')!;
    expect(buy.conditions[0].operator).toBe('crosses_above');
    expect(sell.conditions[0].operator).toBe('crosses_below');
    // ONE shared broker order on each leg (the executor flips off event.side).
    expect(buy.delivery.brokerOrder).toMatchObject({ tradingSymbol: 'RELIANCE', maxTradesPerDay: 5 });
    expect(sell.delivery.brokerOrder).toMatchObject({ tradingSymbol: 'RELIANCE' });

    // Both legs handed to the engine, enabled.
    expect(engine.subscribed).toHaveLength(2);
    expect(new Set(engine.subscribed.map((a) => a.id))).toEqual(new Set([body.buy.id, body.sell.id]));
    expect(engine.subscribed.every((a) => a.enabled)).toBe(true);
    await app.close();
  });

  it('rejects an invalid config (quantity 0) with 400 and persists nothing', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'bad.sqlite')}` } as NodeJS.ProcessEnv);
    seedProConnection(db);
    process.env.AUTH_ENABLED = '0';
    const { app, engine } = appWith(db);
    const res = await app.inject({ method: 'POST', url: '/api/broker/automation/supertrend', payload: { ...armPayload, quantity: 0 } });
    expect(res.statusCode).toBe(400);
    const count = db.raw.prepare("SELECT COUNT(*) as n FROM alerts WHERE user_id='demo'").get() as { n: number };
    expect(count.n).toBe(0);
    expect(engine.subscribed).toHaveLength(0);
    await app.close();
  });

  it('lists armed automations grouped by pair, then disarms (deletes both legs + unsubscribes); a second disarm → 404', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'life.sqlite')}` } as NodeJS.ProcessEnv);
    seedProConnection(db);
    process.env.AUTH_ENABLED = '0';
    const { app, engine } = appWith(db);
    const armed = (await app.inject({ method: 'POST', url: '/api/broker/automation/supertrend', payload: armPayload })).json();

    const list = await app.inject({ method: 'GET', url: '/api/broker/automation' });
    expect(list.statusCode).toBe(200);
    const items = list.json().items as Array<{ automationId: string; symbol: string; interval: string; buy: { id: string }; sell: { id: string }; brokerOrder: { tradingSymbol: string }; enabled: boolean }>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ automationId: armed.automationId, symbol: 'KITE:NSE:RELIANCE', interval: '15m', enabled: true });
    expect(items[0].brokerOrder.tradingSymbol).toBe('RELIANCE');
    expect(new Set([items[0].buy.id, items[0].sell.id])).toEqual(new Set([armed.buy.id, armed.sell.id]));

    const disarm = await app.inject({ method: 'DELETE', url: `/api/broker/automation/${armed.automationId}` });
    expect(disarm.statusCode).toBe(200);
    expect(disarm.json()).toMatchObject({ ok: true, removed: 2 });
    const count = db.raw.prepare("SELECT COUNT(*) as n FROM alerts WHERE user_id='demo'").get() as { n: number };
    expect(count.n).toBe(0);
    expect(new Set(engine.unsubscribed)).toEqual(new Set([armed.buy.id, armed.sell.id]));

    const again = await app.inject({ method: 'DELETE', url: `/api/broker/automation/${armed.automationId}` });
    expect(again.statusCode).toBe(404);
    await app.close();
  });

  it('reconnect-status: 401 anon; fresh token → no reconnect; stale token with an armed pair → needsReconnect + message', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'recon.sqlite')}` } as NodeJS.ProcessEnv);

    delete process.env.AUTH_ENABLED;
    const anon = appWith(db);
    expect((await anon.app.inject({ method: 'GET', url: '/api/broker/automation/reconnect-status' })).statusCode).toBe(401);
    await anon.app.close();

    seedProConnection(db); // updateAccessToken stamps last_login_at = now → token is fresh
    process.env.AUTH_ENABLED = '0';
    const { app } = appWith(db);

    // Arm a pair, then check status — a just-reconnected token must NOT ask to reconnect.
    await app.inject({ method: 'POST', url: '/api/broker/automation/supertrend', payload: armPayload });
    const fresh = (await app.inject({ method: 'GET', url: '/api/broker/automation/reconnect-status' })).json();
    expect(fresh).toMatchObject({ connected: true, armedAutomationCount: 1, stale: false, needsReconnect: false, message: null });

    // Age the daily token to three days ago → stale relative to today's IST reset boundary.
    db.raw.prepare("UPDATE broker_connections SET last_login_at = ? WHERE user_id='demo' AND broker='kite'")
      .run(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const stale = (await app.inject({ method: 'GET', url: '/api/broker/automation/reconnect-status' })).json();
    expect(stale).toMatchObject({ connected: true, armedAutomationCount: 1, stale: true, needsReconnect: true });
    expect(stale.message).toContain('Zerodha Kite');
    await app.close();
  });

  it('reconnect-status: a Pro user with NO Kite connection → connected:false, needsReconnect:false', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'recon-noconn.sqlite')}` } as NodeJS.ProcessEnv);
    db.raw.prepare("UPDATE users SET plan='pro' WHERE id='demo'").run();
    process.env.AUTH_ENABLED = '0';
    const { app } = appWith(db);
    const res = await app.inject({ method: 'GET', url: '/api/broker/automation/reconnect-status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ connected: false, armedAutomationCount: 0, needsReconnect: false, message: null });
    await app.close();
  });
});
