import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { OrderIntent } from '@supercharts/types';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import type { MT5Store } from '../mt5/state';
import type { IntentRouter } from '../mt5/intents';

const intentSchema = z.object({
  accountId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  kind: z.enum(['market', 'limit', 'stop', 'stop_limit']),
  sizing: z.union([
    z.object({ mode: z.literal('fixed_lots'), lots: z.number().positive() }),
    z.object({ mode: z.literal('risk_percent'), percent: z.number().positive(), slPips: z.number().positive() }),
    z.object({ mode: z.literal('cash_risk'), amount: z.number().positive(), slPips: z.number().positive() }),
  ]),
  price: z.number().positive().optional(),
  stopLimitPrice: z.number().positive().optional(),
  sl: z.object({ price: z.number().optional(), pips: z.number().optional() }).optional(),
  tp: z.object({ price: z.number().optional(), pips: z.number().optional() }).optional(),
  partials: z
    .array(
      z.object({
        label: z.string(),
        price: z.number().positive(),
        fraction: z.number().min(0.01).max(1),
        moveSlToBreakEvenAfter: z.boolean().optional(),
        breakEvenOffsetPips: z.number().optional(),
      }),
    )
    .optional(),
  trailing: z
    .object({
      distancePips: z.number().positive(),
      activationPips: z.number().nonnegative().optional(),
      stepPips: z.number().positive().optional(),
    })
    .optional(),
  breakEven: z
    .object({
      triggerPips: z.number().positive(),
      offsetPips: z.number().optional(),
    })
    .optional(),
  tif: z.enum(['gtc', 'day', 'ioc', 'fok', 'specified']).optional(),
  expiresAt: z.number().optional(),
  deviationPoints: z.number().nonnegative().optional(),
  comment: z.string().max(64).optional(),
  recipeId: z.string().optional(),
}) satisfies z.ZodType<OrderIntent>;

export function mt5Routes(
  fastify: FastifyInstance,
  db: AppDB,
  store: MT5Store,
  router: IntentRouter,
): void {
  fastify.post('/api/mt5/pair-tokens', async (req) => {
    const user = getUser(req, db);
    const token = nanoid(24);
    store.issuePairingToken(user.id, token);
    db.raw
      .prepare(
        'INSERT INTO mt5_pairing_tokens (token, user_id, created_at) VALUES (?, ?, ?)',
      )
      .run(token, user.id, Date.now());
    return { token, expiresInMs: 24 * 60 * 60_000 };
  });

  fastify.get('/api/mt5/accounts', async (req) => {
    const user = getUser(req, db);
    const accounts = store.listAccountsForUser(user.id).map((a) => ({
      accountId: a.accountId,
      connected: a.connected,
      eaVersion: a.eaVersion,
      snapshot: a.snapshot,
      symbols: [...a.symbols.values()].map((s) => ({
        id: s.id,
        raw: s.raw,
        description: s.description,
        digits: s.digits,
        baseCurrency: s.baseCurrency,
        quoteCurrency: s.quoteCurrency,
      })),
      lastSeenAt: a.lastSeenAt,
    }));
    return { accounts };
  });

  fastify.get('/api/mt5/positions', async (req) => {
    const user = getUser(req, db);
    const accountId = (req.query as { accountId?: string }).accountId;
    const positions = store.positionsForUser(user.id, accountId);
    const pending = store.pendingForUser(user.id, accountId);
    return { positions, pending };
  });

  fastify.post('/api/mt5/orders', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = intentSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_intent', details: parsed.error.flatten() };
    }
    const account = store.account(parsed.data.accountId);
    if (!account || account.userId !== user.id) {
      reply.code(403);
      return { error: 'account_not_yours' };
    }
    const res = router.submit(parsed.data.accountId, parsed.data);
    if (!res.ok) {
      reply.code(409);
      return { error: res.reason ?? 'rejected', intentId: res.intentId };
    }
    return { intentId: res.intentId, state: 'sent' };
  });

  fastify.delete<{ Params: { positionId: string } }>(
    '/api/mt5/positions/:positionId',
    async (req, reply) => {
      const user = getUser(req, db);
      const { positionId } = req.params;
      const fraction = Number((req.query as { fraction?: string }).fraction ?? 1);
      const all = store.listAccountsForUser(user.id);
      const owning = all.find((a) => a.positions.has(positionId));
      if (!owning) {
        reply.code(404);
        return { error: 'position_not_found' };
      }
      const res = router.closePosition(owning.accountId, positionId, fraction);
      if (!res.ok) {
        reply.code(409);
        return { error: 'bridge_offline' };
      }
      return { clientId: res.clientId, state: 'sent' };
    },
  );

  fastify.patch<{
    Params: { positionId: string };
    Body: { sl?: number; tp?: number };
  }>('/api/mt5/positions/:positionId', async (req, reply) => {
    const user = getUser(req, db);
    const { positionId } = req.params;
    const body = req.body ?? {};
    const all = store.listAccountsForUser(user.id);
    const owning = all.find((a) => a.positions.has(positionId));
    if (!owning) {
      reply.code(404);
      return { error: 'position_not_found' };
    }
    const res = router.modifyPosition(owning.accountId, positionId, body.sl, body.tp);
    if (!res.ok) {
      reply.code(409);
      return { error: 'bridge_offline' };
    }
    return { clientId: res.clientId, state: 'sent' };
  });

  fastify.delete<{ Params: { orderId: string } }>(
    '/api/mt5/orders/:orderId',
    async (req, reply) => {
      const user = getUser(req, db);
      const { orderId } = req.params;
      const all = store.listAccountsForUser(user.id);
      const owning = all.find((a) => a.pending.has(orderId));
      if (!owning) {
        reply.code(404);
        return { error: 'order_not_found' };
      }
      const res = router.cancelOrder(owning.accountId, orderId);
      if (!res.ok) {
        reply.code(409);
        return { error: 'bridge_offline' };
      }
      return { clientId: res.clientId, state: 'sent' };
    },
  );
}
