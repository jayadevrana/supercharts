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

const PAIRING_TOKEN_TTL_MS = 24 * 60 * 60_000;

/**
 * Re-load persisted pairing tokens into the in-memory store. Without this,
 * every API restart (tsx watch restarts on each edit) silently stranded all
 * configured EAs: the EA reconnects with its saved token, the store has never
 * heard of it, and the bridge refuses the hello until the user generates a
 * fresh token and re-edits the EA inputs. Expired rows are pruned here too.
 */
function hydratePairingTokens(db: AppDB, store: MT5Store): void {
  const cutoff = Date.now() - PAIRING_TOKEN_TTL_MS;
  db.raw.prepare('DELETE FROM mt5_pairing_tokens WHERE created_at < ?').run(cutoff);
  const rows = db.raw
    .prepare('SELECT token, user_id, created_at FROM mt5_pairing_tokens WHERE created_at >= ?')
    .all(cutoff) as Array<{ token: string; user_id: string; created_at: number }>;
  for (const row of rows) {
    store.issuePairingToken(row.user_id, row.token, row.created_at);
  }
}

/**
 * Mirror live pairing events into SQLite so pairings survive restarts:
 *  - refresh the pairing token's validity window on attach/detach (an
 *    actively-reconnecting EA never expires; an unused token dies in 24h),
 *  - upsert the `mt5_accounts` audit row (broker/server/currency/last-seen)
 *    so the UI can show "previously paired, awaiting reconnect" honestly.
 */
function persistPairingEvents(db: AppDB, store: MT5Store): void {
  store.on('event', (e: { kind: string; accountId?: string }) => {
    if (e.kind !== 'account_added' && e.kind !== 'account_removed') return;
    const account = e.accountId ? store.account(e.accountId) : undefined;
    if (!account) return;
    try {
      const now = Date.now();
      store.touchPairingToken(account.token);
      db.raw
        .prepare('UPDATE mt5_pairing_tokens SET created_at = ? WHERE token = ?')
        .run(now, account.token);
      const s = account.summary;
      db.raw
        .prepare(
          `INSERT INTO mt5_accounts (account_id, user_id, broker, server, currency, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id) DO UPDATE SET
             user_id = excluded.user_id,
             broker = excluded.broker,
             server = excluded.server,
             currency = excluded.currency,
             last_seen_at = excluded.last_seen_at`,
        )
        .run(
          account.accountId,
          account.userId,
          s?.broker ?? '',
          s?.server ?? '',
          s?.currency ?? '',
          now,
          now,
        );
    } catch {
      // Persistence is best-effort; the live in-memory pairing must never
      // break because an audit write failed.
    }
  });
}

export function mt5Routes(
  fastify: FastifyInstance,
  db: AppDB,
  store: MT5Store,
  router: IntentRouter,
): void {
  hydratePairingTokens(db, store);
  persistPairingEvents(db, store);

  /**
   * Honest connection status for the connect dialog: where the TCP bridge
   * actually listens (mirrors the env defaults in main.ts), how many EAs are
   * live right now, and which accounts have ever paired.
   */
  fastify.get('/api/mt5/status', async (req) => {
    const user = getUser(req, db);
    const live = store.listAccountsForUser(user.id);
    const known = db.raw
      .prepare(
        `SELECT account_id as accountId, broker, server, currency,
                first_seen_at as firstSeenAt, last_seen_at as lastSeenAt
         FROM mt5_accounts WHERE user_id = ? ORDER BY last_seen_at DESC`,
      )
      .all(user.id) as Array<{
      accountId: string;
      broker: string;
      server: string;
      currency: string;
      firstSeenAt: number;
      lastSeenAt: number;
    }>;
    const liveIds = new Set(live.filter((a) => a.connected).map((a) => a.accountId));
    return {
      bridgePort: Number(process.env.MT5_BRIDGE_PORT ?? 7878),
      bridgeHost: process.env.MT5_BRIDGE_HOST ?? '127.0.0.1',
      connectedAccounts: liveIds.size,
      knownAccounts: known.map((k) => ({ ...k, connected: liveIds.has(k.accountId) })),
    };
  });

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
      // A malformed fraction must never reach the EA: Number('abc') is NaN,
      // which would serialize as null inside the close command.
      if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
        reply.code(400);
        return { error: 'invalid_fraction' };
      }
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
