import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import { sanitizeStrategyForShare, type ShareableRecipe, type SharedStrategy } from '../strategy-share';

/**
 * Public strategy share links (Phase 4 #16). The owner publishes a strategy (a SignalRecipe) and
 * gets a stable `/s/<token>` link. The token resolves to a sanitized, read-only snapshot — see
 * strategy-share.ts for the trust boundary. The public read endpoint takes no auth: a snapshot is
 * already account-free, so anyone with the link can view the strategy, no one else's data.
 */

interface RecipeRow {
  name: string;
  symbol: string;
  interval: string;
  payload: string;
}

function loadShareable(db: AppDB, recipeId: string, userId: string): ShareableRecipe | null {
  const row = db.raw
    .prepare('SELECT name, symbol, interval, payload FROM signal_recipes WHERE id = ? AND user_id = ?')
    .get(recipeId, userId) as RecipeRow | undefined;
  if (!row) return null;
  let parsed: Partial<ShareableRecipe> = {};
  try {
    parsed = JSON.parse(row.payload) as Partial<ShareableRecipe>;
  } catch {
    /* fall back to defaults below */
  }
  return {
    name: row.name,
    symbol: row.symbol,
    interval: row.interval,
    logic: parsed.logic ?? 'all',
    conditions: parsed.conditions ?? [],
    actions: parsed.actions ?? [],
    indicatorSpecs: parsed.indicatorSpecs,
    maxTradesPerDay: parsed.maxTradesPerDay,
    maxDailyDrawdownPercent: parsed.maxDailyDrawdownPercent,
  };
}

export function shareRoutes(fastify: FastifyInstance, db: AppDB): void {
  // ---- Owner-authenticated management (keyed by recipe id) ----
  fastify.get('/api/signals/:id/share', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const row = db.raw
      .prepare('SELECT token FROM strategy_shares WHERE recipe_id = ? AND user_id = ?')
      .get(id, user.id) as { token: string } | undefined;
    return row ? { shared: true, token: row.token, path: `/s/${row.token}` } : { shared: false };
  });

  fastify.post('/api/signals/:id/share', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const shareable = loadShareable(db, id, user.id);
    if (!shareable) {
      reply.code(404);
      return { error: 'recipe_not_found' };
    }
    const snapshot = JSON.stringify(sanitizeStrategyForShare(shareable));
    const now = Date.now();
    const existing = db.raw
      .prepare('SELECT token FROM strategy_shares WHERE recipe_id = ? AND user_id = ?')
      .get(id, user.id) as { token: string } | undefined;
    if (existing) {
      // Re-share keeps the same link but refreshes the snapshot to the current strategy.
      db.raw.prepare('UPDATE strategy_shares SET snapshot = ?, created_at = ? WHERE recipe_id = ?').run(snapshot, now, id);
      return { shared: true, token: existing.token, path: `/s/${existing.token}` };
    }
    const token = nanoid(16);
    db.raw
      .prepare('INSERT INTO strategy_shares (token, recipe_id, user_id, snapshot, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(token, id, user.id, snapshot, now);
    return { shared: true, token, path: `/s/${token}` };
  });

  fastify.delete('/api/signals/:id/share', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM strategy_shares WHERE recipe_id = ? AND user_id = ?').run(id, user.id);
    return { ok: true };
  });

  // ---- Public read (no auth — the snapshot is already account-free) ----
  fastify.get('/api/public/strategy/:token', async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const row = db.raw
      .prepare('SELECT snapshot, created_at FROM strategy_shares WHERE token = ?')
      .get(token) as { snapshot: string; created_at: number } | undefined;
    if (!row) {
      reply.code(404);
      return { error: 'not_found' };
    }
    let strategy: SharedStrategy;
    try {
      strategy = JSON.parse(row.snapshot) as SharedStrategy;
    } catch {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { strategy, sharedAt: row.created_at };
  });
}
