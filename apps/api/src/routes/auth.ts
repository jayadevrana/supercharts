import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AppDB } from '../db';
import { seedUserWorkspace } from '../db';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  getOptionalUser,
  getUser,
  hashPassword,
  planInfo,
  setSessionCookie,
  SESSION_COOKIE,
  verifyPassword,
  type SessionUser,
} from '../auth';
import { emailVerificationRequired, generateCode, sendVerificationEmail, sendPasswordResetEmail } from '../email';
import { issuePasswordReset, consumePasswordReset } from '../auth-reset';

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 6;
const RESEND_COOLDOWN_MS = 45 * 1000;

/** Whether this user's email is verified (0/1 column; absent row treated as unverified). */
function isEmailVerified(db: AppDB, userId: string): boolean {
  const row = db.raw.prepare('SELECT email_verified as v FROM users WHERE id = ?').get(userId) as
    | { v: number }
    | undefined;
  return Boolean(row?.v);
}

/** Generate, store, and send a fresh verification code for a user. */
async function issueVerificationCode(db: AppDB, userId: string, email: string): Promise<void> {
  const code = generateCode();
  const now = Date.now();
  db.raw
    .prepare(
      `INSERT INTO email_verifications (user_id, code, expires_at, attempts, sent_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0, sent_at = excluded.sent_at`,
    )
    .run(userId, code, now + CODE_TTL_MS, now);
  await sendVerificationEmail(email, code);
}

const OAUTH_STATE_COOKIE = 'sc_oauth_state';
/** Set (with the current user id) when the Google flow is a "link to my account" request. */
const OAUTH_LINK_COOKIE = 'sc_oauth_link';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Public origin of the app — used to build the OAuth redirect URI and post-login redirects. */
function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}
function googleRedirectUri(): string {
  return `${appUrl()}/api/auth/google/callback`;
}
function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

interface GoogleProfile {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/**
 * Find-or-create the local user behind a Google profile. Links to an existing local account by
 * verified email (so email/password users can later sign in with Google), otherwise provisions a
 * fresh account with a seeded default workspace. Returns the local user id.
 */
function upsertGoogleUser(db: AppDB, profile: GoogleProfile): string {
  const now = Date.now();
  const existingLink = db.raw
    .prepare("SELECT user_id as userId FROM accounts WHERE provider = 'google' AND provider_account_id = ?")
    .get(profile.sub) as { userId: string } | undefined;
  if (existingLink) return existingLink.userId;

  const email = profile.email?.trim().toLowerCase();
  let userId: string | undefined;

  if (email && profile.email_verified) {
    const byEmail = db.raw.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined;
    if (byEmail) userId = byEmail.id;
  }

  if (!userId) {
    userId = `u_${nanoid(16)}`;
    db.raw
      .prepare('INSERT INTO users (id, email, display_name, role, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(userId, email ?? `${userId}@google.local`, profile.name ?? email ?? 'Trader', 'user', now, now);
    seedUserWorkspace(db.raw, userId, now);
  }

  db.raw
    .prepare('INSERT OR IGNORE INTO accounts (id, user_id, provider, provider_account_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(`acc_${nanoid(16)}`, userId, 'google', profile.sub, now);
  return userId;
}

function toPublic(user: SessionUser): SessionUser {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

/** Start a fresh session for `userId` and set the cookie on the reply. */
function login(db: AppDB, reply: FastifyReply, userId: string): void {
  const session = createSession(db, userId);
  setSessionCookie(reply, session.id);
}

export function authRoutes(fastify: FastifyInstance, db: AppDB): void {
  // Who am I? Always 200 so the client can branch on `user === null`. Also advertises which
  // providers are configured so the UI can show/hide the Google button honestly.
  fastify.get('/api/auth/me', async (req) => {
    const user = getOptionalUser(req, db);
    if (!user) {
      return { user: null, googleEnabled: googleEnabled(), hasPassword: false, providers: [] as string[] };
    }
    const row = db.raw
      .prepare('SELECT password_hash as passwordHash, email_verified as emailVerified FROM users WHERE id = ?')
      .get(user.id) as { passwordHash: string | null; emailVerified: number } | undefined;
    const providers = (
      db.raw.prepare('SELECT provider FROM accounts WHERE user_id = ?').all(user.id) as { provider: string }[]
    ).map((p) => p.provider);
    const plan = planInfo(db, user);
    return {
      user: { ...toPublic(user), emailVerified: Boolean(row?.emailVerified), ...plan },
      googleEnabled: googleEnabled(),
      hasPassword: Boolean(row?.passwordHash),
      providers,
    };
  });

  // Update profile (display name today).
  fastify.patch('/api/auth/profile', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = z.object({ displayName: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    db.raw
      .prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
      .run(parsed.data.displayName, Date.now(), user.id);
    return { user: { id: user.id, email: user.email, displayName: parsed.data.displayName } };
  });

  // Change password (email/password users) or SET a first password (Google-only users). The
  // session already proves identity; a current password is required only when one exists.
  fastify.post('/api/auth/change-password', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = z
      .object({ currentPassword: z.string().max(200).optional(), newPassword: z.string().min(8).max(200) })
      .safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const row = db.raw.prepare('SELECT password_hash as passwordHash FROM users WHERE id = ?').get(user.id) as
      | { passwordHash: string | null }
      | undefined;
    if (row?.passwordHash) {
      if (!parsed.data.currentPassword || !verifyPassword(parsed.data.currentPassword, row.passwordHash)) {
        reply.code(400);
        return { error: 'wrong_current_password' };
      }
    }
    db.raw
      .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashPassword(parsed.data.newPassword), Date.now(), user.id);
    return { ok: true, hadPassword: Boolean(row?.passwordHash) };
  });

  fastify.post('/api/auth/register', async (req, reply) => {
    const parsed = z
      .object({
        email: z.string().email().max(200),
        password: z.string().min(8).max(200),
        displayName: z.string().trim().max(80).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', detail: parsed.error.issues[0]?.message };
    }
    const email = parsed.data.email.trim().toLowerCase();
    const taken = db.raw.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (taken) {
      reply.code(409);
      return { error: 'email_taken' };
    }
    const now = Date.now();
    const userId = `u_${nanoid(16)}`;
    const needsVerification = emailVerificationRequired();
    db.raw
      .prepare(
        'INSERT INTO users (id, email, password_hash, display_name, role, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(userId, email, hashPassword(parsed.data.password), parsed.data.displayName ?? null, 'user', needsVerification ? 0 : 1, now, now);
    seedUserWorkspace(db.raw, userId, now);
    if (needsVerification) await issueVerificationCode(db, userId, email);
    login(db, reply, userId);
    return { user: { id: userId, email, displayName: parsed.data.displayName ?? null }, needsVerification };
  });

  fastify.post('/api/auth/login', async (req, reply) => {
    const parsed = z
      .object({ email: z.string().email().max(200), password: z.string().min(1).max(200) })
      .safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const email = parsed.data.email.trim().toLowerCase();
    const row = db.raw
      .prepare('SELECT id, email, password_hash as passwordHash, display_name as displayName FROM users WHERE email = ?')
      .get(email) as { id: string; email: string; passwordHash: string | null; displayName: string | null } | undefined;
    // Generic message + always run verify shape to avoid leaking which emails exist.
    if (!row || !verifyPassword(parsed.data.password, row.passwordHash)) {
      reply.code(401);
      return { error: 'invalid_credentials' };
    }
    login(db, reply, row.id);
    return { user: { id: row.id, email: row.email, displayName: row.displayName } };
  });

  fastify.post('/api/auth/logout', async (req, reply) => {
    const sessionId = req.cookies?.[SESSION_COOKIE];
    if (sessionId) deleteSession(db, sessionId);
    clearSessionCookie(reply);
    return { ok: true };
  });

  // Confirm the 6-digit code emailed at signup. Rate-limited by attempts + expiry.
  fastify.post('/api/auth/verify-email', async (req, reply) => {
    const user = getUser(req, db);
    if (isEmailVerified(db, user.id)) return { ok: true, alreadyVerified: true };
    const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_code' };
    }
    const rec = db.raw
      .prepare('SELECT code, expires_at as expiresAt, attempts FROM email_verifications WHERE user_id = ?')
      .get(user.id) as { code: string; expiresAt: number; attempts: number } | undefined;
    if (!rec || rec.expiresAt < Date.now()) {
      reply.code(400);
      return { error: 'code_expired' };
    }
    if (rec.attempts >= MAX_VERIFY_ATTEMPTS) {
      reply.code(429);
      return { error: 'too_many_attempts' };
    }
    if (rec.code !== parsed.data.code) {
      db.raw.prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = ?').run(user.id);
      reply.code(400);
      return { error: 'wrong_code' };
    }
    db.raw.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(Date.now(), user.id);
    db.raw.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(user.id);
    return { ok: true };
  });

  // Re-send a fresh code (cooldown-limited).
  fastify.post('/api/auth/resend-verification', async (req, reply) => {
    const user = getUser(req, db);
    if (isEmailVerified(db, user.id)) return { ok: true, alreadyVerified: true };
    if (!emailVerificationRequired()) {
      reply.code(400);
      return { error: 'email_not_configured' };
    }
    const rec = db.raw.prepare('SELECT sent_at as sentAt FROM email_verifications WHERE user_id = ?').get(user.id) as
      | { sentAt: number }
      | undefined;
    if (rec && Date.now() - rec.sentAt < RESEND_COOLDOWN_MS) {
      reply.code(429);
      return { error: 'cooldown' };
    }
    await issueVerificationCode(db, user.id, user.email);
    return { ok: true };
  });

  // Forgot password: email a one-time reset link. ALWAYS returns { ok: true } regardless of whether
  // the address exists — so this endpoint can't be used to enumerate accounts. Only accounts that
  // actually have an email get a link; the token's raw value lives only in that link.
  fastify.post('/api/auth/forgot-password', async (req, reply) => {
    const parsed = z.object({ email: z.string().email().max(200) }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const email = parsed.data.email.trim().toLowerCase();
    const row = db.raw.prepare('SELECT id, email FROM users WHERE email = ?').get(email) as
      | { id: string; email: string }
      | undefined;
    if (row) {
      const token = issuePasswordReset(db, row.id);
      const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail(row.email, link);
    }
    // Generic response regardless of existence or send outcome.
    return { ok: true };
  });

  // Complete the reset: swap a valid one-time token for a new password. Burns the token, updates the
  // hash, and invalidates ALL existing sessions for that user (a reset should log out every device).
  fastify.post('/api/auth/reset-password', async (req, reply) => {
    const parsed = z
      .object({ token: z.string().min(1).max(400), newPassword: z.string().min(8).max(200) })
      .safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', detail: parsed.error.issues[0]?.message };
    }
    const userId = consumePasswordReset(db, parsed.data.token);
    if (!userId) {
      reply.code(400);
      return { error: 'invalid_or_expired' };
    }
    db.raw
      .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hashPassword(parsed.data.newPassword), Date.now(), userId);
    db.raw.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return { ok: true };
  });

  // ── Google OAuth (authorization-code flow) ─────────────────────────────────
  fastify.get('/api/auth/google/start', async (req, reply) => {
    if (!googleEnabled()) return reply.redirect(`${appUrl()}/login?error=google_unconfigured`);
    const state = randomBytes(16).toString('base64url');
    const cookieOpts = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    };
    reply.setCookie(OAUTH_STATE_COOKIE, state, cookieOpts);
    // "Connect Google" from the account page: remember which signed-in user to link to, so the
    // callback attaches this Google identity to that account instead of finding/creating one.
    if ((req.query as { link?: string }).link) {
      const current = getOptionalUser(req, db);
      if (current) reply.setCookie(OAUTH_LINK_COOKIE, current.id, cookieOpts);
    }
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: googleRedirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    });
    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  });

  fastify.get('/api/auth/google/callback', async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };
    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE];
    const linkUserId = req.cookies?.[OAUTH_LINK_COOKIE];
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
    reply.clearCookie(OAUTH_LINK_COOKIE, { path: '/' });
    const linkErr = (e: string): string => `${appUrl()}/account?error=${e}`;
    if (query.error) {
      return reply.redirect(linkUserId ? linkErr('google_denied') : `${appUrl()}/login?error=google_denied`);
    }
    if (!googleEnabled() || !query.code || !query.state || query.state !== cookieState) {
      return reply.redirect(`${appUrl()}/login?error=google_state`);
    }
    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: query.code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: googleRedirectUri(),
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) return reply.redirect(`${appUrl()}/login?error=google_token`);
      const token = (await tokenRes.json()) as { access_token?: string };
      if (!token.access_token) return reply.redirect(`${appUrl()}/login?error=google_token`);

      const infoRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!infoRes.ok) return reply.redirect(`${appUrl()}/login?error=google_userinfo`);
      const profile = (await infoRes.json()) as GoogleProfile;
      if (!profile.sub) {
        return reply.redirect(linkUserId ? linkErr('google_userinfo') : `${appUrl()}/login?error=google_userinfo`);
      }

      // Link flow: attach this Google identity to the already-signed-in account.
      if (linkUserId) {
        const owner = db.raw
          .prepare("SELECT user_id as userId FROM accounts WHERE provider = 'google' AND provider_account_id = ?")
          .get(profile.sub) as { userId: string } | undefined;
        if (owner && owner.userId !== linkUserId) return reply.redirect(linkErr('google_in_use'));
        db.raw
          .prepare('INSERT OR IGNORE INTO accounts (id, user_id, provider, provider_account_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(`acc_${nanoid(16)}`, linkUserId, 'google', profile.sub, Date.now());
        return reply.redirect(`${appUrl()}/account?linked=google`);
      }

      const userId = upsertGoogleUser(db, profile);
      login(db, reply, userId);
      return reply.redirect(`${appUrl()}/terminal`);
    } catch {
      return reply.redirect(linkUserId ? linkErr('google_failed') : `${appUrl()}/login?error=google_failed`);
    }
  });
}
