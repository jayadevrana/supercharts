import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authRoutes } from '../apps/api/src/routes/auth';
import { openDB } from '../apps/api/src/db';
import { hashPassword, verifyPassword, createSession } from '../apps/api/src/auth';
import {
  issuePasswordReset,
  consumePasswordReset,
  hashResetToken,
  RESET_TTL_MS,
} from '../apps/api/src/auth-reset';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Fastify = apiRequire('fastify').default as typeof import('fastify').default;
const cookie = apiRequire('@fastify/cookie');

const dir = mkdtempSync(join(tmpdir(), 'sc-reset-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let seq = 0;
function freshDB() {
  return openDB({ ...process.env, DATABASE_URL: `file:${join(dir, `reset-${seq++}.db`)}` });
}

function seedUser(db: ReturnType<typeof openDB>, email = 'trader@example.com', password = 'oldpassword1') {
  const id = `u_${seq}_${Math.floor(Math.random() * 1e9)}`;
  const now = Date.now();
  db.raw
    .prepare(
      'INSERT INTO users (id, email, password_hash, display_name, role, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    )
    .run(id, email, hashPassword(password), 'Trader', 'user', now, now);
  return id;
}

function app(db: ReturnType<typeof openDB>) {
  const a = Fastify();
  a.register(cookie);
  authRoutes(a, db);
  return a;
}

describe('auth-reset core (pure token helpers)', () => {
  it('issues a raw token and stores only its hash', () => {
    const db = freshDB();
    const userId = seedUser(db);
    const token = issuePasswordReset(db, userId);
    expect(token.length).toBeGreaterThan(20);
    const row = db.raw.prepare('SELECT token_hash as h, expires_at as e FROM password_resets WHERE user_id = ?').get(userId) as
      | { h: string; e: number }
      | undefined;
    expect(row?.h).toBe(hashResetToken(token));
    expect(row?.h).not.toBe(token); // raw token is never stored
  });

  it('consumes a valid token exactly once (single use)', () => {
    const db = freshDB();
    const userId = seedUser(db);
    const token = issuePasswordReset(db, userId);
    expect(consumePasswordReset(db, token)).toBe(userId);
    expect(consumePasswordReset(db, token)).toBeNull(); // burned
  });

  it('rejects unknown and expired tokens (expired row is cleaned up)', () => {
    const db = freshDB();
    const userId = seedUser(db);
    expect(consumePasswordReset(db, 'not-a-real-token')).toBeNull();
    const token = issuePasswordReset(db, userId, Date.now() - RESET_TTL_MS - 1000); // already expired
    expect(consumePasswordReset(db, token)).toBeNull();
    const remaining = db.raw.prepare('SELECT COUNT(*) as c FROM password_resets WHERE user_id = ?').get(userId) as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('re-issuing replaces the previous token (only the latest works)', () => {
    const db = freshDB();
    const userId = seedUser(db);
    const first = issuePasswordReset(db, userId);
    const second = issuePasswordReset(db, userId);
    expect(consumePasswordReset(db, first)).toBeNull(); // old one invalidated
    expect(consumePasswordReset(db, second)).toBe(userId);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('returns ok for an UNKNOWN email and creates NO token (no account enumeration)', async () => {
    const db = freshDB();
    const a = app(db);
    const res = await a.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'nobody@nowhere.com' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const count = db.raw.prepare('SELECT COUNT(*) as c FROM password_resets').get() as { c: number };
    expect(count.c).toBe(0);
    await a.close();
  });

  it('returns ok for a KNOWN email and creates exactly one reset token', async () => {
    const db = freshDB();
    const userId = seedUser(db, 'known@example.com');
    const a = app(db);
    const res = await a.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'KNOWN@example.com' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const row = db.raw.prepare('SELECT user_id as u FROM password_resets').get() as { u: string } | undefined;
    expect(row?.u).toBe(userId); // case-insensitive email match
    await a.close();
  });

  it('rejects a malformed email with 400', async () => {
    const db = freshDB();
    const a = app(db);
    const res = await a.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'not-an-email' } });
    expect(res.statusCode).toBe(400);
    await a.close();
  });
});

describe('POST /api/auth/reset-password', () => {
  it('resets the password with a valid token, then the old password fails and the new one works', async () => {
    const db = freshDB();
    const userId = seedUser(db, 'reset@example.com', 'oldpassword1');
    const token = issuePasswordReset(db, userId);
    const a = app(db);
    const res = await a.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, newPassword: 'brandnewpass9' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    const row = db.raw.prepare('SELECT password_hash as h FROM users WHERE id = ?').get(userId) as { h: string };
    expect(verifyPassword('brandnewpass9', row.h)).toBe(true);
    expect(verifyPassword('oldpassword1', row.h)).toBe(false);
    await a.close();
  });

  it('invalidates all existing sessions on reset (logs out every device)', async () => {
    const db = freshDB();
    const userId = seedUser(db, 'sessions@example.com');
    createSession(db, userId);
    createSession(db, userId);
    expect((db.raw.prepare('SELECT COUNT(*) as c FROM sessions WHERE user_id = ?').get(userId) as { c: number }).c).toBe(2);
    const token = issuePasswordReset(db, userId);
    const a = app(db);
    await a.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, newPassword: 'anotherpass9' } });
    expect((db.raw.prepare('SELECT COUNT(*) as c FROM sessions WHERE user_id = ?').get(userId) as { c: number }).c).toBe(0);
    await a.close();
  });

  it('rejects an invalid/burned token with 400 and does not change the password', async () => {
    const db = freshDB();
    const userId = seedUser(db, 'nochange@example.com', 'keepme12345');
    const token = issuePasswordReset(db, userId);
    const a = app(db);
    await a.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, newPassword: 'firstchange1' } });
    // second use of the same (now burned) token
    const res = await a.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, newPassword: 'hackerpass1' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_or_expired');
    const row = db.raw.prepare('SELECT password_hash as h FROM users WHERE id = ?').get(userId) as { h: string };
    expect(verifyPassword('hackerpass1', row.h)).toBe(false);
    expect(verifyPassword('firstchange1', row.h)).toBe(true);
    await a.close();
  });

  it('rejects a too-short new password with 400', async () => {
    const db = freshDB();
    const userId = seedUser(db, 'short@example.com');
    const token = issuePasswordReset(db, userId);
    const a = app(db);
    const res = await a.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, newPassword: 'short' } });
    expect(res.statusCode).toBe(400);
    // token must still be valid since the reset didn't go through
    expect(consumePasswordReset(db, token)).toBe(userId);
    await a.close();
  });
});
