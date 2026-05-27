import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import type { DrawingObject } from '@supercharts/types';

const pointSchema = z.object({ time: z.number(), price: z.number() });

const drawingSchema = z.object({
  layoutId: z.string().optional(),
  symbol: z.string(),
  type: z.string(),
  points: z.array(pointSchema),
  style: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  text: z.string().optional(),
  emoji: z.string().optional(),
  iconName: z.string().optional(),
  table: z.any().optional(),
  riskReward: z.any().optional(),
  fib: z.any().optional(),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  zIndex: z.number().default(0),
  groupId: z.string().optional(),
});

export function drawingRoutes(fastify: FastifyInstance, db: AppDB): void {
  fastify.get('/api/drawings', async (req) => {
    const user = getUser(req, db);
    const { symbol, layoutId } = req.query as { symbol?: string; layoutId?: string };
    const where: string[] = ['user_id = ?'];
    const args: unknown[] = [user.id];
    if (symbol) {
      where.push('symbol_id = ?');
      args.push(symbol);
    }
    if (layoutId) {
      where.push('layout_id = ?');
      args.push(layoutId);
    }
    const rows = db.raw
      .prepare(
        `SELECT id, user_id as userId, layout_id as layoutId, symbol_id as symbol, type, payload, z_index as zIndex, locked, visible, created_at as createdAt, updated_at as updatedAt
         FROM drawing_objects WHERE ${where.join(' AND ')} ORDER BY z_index ASC, created_at ASC`,
      )
      .all(...args) as Array<{
      id: string;
      userId: string;
      layoutId: string | null;
      symbol: string;
      type: string;
      payload: string;
      zIndex: number;
      locked: number;
      visible: number;
      createdAt: number;
      updatedAt: number;
    }>;
    return {
      items: rows.map(rowToDrawing),
    };
  });

  fastify.post('/api/drawings', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = drawingSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }
    const now = Date.now();
    const id = nanoid();
    const payload = JSON.stringify({
      points: parsed.data.points,
      style: parsed.data.style,
      text: parsed.data.text,
      emoji: parsed.data.emoji,
      iconName: parsed.data.iconName,
      table: parsed.data.table,
      riskReward: parsed.data.riskReward,
      fib: parsed.data.fib,
      groupId: parsed.data.groupId,
    });
    db.raw
      .prepare(
        `INSERT INTO drawing_objects (id, user_id, layout_id, symbol_id, type, payload, z_index, locked, visible, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.id,
        parsed.data.layoutId ?? null,
        parsed.data.symbol,
        parsed.data.type,
        payload,
        parsed.data.zIndex,
        parsed.data.locked ? 1 : 0,
        parsed.data.visible ? 1 : 0,
        now,
        now,
      );
    return {
      drawing: rowToDrawing({
        id,
        userId: user.id,
        layoutId: parsed.data.layoutId ?? null,
        symbol: parsed.data.symbol,
        type: parsed.data.type,
        payload,
        zIndex: parsed.data.zIndex,
        locked: parsed.data.locked ? 1 : 0,
        visible: parsed.data.visible ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      }),
    };
  });

  fastify.put('/api/drawings/:id', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const parsed = drawingSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const existing = db.raw
      .prepare('SELECT * FROM drawing_objects WHERE id = ? AND user_id = ?')
      .get(id, user.id) as { payload: string } | undefined;
    if (!existing) {
      reply.code(404);
      return { error: 'not_found' };
    }
    // Merge ONLY the payload-shaped fields into the JSON blob. The previous code spread
    // every parsed field (incl. `symbol`, `type`, `layoutId`, `zIndex`, `locked`,
    // `visible`) into the blob, where `rowToDrawing` would later read them and shadow
    // the canonical row columns — so updates to row-column fields silently reverted on
    // the next GET.
    const payloadPatch: Record<string, unknown> = {};
    if (parsed.data.points !== undefined) payloadPatch.points = parsed.data.points;
    if (parsed.data.style !== undefined) payloadPatch.style = parsed.data.style;
    if (parsed.data.text !== undefined) payloadPatch.text = parsed.data.text;
    if (parsed.data.emoji !== undefined) payloadPatch.emoji = parsed.data.emoji;
    if (parsed.data.iconName !== undefined) payloadPatch.iconName = parsed.data.iconName;
    if (parsed.data.table !== undefined) payloadPatch.table = parsed.data.table;
    if (parsed.data.riskReward !== undefined) payloadPatch.riskReward = parsed.data.riskReward;
    if (parsed.data.fib !== undefined) payloadPatch.fib = parsed.data.fib;
    if (parsed.data.groupId !== undefined) payloadPatch.groupId = parsed.data.groupId;
    const merged = { ...JSON.parse(existing.payload), ...payloadPatch };
    db.raw
      .prepare(
        `UPDATE drawing_objects SET payload = ?, z_index = COALESCE(?, z_index), locked = COALESCE(?, locked), visible = COALESCE(?, visible), updated_at = ? WHERE id = ? AND user_id = ?`,
      )
      .run(
        JSON.stringify(merged),
        parsed.data.zIndex ?? null,
        parsed.data.locked == null ? null : parsed.data.locked ? 1 : 0,
        parsed.data.visible == null ? null : parsed.data.visible ? 1 : 0,
        Date.now(),
        id,
        user.id,
      );
    return { ok: true };
  });

  fastify.delete('/api/drawings/:id', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM drawing_objects WHERE id = ? AND user_id = ?').run(id, user.id);
    return { ok: true };
  });

  fastify.post('/api/drawings/bulk', async (req, reply) => {
    const user = getUser(req, db);
    // Validate the wrapper AND every item up front so a single bad row returns 400 to
    // the client instead of throwing mid-transaction and surfacing as a 500. The whole
    // batch still runs inside a single transaction below.
    const bulkSchema = z.object({ items: z.array(drawingSchema).max(500) });
    const parsedBulk = bulkSchema.safeParse(req.body);
    if (!parsedBulk.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsedBulk.error.flatten() };
    }
    const items = parsedBulk.data.items;
    const stmt = db.raw.prepare(
      `INSERT INTO drawing_objects (id, user_id, layout_id, symbol_id, type, payload, z_index, locked, visible, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    const txn = db.raw.transaction((rows: typeof items) => {
      for (const p of rows) {
        const id = nanoid();
        stmt.run(
          id,
          user.id,
          p.layoutId ?? null,
          p.symbol,
          p.type,
          JSON.stringify({
            points: p.points,
            style: p.style,
            text: p.text,
            emoji: p.emoji,
            iconName: p.iconName,
            table: p.table,
            riskReward: p.riskReward,
            fib: p.fib,
            groupId: p.groupId,
          }),
          p.zIndex,
          p.locked ? 1 : 0,
          p.visible ? 1 : 0,
          now,
          now,
        );
      }
    });
    txn(items);
    return { ok: true, count: items.length };
  });
}

function rowToDrawing(row: {
  id: string;
  userId: string;
  layoutId: string | null;
  symbol: string;
  type: string;
  payload: string;
  zIndex: number;
  locked: number;
  visible: number;
  createdAt: number;
  updatedAt: number;
}): DrawingObject {
  const payload = JSON.parse(row.payload) as Omit<DrawingObject, 'id' | 'userId' | 'layoutId' | 'symbol' | 'type' | 'zIndex' | 'locked' | 'visible' | 'createdAt' | 'updatedAt'>;
  return {
    id: row.id,
    userId: row.userId,
    layoutId: row.layoutId ?? undefined,
    symbol: row.symbol,
    type: row.type as DrawingObject['type'],
    points: payload.points ?? [],
    style: payload.style ?? { strokeColor: '#7c9cff', strokeWidth: 1.4 },
    text: payload.text,
    emoji: payload.emoji,
    iconName: payload.iconName,
    table: payload.table,
    riskReward: payload.riskReward,
    fib: payload.fib,
    groupId: payload.groupId,
    locked: row.locked === 1,
    visible: row.visible === 1,
    zIndex: row.zIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
