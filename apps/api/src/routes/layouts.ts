import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { getUser } from '../auth';

const layoutSchema = z.object({
  name: z.string().min(1),
  grid: z.enum(['1', '2', '4', '8', '16']),
  config: z.any(),
  isDefault: z.boolean().optional(),
});

export function layoutRoutes(fastify: FastifyInstance, db: AppDB): void {
  fastify.get('/api/layouts', async (req) => {
    const user = getUser(req, db);
    const rows = db.raw
      .prepare(
        `SELECT id, name, grid, config, is_default as isDefault, created_at as createdAt, updated_at as updatedAt
         FROM chart_layouts WHERE user_id = ? ORDER BY updated_at DESC`,
      )
      .all(user.id) as Array<{ id: string; name: string; grid: string; config: string; isDefault: number; createdAt: number; updatedAt: number }>;
    return {
      items: rows.map((r) => ({
        ...r,
        isDefault: r.isDefault === 1,
        config: JSON.parse(r.config),
      })),
    };
  });

  fastify.post('/api/layouts', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = layoutSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const id = nanoid();
    const now = Date.now();
    db.raw
      .prepare(
        `INSERT INTO chart_layouts (id, user_id, name, grid, config, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.id,
        parsed.data.name,
        parsed.data.grid,
        JSON.stringify(parsed.data.config),
        parsed.data.isDefault ? 1 : 0,
        now,
        now,
      );
    return { id };
  });

  fastify.put('/api/layouts/:id', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const parsed = layoutSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const existing = db.raw
      .prepare('SELECT id FROM chart_layouts WHERE id = ? AND user_id = ?')
      .get(id, user.id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    db.raw
      .prepare(
        `UPDATE chart_layouts SET name = COALESCE(?, name), grid = COALESCE(?, grid), config = COALESCE(?, config), is_default = COALESCE(?, is_default), updated_at = ? WHERE id = ? AND user_id = ?`,
      )
      .run(
        parsed.data.name ?? null,
        parsed.data.grid ?? null,
        // Use `=== undefined` rather than truthy: config legitimately can be `null`,
        // `false`, `0`, or `""`, all of which the old truthy check skipped.
        parsed.data.config === undefined ? null : JSON.stringify(parsed.data.config),
        parsed.data.isDefault == null ? null : parsed.data.isDefault ? 1 : 0,
        Date.now(),
        id,
        user.id,
      );
    return { ok: true };
  });

  fastify.delete('/api/layouts/:id', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM chart_layouts WHERE id = ? AND user_id = ?').run(id, user.id);
    return { ok: true };
  });
}
