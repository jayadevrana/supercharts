import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { getUser } from '../auth';

/**
 * Saved PulseScript user scripts (Phase 6 task 7). Same shape/pattern as chart layouts:
 * per-user rows, list newest-first, create / load / rename+update / delete. The `source`
 * is plain PulseScript text — the language/runtime lives in `@supercharts/script-lang`.
 */
const scriptSchema = z.object({
  name: z.string().min(1).max(120),
  source: z.string().max(100_000),
});

interface ScriptRow {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export function scriptRoutes(fastify: FastifyInstance, db: AppDB): void {
  fastify.get('/api/scripts', async (req) => {
    const user = getUser(req, db);
    const rows = db.raw
      .prepare(
        `SELECT id, name, source, created_at as createdAt, updated_at as updatedAt
         FROM user_scripts WHERE user_id = ? ORDER BY updated_at DESC`,
      )
      .all(user.id) as ScriptRow[];
    return { items: rows };
  });

  fastify.get('/api/scripts/:id', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const row = db.raw
      .prepare(
        `SELECT id, name, source, created_at as createdAt, updated_at as updatedAt
         FROM user_scripts WHERE id = ? AND user_id = ?`,
      )
      .get(id, user.id) as ScriptRow | undefined;
    if (!row) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return row;
  });

  fastify.post('/api/scripts', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = scriptSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const id = nanoid();
    const now = Date.now();
    db.raw
      .prepare(`INSERT INTO user_scripts (id, user_id, name, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, user.id, parsed.data.name, parsed.data.source, now, now);
    return { id, createdAt: now, updatedAt: now };
  });

  fastify.put('/api/scripts/:id', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const parsed = scriptSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const existing = db.raw.prepare('SELECT id FROM user_scripts WHERE id = ? AND user_id = ?').get(id, user.id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const now = Date.now();
    db.raw
      .prepare(
        `UPDATE user_scripts SET name = COALESCE(?, name), source = COALESCE(?, source), updated_at = ? WHERE id = ? AND user_id = ?`,
      )
      .run(parsed.data.name ?? null, parsed.data.source ?? null, now, id, user.id);
    return { ok: true, updatedAt: now };
  });

  fastify.delete('/api/scripts/:id', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM user_scripts WHERE id = ? AND user_id = ?').run(id, user.id);
    return { ok: true };
  });
}
