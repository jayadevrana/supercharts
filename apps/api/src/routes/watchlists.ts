import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { getUser } from '../auth';

export function watchlistRoutes(fastify: FastifyInstance, db: AppDB): void {
  fastify.get('/api/watchlists', async (req) => {
    const user = getUser(req, db);
    const lists = db.raw
      .prepare('SELECT id, name, sort_order FROM watchlists WHERE user_id = ? ORDER BY sort_order ASC')
      .all(user.id) as Array<{ id: string; name: string; sort_order: number }>;
    const symRows = db.raw
      .prepare(
        `SELECT ws.id, ws.watchlist_id as watchlistId, ws.symbol_id as symbolId, ws.sort_order as sortOrder
         FROM watchlist_symbols ws JOIN watchlists w ON ws.watchlist_id = w.id WHERE w.user_id = ?`,
      )
      .all(user.id) as Array<{ id: string; watchlistId: string; symbolId: string; sortOrder: number }>;
    const grouped = new Map<string, typeof symRows>();
    for (const r of symRows) {
      const arr = grouped.get(r.watchlistId) ?? [];
      arr.push(r);
      grouped.set(r.watchlistId, arr);
    }
    return {
      items: lists.map((l) => ({
        id: l.id,
        name: l.name,
        symbols: (grouped.get(l.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.symbolId),
      })),
    };
  });

  fastify.post('/api/watchlists', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = z.object({ name: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    const id = nanoid();
    const now = Date.now();
    db.raw
      .prepare(
        'INSERT INTO watchlists (id, user_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, user.id, parsed.data.name, 0, now, now);
    return { id };
  });

  fastify.put('/api/watchlists/:id', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const parsed = z
      .object({ name: z.string().optional(), symbols: z.array(z.string()).optional() })
      .safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    if (parsed.data.name) {
      db.raw
        .prepare('UPDATE watchlists SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(parsed.data.name, Date.now(), id, user.id);
    }
    if (parsed.data.symbols) {
      const txn = db.raw.transaction((symbols: string[]) => {
        db.raw.prepare('DELETE FROM watchlist_symbols WHERE watchlist_id = ?').run(id);
        const stmt = db.raw.prepare(
          'INSERT INTO watchlist_symbols (id, watchlist_id, symbol_id, sort_order, added_at) VALUES (?, ?, ?, ?, ?)',
        );
        symbols.forEach((s, i) => stmt.run(nanoid(), id, s, i, Date.now()));
      });
      txn(parsed.data.symbols);
    }
    return { ok: true };
  });

  fastify.delete('/api/watchlists/:id', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM watchlists WHERE id = ? AND user_id = ?').run(id, user.id);
    return { ok: true };
  });
}
