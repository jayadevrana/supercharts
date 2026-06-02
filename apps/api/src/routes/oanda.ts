import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDB } from '../db';
import { getUser } from '../auth';

/**
 * OANDA onboarding (Phase 3 #11). A per-user API token is stored server-side only; the client
 * ever sees just the last 4 chars + the verified account meta. The token is **validated against
 * the real OANDA REST API** before it is stored — a connection is never faked.
 */
const OANDA_API = {
  practice: 'https://api-fxpractice.oanda.com',
  live: 'https://api-fxtrade.oanda.com',
} as const;

const connectSchema = z.object({
  apiToken: z.string().min(10).max(256),
  accountId: z.string().min(3).max(64),
  env: z.enum(['practice', 'live']).default('practice'),
});

interface OandaRow {
  api_token: string;
  account_id: string;
  oanda_env: string;
  alias: string | null;
  currency: string | null;
  verified_at: number;
}

const last4 = (t: string): string => (t.length > 4 ? t.slice(-4) : t);

function statusOf(row: OandaRow | undefined): Record<string, unknown> {
  if (!row) return { connected: false };
  return {
    connected: true,
    accountId: row.account_id,
    env: row.oanda_env,
    alias: row.alias,
    currency: row.currency,
    last4: last4(row.api_token),
    verifiedAt: row.verified_at,
  };
}

export function oandaRoutes(fastify: FastifyInstance, db: AppDB): void {
  fastify.get('/api/oanda', async (req) => {
    const user = getUser(req, db);
    const row = db.raw
      .prepare('SELECT api_token, account_id, oanda_env, alias, currency, verified_at FROM oanda_credentials WHERE user_id = ?')
      .get(user.id) as OandaRow | undefined;
    return statusOf(row);
  });

  fastify.post('/api/oanda', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const { apiToken, accountId, env } = parsed.data;
    const base = OANDA_API[env];
    // Verify the credentials against the real OANDA account-summary endpoint.
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(`${base}/v3/accounts/${encodeURIComponent(accountId)}/summary`, {
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      });
    } catch {
      reply.code(502);
      return { error: 'unreachable', message: 'Could not reach OANDA. Check your network and try again.' };
    }
    const data = (await res.json().catch(() => ({}))) as {
      account?: { alias?: string; currency?: string };
      errorMessage?: string;
    };
    if (!res.ok) {
      reply.code(400);
      const detail = data.errorMessage ? ` (${data.errorMessage})` : '';
      if (res.status === 401) return { error: 'invalid_token', message: `OANDA rejected the API token${detail}.` };
      if (res.status === 404) return { error: 'invalid_account', message: `Account not found for this token / environment${detail}.` };
      return { error: 'oanda_error', message: data.errorMessage ? `OANDA: ${data.errorMessage}` : `OANDA returned ${res.status}.` };
    }
    const alias = data.account?.alias ?? null;
    const currency = data.account?.currency ?? null;
    const now = Date.now();
    const exists = db.raw.prepare('SELECT user_id FROM oanda_credentials WHERE user_id = ?').get(user.id);
    if (exists) {
      db.raw
        .prepare(
          'UPDATE oanda_credentials SET api_token = ?, account_id = ?, oanda_env = ?, alias = ?, currency = ?, verified_at = ? WHERE user_id = ?',
        )
        .run(apiToken, accountId, env, alias, currency, now, user.id);
    } else {
      db.raw
        .prepare(
          'INSERT INTO oanda_credentials (user_id, api_token, account_id, oanda_env, alias, currency, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(user.id, apiToken, accountId, env, alias, currency, now);
    }
    return { connected: true, accountId, env, alias, currency, last4: last4(apiToken), verifiedAt: now };
  });

  fastify.delete('/api/oanda', async (req) => {
    const user = getUser(req, db);
    db.raw.prepare('DELETE FROM oanda_credentials WHERE user_id = ?').run(user.id);
    return { ok: true };
  });
}
