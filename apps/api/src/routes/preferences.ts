import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDB } from '../db';
import { getUser } from '../auth';

export function preferenceRoutes(fastify: FastifyInstance, db: AppDB): void {
  fastify.get('/api/preferences', async (req) => {
    const user = getUser(req, db);
    const row = db.raw
      .prepare('SELECT theme, preferences FROM user_preferences WHERE user_id = ?')
      .get(user.id) as { theme: string; preferences: string } | undefined;
    return {
      theme: row?.theme ?? 'dark',
      preferences: row ? JSON.parse(row.preferences) : {},
    };
  });

  fastify.put('/api/preferences', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = z
      .object({
        theme: z.enum(['dark', 'light', 'high_contrast', 'custom']).optional(),
        preferences: z.record(z.any()).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const existing = db.raw.prepare('SELECT user_id FROM user_preferences WHERE user_id = ?').get(user.id);
    if (existing) {
      db.raw
        .prepare(
          'UPDATE user_preferences SET theme = COALESCE(?, theme), preferences = COALESCE(?, preferences), updated_at = ? WHERE user_id = ?',
        )
        .run(parsed.data.theme ?? null, parsed.data.preferences ? JSON.stringify(parsed.data.preferences) : null, Date.now(), user.id);
    } else {
      db.raw
        .prepare(
          'INSERT INTO user_preferences (user_id, theme, preferences, updated_at) VALUES (?, ?, ?, ?)',
        )
        .run(user.id, parsed.data.theme ?? 'dark', JSON.stringify(parsed.data.preferences ?? {}), Date.now());
    }
    return { ok: true };
  });
}
