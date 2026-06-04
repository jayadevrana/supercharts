import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import { getTelegramChat, sendTelegramMessage } from '../telegram';
import { normalizeChannelId, MAX_BROADCAST_LEN } from '../telegram-broadcast';

/**
 * Telegram broadcast channels (Phase 4 #17). A user links a Telegram *channel* (where one of their
 * bots is an admin) and pushes one-to-many messages to it — separate from the private alert chat.
 *
 * This is additive: it reads the user's existing bots read-only and reuses the proven
 * `sendTelegramMessage`. It never modifies `telegram_bots` or the alert send path, so the live
 * alerts/Telegram config is untouched. Channel validation uses read-only `getChat` (no message).
 */

function botToken(db: AppDB, botId: string, userId: string): string | null {
  const row = db.raw
    .prepare('SELECT bot_token as t FROM telegram_bots WHERE id = ? AND user_id = ?')
    .get(botId, userId) as { t: string } | undefined;
  return row?.t ?? null;
}

export function broadcastRoutes(fastify: FastifyInstance, db: AppDB): void {
  fastify.get('/api/telegram/channels', async (req) => {
    const user = getUser(req, db);
    const items = db.raw
      .prepare(
        `SELECT c.id, c.channel_id as channelId, c.title, c.bot_id as botId,
                c.created_at as createdAt, c.verified_at as verifiedAt, b.label as botLabel
         FROM telegram_channels c LEFT JOIN telegram_bots b ON c.bot_id = b.id
         WHERE c.user_id = ? ORDER BY c.created_at DESC`,
      )
      .all(user.id);
    return { items };
  });

  // Add a channel. Validates with a read-only getChat — the bot must already be an admin of it.
  fastify.post('/api/telegram/channels', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = z.object({ botId: z.string().min(1), channel: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const token = botToken(db, parsed.data.botId, user.id);
    if (!token) {
      reply.code(404);
      return { error: 'bot_not_found', message: 'That bot no longer exists.' };
    }
    const channelId = normalizeChannelId(parsed.data.channel);
    if (!channelId) {
      reply.code(400);
      return { error: 'invalid_channel', message: 'Enter a channel @username or numeric id.' };
    }
    let chat: Awaited<ReturnType<typeof getTelegramChat>>;
    try {
      chat = await getTelegramChat(token, channelId);
    } catch (err) {
      reply.code(400);
      const detail = err instanceof Error ? err.message : 'unknown error';
      return {
        error: 'validation_failed',
        message: `Telegram couldn't reach that channel (${detail}). Add the bot as an admin of the channel and try again.`,
      };
    }
    const id = nanoid();
    const now = Date.now();
    db.raw
      .prepare(
        'INSERT INTO telegram_channels (id, user_id, bot_id, channel_id, title, created_at, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, user.id, parsed.data.botId, channelId, chat.title, now, now);
    return { id, channelId, title: chat.title, type: chat.type, botId: parsed.data.botId };
  });

  fastify.delete('/api/telegram/channels/:id', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM telegram_channels WHERE id = ? AND user_id = ?').run(id, user.id);
    return { ok: true };
  });

  // Broadcast a message to the channel. Real send — literal text (parseMode None) so arbitrary
  // user content can't break Telegram's HTML parser. Every attempt is logged (ok or error).
  fastify.post('/api/telegram/channels/:id/broadcast', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const parsed = z.object({ text: z.string().min(1).max(MAX_BROADCAST_LEN) }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', message: `Message must be 1–${MAX_BROADCAST_LEN} characters.` };
    }
    const chan = db.raw
      .prepare('SELECT channel_id as channelId, bot_id as botId FROM telegram_channels WHERE id = ? AND user_id = ?')
      .get(id, user.id) as { channelId: string; botId: string } | undefined;
    if (!chan) {
      reply.code(404);
      return { error: 'channel_not_found' };
    }
    const token = botToken(db, chan.botId, user.id);
    if (!token) {
      reply.code(404);
      return { error: 'bot_not_found' };
    }

    const now = Date.now();
    let ok = true;
    let errorMsg: string | null = null;
    try {
      await sendTelegramMessage({ botToken: token, chatId: chan.channelId, text: parsed.data.text, parseMode: 'None' });
    } catch (err) {
      ok = false;
      errorMsg = err instanceof Error ? err.message : 'send_failed';
    }
    db.raw
      .prepare('INSERT INTO telegram_broadcasts (id, user_id, channel_id, text, sent_at, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(nanoid(), user.id, id, parsed.data.text, now, ok ? 1 : 0, errorMsg);
    if (!ok) {
      reply.code(502);
      return { ok: false, message: `Telegram rejected the broadcast: ${errorMsg}` };
    }
    return { ok: true, sentAt: now };
  });

  fastify.get('/api/telegram/channels/:id/broadcasts', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const items = db.raw
      .prepare(
        'SELECT id, text, sent_at as sentAt, ok, error FROM telegram_broadcasts WHERE channel_id = ? AND user_id = ? ORDER BY sent_at DESC LIMIT 50',
      )
      .all(id, user.id);
    return { items };
  });
}
