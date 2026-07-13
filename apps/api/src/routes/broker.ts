import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { IngestionContext } from '@supercharts/ingestion';
import type { AppDB } from '../db';
import type { SessionUser } from '../auth';
import { requirePro } from '../auth';
import { KiteGateway } from '../broker/kite-gateway';
import type { BrokerGateway, BrokerPosition, OrderIntent } from '../broker/types';
import { modifyChangesSchema, validateOrderIntent, varietySchema } from '../broker/order-intent';
import {
  completeOrderAudit, deleteConnection, getGatewayCredentials, listConnections,
  recordOrderAudit, saveConnection, updateAccessToken,
} from '../broker/store';

/**
 * Builds a per-request execution gateway from a user's decrypted Kite credentials.
 * Injectable so the trading routes can be unit-tested against a stub without hitting Kite.
 */
export type BrokerGatewayFactory = (creds: { apiKey: string; accessToken: string }) => BrokerGateway;

const defaultKiteFactory: BrokerGatewayFactory = (creds) =>
  new KiteGateway({ apiKey: creds.apiKey, accessToken: creds.accessToken });

/**
 * BYOB broker connections (GW-2). PLAN-GATED (GW-4): every endpoint runs through `requirePro`,
 * so a signed-in user with an active `plan='pro'` (or any admin) may connect + trade; free users
 * get a 403 `plan_required`. Pro activation is manual from the /admin panel until a payment gateway
 * lands (spec §2). The egress-IP write plane is still GW-5.
 *
 * Flow: POST /connect without a request_token stores the app key/secret (pending) and returns
 * the user's Kite login URL. Completing that login redirects with a request_token, which either
 * the /broker/callback page or a manual paste sends to /reconnect (or /connect) — we exchange it
 * against the real Kite API (never faked) and store the daily access token encrypted.
 */
export function buildKiteLoginUrl(apiKey: string): string {
  return `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey)}`;
}

const connectSchema = z.object({
  broker: z.literal('kite'),
  apiKey: z.string().min(4).max(64),
  apiSecret: z.string().min(4).max(128),
  requestToken: z.string().min(4).max(128).optional(),
});

const reconnectSchema = z.object({
  broker: z.literal('kite'),
  requestToken: z.string().min(4).max(128),
});

export function brokerRoutes(
  fastify: FastifyInstance,
  db: AppDB,
  ingestion?: IngestionContext,
  gatewayFactory: BrokerGatewayFactory = defaultKiteFactory,
): void {
  /** Revive the live Kite data feed with a fresh daily token — no server restart needed. */
  const hotSwapKiteFeed = (apiKey: string, accessToken: string): void => {
    void ingestion?.providers.kite.setCredentials(apiKey, accessToken).catch((err) => {
      fastify.log.warn({ err }, '[broker] kite feed hot-swap failed (data feed stays down until restart)');
    });
  };
  fastify.get('/api/broker/connections', async (req) => {
    const user = requirePro(req, db);
    const items = listConnections(db, user.id).map((c) => ({
      ...c,
      loginUrl: c.broker === 'kite' ? buildKiteLoginUrl(loginKeyFor(db, user.id)) : undefined,
    }));
    return { items };
  });

  fastify.post('/api/broker/connect', async (req, reply) => {
    const user = requirePro(req, db);
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const { apiKey, apiSecret, requestToken } = parsed.data;
    if (!requestToken) {
      saveConnection(db, { userId: user.id, broker: 'kite', apiKey, apiSecret, accessToken: null, accountMeta: null });
      return { status: 'pending', loginUrl: buildKiteLoginUrl(apiKey) };
    }
    try {
      const { accessToken, meta } = await KiteGateway.exchangeRequestToken(apiKey, apiSecret, requestToken);
      saveConnection(db, { userId: user.id, broker: 'kite', apiKey, apiSecret, accessToken, accountMeta: meta });
      hotSwapKiteFeed(apiKey, accessToken);
      return { status: 'active', account: meta, apiKeyLast4: apiKey.slice(-4) };
    } catch (err) {
      reply.code(400);
      return { error: 'kite_rejected', message: err instanceof Error ? err.message : 'exchange failed' };
    }
  });

  fastify.post('/api/broker/reconnect', async (req, reply) => {
    const user = requirePro(req, db);
    const parsed = reconnectSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const creds = getGatewayCredentials(db, user.id, 'kite');
    if (!creds) {
      reply.code(404);
      return { error: 'not_connected', message: 'Connect your Kite app first.' };
    }
    try {
      const { accessToken, meta } = await KiteGateway.exchangeRequestToken(creds.apiKey, creds.apiSecret, parsed.data.requestToken);
      updateAccessToken(db, user.id, 'kite', accessToken);
      hotSwapKiteFeed(creds.apiKey, accessToken);
      return { status: 'active', account: meta };
    } catch (err) {
      reply.code(400);
      return { error: 'kite_rejected', message: err instanceof Error ? err.message : 'exchange failed' };
    }
  });

  fastify.delete('/api/broker/connections/:broker', async (req, reply) => {
    const user = requirePro(req, db);
    const broker = (req.params as { broker: string }).broker;
    if (broker !== 'kite') {
      reply.code(400);
      return { error: 'unknown_broker' };
    }
    const removed = deleteConnection(db, user.id, broker);
    return { ok: removed };
  });

  // ── Trading plane (GW-3) — admin-gated, ownership-checked, audited before the broker ──
  //
  // Reads (orders/positions) use the main VM IP; the write plane's egress-IP routing is GW-5,
  // so egressIp is null for now. Every place/modify/cancel/exit records a broker_orders row
  // BEFORE the request leaves for Kite (spec hard rule 5), and any broker rejection is surfaced
  // verbatim (`${error_type}: ${message}`) as a 502 — never swallowed.

  /** Build the caller's Kite gateway, or reply with the right honest error and return null. */
  const gatewayFor = (user: SessionUser, reply: FastifyReply): BrokerGateway | null => {
    const creds = getGatewayCredentials(db, user.id, 'kite');
    if (!creds) {
      reply.code(404);
      reply.send({ error: 'not_connected', message: 'Connect your Kite app first.' });
      return null;
    }
    if (!creds.accessToken) {
      reply.code(409);
      reply.send({ error: 'token_expired', message: 'Reconnect Kite for a fresh daily token before trading.' });
      return null;
    }
    return gatewayFactory({ apiKey: creds.apiKey, accessToken: creds.accessToken });
  };

  /** Map a broker throw to a verbatim 502; anything else bubbles to Fastify's error handler. */
  const brokerRejection = (reply: FastifyReply, err: unknown): { error: string; message: string } => {
    reply.code(502);
    return { error: 'broker_rejected', message: err instanceof Error ? err.message : 'broker request failed' };
  };

  fastify.get('/api/broker/orders', async (req, reply) => {
    const user = requirePro(req, db);
    const gw = gatewayFor(user, reply);
    if (!gw) return reply;
    try {
      return { items: await gw.getOrders() };
    } catch (err) {
      return brokerRejection(reply, err);
    }
  });

  fastify.get('/api/broker/positions', async (req, reply) => {
    const user = requirePro(req, db);
    const gw = gatewayFor(user, reply);
    if (!gw) return reply;
    try {
      return { items: await gw.getPositions() };
    } catch (err) {
      return brokerRejection(reply, err);
    }
  });

  fastify.post('/api/broker/orders', async (req, reply) => {
    const user = requirePro(req, db);
    const valid = validateOrderIntent(req.body);
    if (!valid.ok) {
      reply.code(400);
      return { error: 'invalid_intent', message: valid.error };
    }
    const gw = gatewayFor(user, reply);
    if (!gw) return reply;
    const auditId = recordOrderAudit(db, { userId: user.id, broker: 'kite', intent: valid.intent, placedVia: 'manual', egressIp: null });
    try {
      const ref = await gw.placeOrder(valid.intent);
      completeOrderAudit(db, auditId, { brokerOrderId: ref.brokerOrderId, status: 'placed' });
      return { ok: true, brokerOrderId: ref.brokerOrderId, auditId };
    } catch (err) {
      const rej = brokerRejection(reply, err);
      completeOrderAudit(db, auditId, { status: 'rejected', error: rej.message });
      return rej;
    }
  });

  fastify.put('/api/broker/orders/:id', async (req, reply) => {
    const user = requirePro(req, db);
    const brokerOrderId = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { changes?: unknown; variety?: unknown };
    const parsedChanges = modifyChangesSchema.safeParse(body.changes);
    if (!parsedChanges.success) {
      reply.code(400);
      return { error: 'invalid_changes', message: parsedChanges.error.issues[0]?.message ?? 'invalid changes' };
    }
    const variety = varietySchema.catch('regular').parse(body.variety);
    const gw = gatewayFor(user, reply);
    if (!gw) return reply;
    const auditId = recordOrderAudit(db, {
      userId: user.id, broker: 'kite', placedVia: 'manual', egressIp: null,
      intent: { action: 'modify', brokerOrderId, variety, changes: parsedChanges.data },
    });
    try {
      const ref = await gw.modifyOrder(brokerOrderId, parsedChanges.data, variety);
      completeOrderAudit(db, auditId, { brokerOrderId: ref.brokerOrderId, status: 'modified' });
      return { ok: true, brokerOrderId: ref.brokerOrderId };
    } catch (err) {
      const rej = brokerRejection(reply, err);
      completeOrderAudit(db, auditId, { status: 'rejected', error: rej.message });
      return rej;
    }
  });

  fastify.delete('/api/broker/orders/:id', async (req, reply) => {
    const user = requirePro(req, db);
    const brokerOrderId = (req.params as { id: string }).id;
    const variety = varietySchema.catch('regular').parse((req.query as { variety?: unknown } | undefined)?.variety);
    const gw = gatewayFor(user, reply);
    if (!gw) return reply;
    const auditId = recordOrderAudit(db, {
      userId: user.id, broker: 'kite', placedVia: 'manual', egressIp: null,
      intent: { action: 'cancel', brokerOrderId, variety },
    });
    try {
      await gw.cancelOrder(brokerOrderId, variety);
      completeOrderAudit(db, auditId, { brokerOrderId, status: 'cancelled' });
      return { ok: true };
    } catch (err) {
      const rej = brokerRejection(reply, err);
      completeOrderAudit(db, auditId, { status: 'rejected', error: rej.message });
      return rej;
    }
  });

  fastify.post('/api/broker/positions/exit', async (req, reply) => {
    const user = requirePro(req, db);
    const parsed = positionSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_position', message: parsed.error.issues[0]?.message ?? 'invalid position' };
    }
    const position = parsed.data as BrokerPosition;
    if (position.quantity === 0) {
      reply.code(400);
      return { error: 'position_flat', message: 'Position is already flat.' };
    }
    const gw = gatewayFor(user, reply);
    if (!gw) return reply;
    // The closing intent (market, opposite side) is what we audit — an exit is a real order attempt.
    const closingIntent: OrderIntent = {
      symbol: position.symbol, exchange: position.exchange,
      side: position.quantity > 0 ? 'sell' : 'buy', quantity: Math.abs(position.quantity),
      orderType: 'market', product: position.product.toLowerCase() as OrderIntent['product'],
    };
    const auditId = recordOrderAudit(db, { userId: user.id, broker: 'kite', intent: closingIntent, placedVia: 'manual', egressIp: null });
    try {
      const ref = await gw.exitPosition(position);
      completeOrderAudit(db, auditId, { brokerOrderId: ref.brokerOrderId, status: 'exited' });
      return { ok: true, brokerOrderId: ref.brokerOrderId };
    } catch (err) {
      const rej = brokerRejection(reply, err);
      completeOrderAudit(db, auditId, { status: 'rejected', error: rej.message });
      return rej;
    }
  });
}

const positionSchema = z.object({
  symbol: z.string().min(1),
  exchange: z.string().min(1),
  product: z.string().min(1),
  quantity: z.number().int(),
  averagePrice: z.number(),
  lastPrice: z.number(),
  pnl: z.number(),
});

/** The stored api_key drives the login URL for an existing (pending or active) connection. */
function loginKeyFor(db: AppDB, userId: string): string {
  const creds = getGatewayCredentials(db, userId, 'kite');
  return creds?.apiKey ?? '';
}
