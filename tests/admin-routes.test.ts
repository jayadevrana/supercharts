import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { adminRoutes } from '../apps/api/src/routes/admin';
import { openDB } from '../apps/api/src/db';
import { saveConnection, recordOrderAudit } from '../apps/api/src/broker/store';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Fastify = apiRequire('fastify').default as typeof import('fastify').default;
const cookie = apiRequire('@fastify/cookie');

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'e'.repeat(64);
const dir = mkdtempSync(join(tmpdir(), 'sc-admin-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function appWith(db: ReturnType<typeof openDB>) {
  const app = Fastify();
  app.register(cookie);
  adminRoutes(app, db);
  return app;
}

/** A second, non-demo user we can toggle a plan on. */
function seedUser(db: ReturnType<typeof openDB>, id: string, email: string) {
  const now = Date.now();
  db.raw
    .prepare("INSERT INTO users (id, email, display_name, role, email_verified, created_at, updated_at) VALUES (?, ?, ?, 'user', 1, ?, ?)")
    .run(id, email, email, now, now);
}

describe('admin routes', () => {
  it('anon → 401, non-admin → 403', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'gate.sqlite')}` } as NodeJS.ProcessEnv);
    const prev = process.env.AUTH_ENABLED; delete process.env.AUTH_ENABLED;
    const anon = appWith(db);
    expect((await anon.inject({ method: 'GET', url: '/api/admin/users' })).statusCode).toBe(401);
    await anon.close();
    process.env.AUTH_ENABLED = '0'; // demo user resolves, role='user'
    const nonAdmin = appWith(db);
    expect((await nonAdmin.inject({ method: 'GET', url: '/api/admin/users' })).statusCode).toBe(403);
    await nonAdmin.close();
    if (prev === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prev;
  });

  it('lists users with plan + connection/order counts, toggles plan, lists connections/orders', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'main.sqlite')}` } as NodeJS.ProcessEnv);
    db.raw.prepare("UPDATE users SET role='admin' WHERE id='demo'").run();
    seedUser(db, 'u_test', 'trader@x.com');
    // Give the test user a connection + an order so the counts are non-zero.
    saveConnection(db, { userId: 'u_test', broker: 'kite', apiKey: 'abcd1234wxyz', apiSecret: 'sec', accessToken: 'tok', accountMeta: { accountId: 'AA1', name: 'Trader', broker: 'kite' } });
    recordOrderAudit(db, { userId: 'u_test', broker: 'kite', intent: { symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'market', product: 'mis' }, placedVia: 'manual', egressIp: null });

    const prev = process.env.AUTH_ENABLED; process.env.AUTH_ENABLED = '0';
    const app = appWith(db);

    // Users list
    const users = (await app.inject({ method: 'GET', url: '/api/admin/users' })).json().items as Array<Record<string, unknown>>;
    const testRow = users.find((u) => u.id === 'u_test')!;
    expect(testRow).toMatchObject({ email: 'trader@x.com', plan: 'free', connectionCount: 1, orderCount: 1 });
    expect(users.some((u) => u.id === 'demo' && u.role === 'admin')).toBe(true);

    // Activate Pro for 30 days
    const activated = await app.inject({ method: 'POST', url: '/api/admin/users/u_test/plan', payload: { plan: 'pro', durationDays: 30 } });
    expect(activated.statusCode).toBe(200);
    const body = activated.json();
    expect(body.plan).toBe('pro');
    expect(body.planExpiresAt).toBeGreaterThan(Date.now());

    // Deactivate back to free (clears expiry)
    const deactivated = await app.inject({ method: 'POST', url: '/api/admin/users/u_test/plan', payload: { plan: 'free' } });
    expect(deactivated.json()).toMatchObject({ plan: 'free', planExpiresAt: null });

    // Unknown user → 404
    expect((await app.inject({ method: 'POST', url: '/api/admin/users/nope/plan', payload: { plan: 'pro' } })).statusCode).toBe(404);

    // Connections list — only last-4, never a raw key/secret
    const conns = (await app.inject({ method: 'GET', url: '/api/admin/connections' })).json().items as Array<Record<string, unknown>>;
    expect(conns[0]).toMatchObject({ userId: 'u_test', email: 'trader@x.com', broker: 'kite', apiKeyLast4: 'wxyz', status: 'active' });
    const connText = JSON.stringify(conns);
    expect(connText).not.toContain('abcd1234wxyz');
    expect(connText).not.toContain('sec');

    // Orders audit list
    const orders = (await app.inject({ method: 'GET', url: '/api/admin/orders' })).json().items as Array<Record<string, unknown>>;
    expect(orders[0]).toMatchObject({ userId: 'u_test', email: 'trader@x.com', broker: 'kite', placedVia: 'manual', status: 'submitted' });

    await app.close();
    if (prev === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prev;
  });
});
