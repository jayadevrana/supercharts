import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDB } from '../db';
import { getUser } from '../auth';

const upsertSchema = z.object({
  paneId: z.string().min(1),
  symbol: z.string().min(1),
  interval: z.string().min(1),
  indicators: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      name: z.string().optional(),
      paneId: z.string(),
      inputs: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      style: z.record(z.union([z.string(), z.number()])).optional(),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
    }),
  ),
});

interface IndicatorLayoutRow {
  pane_id: string;
  symbol: string;
  interval: string;
  payload: string;
  updated_at: number;
}

export function indicatorRoutes(fastify: FastifyInstance, db: AppDB): void {
  fastify.get('/api/indicator-layouts', async (req) => {
    const user = getUser(req, db);
    const rows = db.raw
      .prepare(
        'SELECT pane_id, symbol, interval, payload, updated_at FROM indicator_layouts WHERE user_id = ?',
      )
      .all(user.id) as IndicatorLayoutRow[];
    return {
      items: rows.map((r) => ({
        paneId: r.pane_id,
        symbol: r.symbol,
        interval: r.interval,
        indicators: JSON.parse(r.payload),
        updatedAt: r.updated_at,
      })),
    };
  });

  fastify.put('/api/indicator-layouts', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_layout' };
    }
    const now = Date.now();
    const id = `${user.id}:${parsed.data.paneId}`;
    db.raw
      .prepare(
        `INSERT INTO indicator_layouts (id, user_id, pane_id, symbol, interval, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           symbol = excluded.symbol,
           interval = excluded.interval,
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        user.id,
        parsed.data.paneId,
        parsed.data.symbol,
        parsed.data.interval,
        JSON.stringify(parsed.data.indicators),
        now,
      );
    return { ok: true, updatedAt: now };
  });
}
