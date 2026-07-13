import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createAlertOrderExecutor } from '../apps/api/src/broker/alert-order-executor';
import type { BrokerGatewayFactory } from '../apps/api/src/broker/write-gateway';
import { openDB } from '../apps/api/src/db';
import { saveConnection, updateAccessToken } from '../apps/api/src/broker/store';
import { seedVmEgress, assignEgress, confirmWhitelist } from '../apps/api/src/broker/egress-store';
import type { BrokerGateway, BrokerPosition, OrderIntent } from '../apps/api/src/broker/types';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'e'.repeat(64);
const dir = mkdtempSync(join(tmpdir(), 'sc-aoe-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

interface StubState {
  positions: BrokerPosition[];
  placed: OrderIntent[];
  positionsCalls: number;
  failPlaceOn?: (intent: OrderIntent, callIndex: number) => boolean;
}

function stubFactory(state: StubState): BrokerGatewayFactory {
  let placeCall = 0;
  const gw: BrokerGateway = {
    broker: 'kite',
    validate: async () => ({ accountId: 'A', name: 'T', broker: 'kite' }),
    placeOrder: async (intent) => {
      const i = placeCall++;
      if (state.failPlaceOn?.(intent, i)) throw new Error('InputException: rejected by broker.');
      state.placed.push(intent);
      return { brokerOrderId: `OID${i + 1}` };
    },
    modifyOrder: async (id) => ({ brokerOrderId: id }),
    cancelOrder: async () => {},
    getOrders: async () => [],
    getPositions: async () => { state.positionsCalls++; return state.positions; },
    exitPosition: async () => ({ brokerOrderId: 'X' }),
  };
  return () => gw;
}

function seedDb(name: string, whitelist = true) {
  const db = openDB({ DATABASE_URL: `file:${join(dir, name)}` } as NodeJS.ProcessEnv);
  db.raw.prepare("UPDATE users SET role='user', plan='pro' WHERE id='demo'").run();
  saveConnection(db, { userId: 'demo', broker: 'kite', apiKey: 'k1', apiSecret: 's1', accessToken: null, accountMeta: null });
  updateAccessToken(db, 'demo', 'kite', 'tok');
  seedVmEgress(db, '35.0.0.1');
  assignEgress(db, 'kite', 'demo');
  if (whitelist) confirmWhitelist(db, 'kite', 'demo');
  return db;
}

const cfg = { broker: 'kite' as const, tradingSymbol: 'RELIANCE', exchange: 'NSE', quantity: 10, product: 'mis' as const };
const input = (over = {}) => ({ userId: 'demo', alertId: 'al_1', side: 'buy' as const, config: cfg, placedVia: 'alert' as const, ...over });

describe('createAlertOrderExecutor — GW-7 alert → broker order automation', () => {
  it('flat → BUY places a single long order, audited placed_via=alert', async () => {
    const db = seedDb('flat.sqlite');
    const state: StubState = { positions: [], placed: [], positionsCalls: 0 };
    const exec = createAlertOrderExecutor({ db, gatewayFactory: stubFactory(state), isKillSwitchHalted: () => false });
    const r = await exec.execute(input());
    expect(r.status).toBe('placed');
    if (r.status === 'placed') expect(r.flip).toBe('open');
    expect(state.placed).toHaveLength(1);
    expect(state.placed[0]).toMatchObject({ side: 'buy', quantity: 10, orderType: 'market' });
    const audit = db.raw.prepare("SELECT status, placed_via as via, egress_ip as ip FROM broker_orders WHERE user_id='demo'").get() as { status: string; via: string; ip: string };
    expect(audit).toMatchObject({ status: 'placed', via: 'alert', ip: '35.0.0.1' });
  });

  it('short position → BUY flips: close short THEN open long (two audited orders)', async () => {
    const db = seedDb('flip.sqlite');
    const state: StubState = { positions: [{ symbol: 'RELIANCE', exchange: 'NSE', product: 'MIS', quantity: -5, averagePrice: 1000, lastPrice: 1000, pnl: 0 }], placed: [], positionsCalls: 0 };
    const exec = createAlertOrderExecutor({ db, gatewayFactory: stubFactory(state), isKillSwitchHalted: () => false });
    const r = await exec.execute(input());
    expect(r.status).toBe('placed');
    if (r.status === 'placed') { expect(r.flip).toBe('flip'); expect(r.brokerOrderIds).toHaveLength(2); }
    expect(state.placed[0]).toMatchObject({ side: 'buy', quantity: 5 });  // close the short
    expect(state.placed[1]).toMatchObject({ side: 'buy', quantity: 10 }); // open the long
    const n = db.raw.prepare("SELECT COUNT(*) c FROM broker_orders WHERE status='placed'").get() as { c: number };
    expect(n.c).toBe(2);
  });

  it('already long → BUY is a no-op (idempotent, no orders, no audit)', async () => {
    const db = seedDb('noop.sqlite');
    const state: StubState = { positions: [{ symbol: 'RELIANCE', exchange: 'NSE', product: 'MIS', quantity: 10, averagePrice: 1000, lastPrice: 1000, pnl: 0 }], placed: [], positionsCalls: 0 };
    const exec = createAlertOrderExecutor({ db, gatewayFactory: stubFactory(state), isKillSwitchHalted: () => false });
    const r = await exec.execute(input());
    expect(r.status).toBe('noop');
    expect(state.placed).toHaveLength(0);
    expect((db.raw.prepare("SELECT COUNT(*) c FROM broker_orders").get() as { c: number }).c).toBe(0);
  });

  it('kill-switch halted → skipped, never touches the broker', async () => {
    const db = seedDb('kill.sqlite');
    const state: StubState = { positions: [], placed: [], positionsCalls: 0 };
    const exec = createAlertOrderExecutor({ db, gatewayFactory: stubFactory(state), isKillSwitchHalted: () => true });
    const r = await exec.execute(input());
    expect(r).toMatchObject({ status: 'skipped', reason: 'kill_switch' });
    expect(state.positionsCalls).toBe(0);
    expect(state.placed).toHaveLength(0);
  });

  it('per-alert daily cap blocks further flips once reached', async () => {
    const db = seedDb('cap.sqlite');
    const state: StubState = { positions: [], placed: [], positionsCalls: 0 };
    const exec = createAlertOrderExecutor({ db, gatewayFactory: stubFactory(state), isKillSwitchHalted: () => false });
    const capped = { ...cfg, maxTradesPerDay: 1 };
    const first = await exec.execute(input({ config: capped }));
    expect(first.status).toBe('placed');
    // Second flip on the same alert/day is capped (even though the position would allow it).
    state.positions = [{ symbol: 'RELIANCE', exchange: 'NSE', product: 'MIS', quantity: 10, averagePrice: 1, lastPrice: 1, pnl: 0 }];
    const second = await exec.execute(input({ side: 'sell', config: capped }));
    expect(second).toMatchObject({ status: 'skipped', reason: 'daily_cap' });
  });

  it('un-whitelisted egress IP → skipped (SEBI gate), never touches the broker', async () => {
    const db = seedDb('wl.sqlite', false);
    const state: StubState = { positions: [], placed: [], positionsCalls: 0 };
    const exec = createAlertOrderExecutor({ db, gatewayFactory: stubFactory(state), isKillSwitchHalted: () => false });
    const r = await exec.execute(input());
    expect(r.status).toBe('skipped');
    if (r.status === 'skipped') expect(r.reason).toBe('ip_not_whitelisted');
    expect(state.positionsCalls).toBe(0);
  });

  it('missing daily token → skipped token_expired', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'tok.sqlite')}` } as NodeJS.ProcessEnv);
    db.raw.prepare("UPDATE users SET role='user', plan='pro' WHERE id='demo'").run();
    saveConnection(db, { userId: 'demo', broker: 'kite', apiKey: 'k1', apiSecret: 's1', accessToken: null, accountMeta: null });
    const state: StubState = { positions: [], placed: [], positionsCalls: 0 };
    const exec = createAlertOrderExecutor({ db, gatewayFactory: stubFactory(state), isKillSwitchHalted: () => false });
    const r = await exec.execute(input());
    expect(r).toMatchObject({ status: 'skipped', reason: 'token_expired' });
  });

  it('broker rejection on the CLOSE leg aborts the flip (never opens the new side) + audits rejected', async () => {
    const db = seedDb('reject.sqlite');
    const state: StubState = {
      positions: [{ symbol: 'RELIANCE', exchange: 'NSE', product: 'MIS', quantity: -5, averagePrice: 1, lastPrice: 1, pnl: 0 }],
      placed: [], positionsCalls: 0,
      failPlaceOn: (_i, callIndex) => callIndex === 0, // first (close) leg fails
    };
    const exec = createAlertOrderExecutor({ db, gatewayFactory: stubFactory(state), isKillSwitchHalted: () => false });
    const r = await exec.execute(input());
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toContain('InputException');
    expect(state.placed).toHaveLength(0); // the open leg was never attempted
    const rej = db.raw.prepare("SELECT COUNT(*) c FROM broker_orders WHERE status='rejected'").get() as { c: number };
    expect(rej.c).toBe(1);
  });
});
