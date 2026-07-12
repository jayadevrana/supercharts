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
