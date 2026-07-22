import { createHash, randomBytes } from 'node:crypto';
import type { AppDB } from './db';

/**
 * Password-reset token core (pure, DB-only — no HTTP, no email). Kept separate from the route so it
 * can be unit-tested directly: `issuePasswordReset` mints a one-time token (returning the RAW token
 * for the emailed link, storing only its SHA-256 hash), and `consumePasswordReset` validates + burns
 * it. There is at most one active reset per user; re-requesting replaces the previous token.
 */

/** Reset links live longer than the 6-digit signup code — 30 minutes. */
export const RESET_TTL_MS = 30 * 60 * 1000;

/** SHA-256 hex of a raw token — what we persist, so a DB leak never yields usable tokens. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Create (or replace) the pending reset for a user and return the RAW token to email. The token is
 * URL-safe (base64url). Only its hash is stored.
 */
export function issuePasswordReset(db: AppDB, userId: string, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  db.raw
    .prepare(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_at = excluded.created_at`,
    )
    .run(userId, hashResetToken(token), now + RESET_TTL_MS, now);
  return token;
}

/**
 * Validate a raw reset token and BURN it (single use). Returns the owning userId, or null when the
 * token is unknown or expired. An expired row is deleted so it can't linger.
 */
export function consumePasswordReset(db: AppDB, token: string, now = Date.now()): string | null {
  if (!token) return null;
  const hash = hashResetToken(token);
  const row = db.raw
    .prepare('SELECT user_id as userId, expires_at as expiresAt FROM password_resets WHERE token_hash = ?')
    .get(hash) as { userId: string; expiresAt: number } | undefined;
  if (!row) return null;
  if (row.expiresAt < now) {
    db.raw.prepare('DELETE FROM password_resets WHERE token_hash = ?').run(hash);
    return null;
  }
  db.raw.prepare('DELETE FROM password_resets WHERE user_id = ?').run(row.userId);
  return row.userId;
}
