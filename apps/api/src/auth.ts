import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDB } from './db';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
}

/** Cookie name the browser carries; read by both HTTP routes and the WS upgrade. */
export const SESSION_COOKIE = 'sc_session';
/** How long a session stays valid (30 days). Refreshed lazily is unnecessary for MVP. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A 401 that Fastify serialises with the right status (it honours `error.statusCode`). */
export function unauthorized(message = 'unauthorized'): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 401 });
}

/**
 * Resolve the signed-in user for a request, or `null` if there is no valid session.
 *
 * Set `AUTH_ENABLED=0` to fall back to the legacy single-user `demo` account when no session
 * is present — this keeps local dev (and the owner's live alert config) working exactly as
 * before. With auth enabled (the default), no session simply means "not signed in".
 */
export function getOptionalUser(req: { cookies?: Record<string, string | undefined> }, db: AppDB): SessionUser | null {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId) {
    const user = readSessionUser(db, sessionId);
    if (user) return user;
  }
  if (process.env.AUTH_ENABLED === '0') {
    return db.raw
      .prepare('SELECT id, email, display_name as displayName, role FROM users WHERE id = ?')
      .get('demo') as SessionUser | undefined ?? null;
  }
  return null;
}

/** Resolve the signed-in user, or throw a 401. Every authed route funnels through here. */
export function getUser(req: FastifyRequest, db: AppDB): SessionUser {
  const user = getOptionalUser(req, db);
  if (!user) throw unauthorized('sign in required');
  return user;
}

/**
 * Resolve the signed-in user and require the admin role (403 otherwise). Interim gate for
 * ALL broker/trading endpoints until GW-4 ships the $15/mo plan gate (BYOB spec §4).
 */
export function requireAdmin(req: FastifyRequest, db: AppDB): SessionUser {
  const user = getUser(req, db);
  if (user.role !== 'admin') {
    throw Object.assign(new Error('admin_required'), { statusCode: 403 });
  }
  return user;
}

// ── Sessions ────────────────────────────────────────────────────────────────

/** Look up a live (non-expired) session and return its user, deleting it if expired. */
export function readSessionUser(db: AppDB, sessionId: string): SessionUser | null {
  const row = db.raw
    .prepare(
      `SELECT u.id as id, u.email as email, u.display_name as displayName, u.role as role, s.expires_at as expiresAt
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(sessionId) as (SessionUser & { expiresAt: number }) | undefined;
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    db.raw.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  return { id: row.id, email: row.email, displayName: row.displayName, role: row.role };
}

/** Create a session row and return its opaque id (the value stored in the cookie). */
export function createSession(db: AppDB, userId: string): { id: string; expiresAt: number } {
  const id = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.raw
    .prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .run(id, userId, expiresAt);
  return { id, expiresAt };
}

export function deleteSession(db: AppDB, sessionId: string): void {
  db.raw.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/** Set the httpOnly session cookie on a reply. Secure in production, Lax for OAuth redirects. */
export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

// ── Passwords (node:crypto scrypt — no native deps) ──────────────────────────

/** Hash a password as `scrypt$<saltHex>$<hashHex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time verify against a stored `scrypt$salt$hash` string. */
export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
