import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDB } from '../db';
import { requireAdmin } from '../auth';
import { resolvePlanUpdate } from '../plan';

/**
 * Owner admin panel API (spec §3.4, §4 GW-4). ROLE='admin' ONLY on every endpoint (401 anon /
 * 403 non-admin via `requireAdmin`). Manual plan activation lives here until a payment gateway
 * lands (spec §2): the owner flips `users.plan` and inspects broker connections + the immutable
 * order audit trail. Secrets NEVER leave the server — connection views expose only the last-4.
 */
export function adminRoutes(fastify: FastifyInstance, db: AppDB): void {
  // Every user with plan status + how many broker connections / order-audit rows they have.
  fastify.get('/api/admin/users', async (req) => {
    requireAdmin(req, db);
    const items = db.raw
      .prepare(
        `SELECT u.id as id, u.email as email, u.display_name as displayName, u.role as role,
                u.plan as plan, u.plan_expires_at as planExpiresAt, u.email_verified as emailVerified,
                u.created_at as createdAt,
                (SELECT COUNT(*) FROM broker_connections bc WHERE bc.user_id = u.id) as connectionCount,
                (SELECT COUNT(*) FROM broker_orders bo WHERE bo.user_id = u.id) as orderCount
           FROM users u
          ORDER BY u.created_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;
    return { items: items.map((r) => ({ ...r, emailVerified: Boolean(r.emailVerified) })) };
  });

  // Activate / deactivate Pro for a user (manual billing). durationDays for a fixed window,
  // explicit expiresAt, or neither = lifetime; free clears the expiry.
  const planSchema = z.object({
    plan: z.enum(['free', 'pro']),
    durationDays: z.number().int().positive().max(3650).optional(),
    expiresAt: z.number().int().nullable().optional(),
  });
  fastify.post('/api/admin/users/:id/plan', async (req, reply) => {
    requireAdmin(req, db);
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', message: parsed.error.issues[0]?.message };
    }
    const userId = (req.params as { id: string }).id;
    const exists = db.raw.prepare('SELECT 1 as ok FROM users WHERE id = ?').get(userId) as { ok: number } | undefined;
    if (!exists) {
      reply.code(404);
      return { error: 'user_not_found' };
    }
    const { plan, expiresAt } = resolvePlanUpdate(
      { plan: parsed.data.plan, durationDays: parsed.data.durationDays, expiresAt: parsed.data.expiresAt },
      Date.now(),
    );
    db.raw
      .prepare('UPDATE users SET plan = ?, plan_expires_at = ?, updated_at = ? WHERE id = ?')
      .run(plan, expiresAt, Date.now(), userId);
    return { id: userId, plan, planExpiresAt: expiresAt };
  });

  // All broker connections across users — last-4 only, secrets never serialised.
  fastify.get('/api/admin/connections', async (req) => {
    requireAdmin(req, db);
    const rows = db.raw
      .prepare(
        `SELECT bc.id as id, bc.user_id as userId, u.email as email, bc.broker as broker,
                bc.api_key as apiKey, bc.status as status, bc.last_login_at as lastLoginAt, bc.created_at as createdAt
           FROM broker_connections bc JOIN users u ON u.id = bc.user_id
          ORDER BY bc.created_at DESC`,
      )
      .all() as Array<{ apiKey: string } & Record<string, unknown>>;
    return {
      items: rows.map(({ apiKey, ...r }) => ({ ...r, apiKeyLast4: apiKey.slice(-4) })),
    };
  });

  // Recent order audit rows across users (immutable trail). Newest first, capped.
  fastify.get('/api/admin/orders', async (req) => {
    requireAdmin(req, db);
    const limit = Math.min(200, Math.max(1, Number((req.query as { limit?: string } | undefined)?.limit) || 100));
    const items = db.raw
      .prepare(
        `SELECT bo.id as id, bo.user_id as userId, u.email as email, bo.broker as broker,
                bo.intent as intent, bo.broker_order_id as brokerOrderId, bo.status as status,
                bo.error as error, bo.placed_via as placedVia, bo.created_at as createdAt
           FROM broker_orders bo JOIN users u ON u.id = bo.user_id
          ORDER BY bo.created_at DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    return { items };
  });
}
