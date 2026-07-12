import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IngestionContext } from '@supercharts/ingestion';
import type { AppDB } from '../db';
import { requireAdmin } from '../auth';
import { KiteGateway } from '../broker/kite-gateway';
import {
  deleteConnection, getGatewayCredentials, listConnections, saveConnection, updateAccessToken,
} from '../broker/store';

/**
 * BYOB broker connections (GW-2). ADMIN-GATED until GW-4 ships the $15/mo plan gate —
 * no non-owner exposure of broker endpoints in production (spec §4 GW-3 note).
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

export function brokerRoutes(fastify: FastifyInstance, db: AppDB, ingestion?: IngestionContext): void {
  /** Revive the live Kite data feed with a fresh daily token — no server restart needed. */
  const hotSwapKiteFeed = (apiKey: string, accessToken: string): void => {
    void ingestion?.providers.kite.setCredentials(apiKey, accessToken).catch((err) => {
      fastify.log.warn({ err }, '[broker] kite feed hot-swap failed (data feed stays down until restart)');
    });
  };
  fastify.get('/api/broker/connections', async (req) => {
    const user = requireAdmin(req, db);
    const items = listConnections(db, user.id).map((c) => ({
      ...c,
      loginUrl: c.broker === 'kite' ? buildKiteLoginUrl(loginKeyFor(db, user.id)) : undefined,
    }));
    return { items };
  });

  fastify.post('/api/broker/connect', async (req, reply) => {
    const user = requireAdmin(req, db);
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
    const user = requireAdmin(req, db);
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
    const user = requireAdmin(req, db);
    const broker = (req.params as { broker: string }).broker;
    if (broker !== 'kite') {
      reply.code(400);
      return { error: 'unknown_broker' };
    }
    const removed = deleteConnection(db, user.id, broker);
    return { ok: removed };
  });
}

/** The stored api_key drives the login URL for an existing (pending or active) connection. */
function loginKeyFor(db: AppDB, userId: string): string {
  const creds = getGatewayCredentials(db, userId, 'kite');
  return creds?.apiKey ?? '';
}
