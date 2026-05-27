import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PLANS } from '@supercharts/types';
import type { AppDB } from '../db';
import { getUser } from '../auth';

export function billingRoutes(fastify: FastifyInstance, db: AppDB, env: NodeJS.ProcessEnv): void {
  fastify.get('/api/billing/plans', async () => ({ plans: PLANS }));

  fastify.get('/api/billing/status', async (req) => {
    const user = getUser(req, db);
    const row = db.raw
      .prepare(
        'SELECT plan, status, current_period_end as currentPeriodEnd, cancel_at_period_end as cancelAtPeriodEnd FROM subscriptions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
      )
      .get(user.id) as
      | { plan: string; status: string; currentPeriodEnd: number | null; cancelAtPeriodEnd: number }
      | undefined;
    return {
      plan: row?.plan ?? 'free',
      status: row?.status ?? 'none',
      currentPeriodEnd: row?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: row?.cancelAtPeriodEnd === 1,
      stripeConfigured: Boolean(env.STRIPE_SECRET_KEY),
    };
  });

  fastify.post('/api/billing/checkout', async (req, reply) => {
    const parsed = z
      .object({
        plan: z.enum(['pro_6m', 'pro_12m']),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    if (!env.STRIPE_SECRET_KEY) {
      // Fail closed with an explicit non-2xx so clients checking `res.ok` don't
      // mistake "Stripe is missing" for "checkout succeeded".
      reply.code(503);
      return {
        url: null,
        status: 'not_configured',
        message:
          'Stripe is not configured. Set STRIPE_SECRET_KEY and price IDs in .env to enable checkout.',
      };
    }
    // When configured, this would create a Stripe Checkout Session.
    // We intentionally fail closed instead of pretending a charge succeeded.
    reply.code(501);
    return {
      url: null,
      status: 'not_configured',
      message: 'Stripe Checkout session creation is wired up in apps/api/src/billing/stripe.ts (Phase 10).',
    };
  });

  fastify.post('/api/billing/portal', async (_req, reply) => {
    if (!env.STRIPE_SECRET_KEY) {
      reply.code(503);
      return { url: null, status: 'not_configured' };
    }
    reply.code(501);
    return { url: null, status: 'not_configured' };
  });

  fastify.post('/api/billing/webhook', async (_req, reply) => {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      reply.code(503);
      return { error: 'webhook_not_configured' };
    }
    reply.code(501);
    return { error: 'not_implemented' };
  });
}
