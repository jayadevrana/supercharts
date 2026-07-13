import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDB } from '../apps/api/src/db';
import {
  seedVmEgress, addEgressIp, listEgressPool, removeEgressIp,
  assignEgress, getUserEgress, confirmWhitelist,
} from '../apps/api/src/broker/egress-store';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'e'.repeat(64);
const dir = mkdtempSync(join(tmpdir(), 'sc-egress-'));
const db = openDB({ DATABASE_URL: `file:${join(dir, 't.sqlite')}` } as NodeJS.ProcessEnv);
// FK targets: users must exist.
for (const u of ['u1', 'u2']) {
  db.raw.prepare("INSERT OR IGNORE INTO users (id, email, role, created_at, updated_at) VALUES (?, ?, 'user', 0, 0)").run(u, `${u}@x.com`);
}
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('egress pool store', () => {
  it('seeds the VM IP once (direct, no proxy)', () => {
    seedVmEgress(db, '35.200.208.191');
    seedVmEgress(db, '35.200.208.191'); // idempotent
    const pool = listEgressPool(db);
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ ip: '35.200.208.191', source: 'vm', brokersUsed: [] });
    expect(JSON.stringify(pool[0])).not.toContain('proxy_url');
  });

  it('assigns the VM IP to the first kite user; a 2nd kite user needs a new IP', () => {
    const a = assignEgress(db, 'kite', 'u1');
    expect(a).toMatchObject({ status: 'assigned', ip: '35.200.208.191' });
    expect(assignEgress(db, 'kite', 'u1')).toMatchObject({ status: 'already' }); // idempotent
    expect(assignEgress(db, 'kite', 'u2')).toEqual({ status: 'needs_ip' }); // SEBI: no 2nd kite on one IP
  });

  it('stores proxy_url encrypted; getUserEgress decrypts it server-side', () => {
    addEgressIp(db, { ip: '10.0.0.9', proxyUrl: 'http://user:pass@10.0.0.9:8080', label: 'proxy-1' });
    const raw = db.raw.prepare("SELECT proxy_url FROM egress_ips WHERE ip = '10.0.0.9'").get() as { proxy_url: string };
    expect(raw.proxy_url).not.toContain('10.0.0.9:8080');
    // Now u2's 2nd kite assignment lands on the new proxy IP.
    expect(assignEgress(db, 'kite', 'u2')).toMatchObject({ status: 'assigned', ip: '10.0.0.9' });
    const eg = getUserEgress(db, 'kite', 'u2');
    expect(eg?.proxyUrl).toBe('http://user:pass@10.0.0.9:8080');
    expect(eg?.whitelisted).toBe(false);
  });

  it('whitelist confirmation flips the flag once', () => {
    expect(getUserEgress(db, 'kite', 'u1')?.whitelisted).toBe(false);
    expect(confirmWhitelist(db, 'kite', 'u1')).toBe(true);
    expect(confirmWhitelist(db, 'kite', 'u1')).toBe(false); // already
    expect(getUserEgress(db, 'kite', 'u1')?.whitelisted).toBe(true);
  });

  it('the DB itself blocks two kite clients on one IP (UNIQUE egress_ip_id, broker)', () => {
    // Force a raw duplicate — the constraint must reject it.
    expect(() =>
      db.raw.prepare('INSERT INTO ip_assignments (id, egress_ip_id, broker, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run('dup', 'eip_vm', 'kite', 'u2', 0),
    ).toThrow();
  });

  it('removing an IP frees its slots', () => {
    const before = listEgressPool(db).length;
    const proxyId = listEgressPool(db).find((p) => p.ip === '10.0.0.9')!.id;
    expect(removeEgressIp(db, proxyId)).toBe(true);
    expect(listEgressPool(db).length).toBe(before - 1);
    expect(getUserEgress(db, 'kite', 'u2')).toBeNull(); // cascaded
  });
});
