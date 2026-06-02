import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import { parseWebhookPayload, formatWebhookTelegram } from '../webhook-signal';
import { sendTelegramMessage } from '../telegram';

/**
 * Inbound webhook receiver (Phase 3 #15). Each user gets one secret URL,
 * `/api/webhooks/in/<token>`, that external systems (e.g. a TradingView alert) POST signals to.
 * Signals are normalised (webhook-signal.ts), stored, and — only when the user opts in — forwarded
 * to their existing Telegram bot. Forwarding reuses the live bot config read-only; it never
 * mutates the alerts/Telegram setup, and is OFF by default so test posts stay silent.
 */

const MAX_EVENTS = 200;

interface EndpointRow {
  user_id: string;
  token: string;
  forward_telegram: number;
  created_at: number;
}

function getOrCreateEndpoint(db: AppDB, userId: string): EndpointRow {
  const existing = db.raw
    .prepare('SELECT user_id, token, forward_telegram, created_at FROM webhook_endpoints WHERE user_id = ?')
    .get(userId) as EndpointRow | undefined;
  if (existing) return existing;
  const row: EndpointRow = { user_id: userId, token: nanoid(24), forward_telegram: 0, created_at: Date.now() };
  db.raw
    .prepare('INSERT INTO webhook_endpoints (user_id, token, forward_telegram, created_at) VALUES (?, ?, ?, ?)')
    .run(row.user_id, row.token, row.forward_telegram, row.created_at);
  return row;
}

function recentEvents(db: AppDB, userId: string, limit = 50): unknown[] {
  return db.raw
    .prepare(
      'SELECT id, received_at as receivedAt, symbol, action, price, note FROM webhook_events WHERE user_id = ? ORDER BY received_at DESC LIMIT ?',
    )
    .all(userId, limit);
}

export function webhookRoutes(fastify: FastifyInstance, db: AppDB): void {
  // Webhook senders use varied content types: JSON (default parser), text/plain (TradingView),
  // or form-encoded. Accept the latter two as raw strings — the parser still tries JSON first —
  // so an odd content type can't 415 before we even check the token. Harmless for JSON routes.
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded']) {
    if (!fastify.hasContentTypeParser(ct)) {
      fastify.addContentTypeParser(ct, { parseAs: 'string' }, (_req, body, done) => done(null, body));
    }
  }

  // ---- Public receiver (authenticated by the secret token in the path, not a cookie) ----
  fastify.post('/api/webhooks/in/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const ep = db.raw
      .prepare('SELECT user_id, forward_telegram FROM webhook_endpoints WHERE token = ?')
      .get(token) as { user_id: string; forward_telegram: number } | undefined;
    if (!ep) {
      reply.code(404);
      return { error: 'unknown_endpoint' };
    }

    const signal = parseWebhookPayload(req.body);
    const id = nanoid();
    const now = Date.now();
    db.raw
      .prepare(
        'INSERT INTO webhook_events (id, user_id, received_at, symbol, action, price, note, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, ep.user_id, now, signal.symbol, signal.action, signal.price, signal.note, JSON.stringify(signal.raw).slice(0, 4000));

    // Keep only the most recent MAX_EVENTS per user.
    db.raw
      .prepare(
        `DELETE FROM webhook_events WHERE user_id = ? AND id NOT IN (
           SELECT id FROM webhook_events WHERE user_id = ? ORDER BY received_at DESC LIMIT ?
         )`,
      )
      .run(ep.user_id, ep.user_id, MAX_EVENTS);

    // Opt-in Telegram forward — reuses the user's already-configured enabled bot, read-only.
    if (ep.forward_telegram) {
      const bot = db.raw
        .prepare(
          'SELECT bot_token as botToken, chat_id as chatId FROM telegram_bots WHERE user_id = ? AND enabled = 1 ORDER BY created_at ASC LIMIT 1',
        )
        .get(ep.user_id) as { botToken: string; chatId: string } | undefined;
      if (bot) {
        void sendTelegramMessage({ botToken: bot.botToken, chatId: bot.chatId, text: formatWebhookTelegram(signal) }).catch(
          () => {},
        );
      }
    }
    return { ok: true, id };
  });

  // ---- Authenticated management ----
  fastify.get('/api/webhooks/inbound', async (req) => {
    const user = getUser(req, db);
    const ep = getOrCreateEndpoint(db, user.id);
    return {
      token: ep.token,
      forwardTelegram: ep.forward_telegram === 1,
      path: `/api/webhooks/in/${ep.token}`,
      events: recentEvents(db, user.id),
    };
  });

  fastify.post('/api/webhooks/inbound/regenerate', async (req) => {
    const user = getUser(req, db);
    getOrCreateEndpoint(db, user.id);
    const token = nanoid(24);
    db.raw.prepare('UPDATE webhook_endpoints SET token = ? WHERE user_id = ?').run(token, user.id);
    return { token, path: `/api/webhooks/in/${token}` };
  });

  fastify.put('/api/webhooks/inbound', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = z.object({ forwardTelegram: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    getOrCreateEndpoint(db, user.id);
    db.raw
      .prepare('UPDATE webhook_endpoints SET forward_telegram = ? WHERE user_id = ?')
      .run(parsed.data.forwardTelegram ? 1 : 0, user.id);
    return { ok: true, forwardTelegram: parsed.data.forwardTelegram };
  });

  fastify.delete('/api/webhooks/inbound/events', async (req) => {
    const user = getUser(req, db);
    db.raw.prepare('DELETE FROM webhook_events WHERE user_id = ?').run(user.id);
    return { ok: true };
  });
}
