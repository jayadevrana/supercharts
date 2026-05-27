import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { IndicatorInstance, SignalAction, SignalCondition, SignalRecipe } from '@supercharts/types';
import { SYMBOL_CATALOG } from '@supercharts/types';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import type { SignalRunner } from '../mt5/signal-runner';

const sizingSchema = z.union([
  z.object({ mode: z.literal('fixed_lots'), lots: z.number().positive() }),
  z.object({ mode: z.literal('risk_percent'), percent: z.number().positive(), slPips: z.number().positive() }),
  z.object({ mode: z.literal('cash_risk'), amount: z.number().positive(), slPips: z.number().positive() }),
]);

const stopSchema = z.object({ price: z.number().optional(), pips: z.number().optional() }).optional();

const partialsSchema = z
  .array(
    z.object({
      label: z.string(),
      price: z.number().positive(),
      fraction: z.number().min(0.01).max(1),
      moveSlToBreakEvenAfter: z.boolean().optional(),
      breakEvenOffsetPips: z.number().optional(),
    }),
  )
  .optional();

const filterSchema = z
  .object({
    side: z.enum(['buy', 'sell']).optional(),
    recipeId: z.string().optional(),
  })
  .optional();

const indicatorInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  inputs: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(),
});

const recipeSchema = z.object({
  name: z.string().min(1).max(80),
  accountId: z.string().min(1),
  symbol: z.string().min(1),
  interval: z.string(),
  enabled: z.boolean(),
  logic: z.enum(['all', 'any']),
  conditions: z.array(z.unknown()),
  indicatorSpecs: z.array(indicatorInstanceSchema).optional(),
  actions: z.array(
    z.union([
      z.object({
        type: z.literal('open_position'),
        side: z.enum(['buy', 'sell']),
        kind: z.enum(['market', 'limit', 'stop', 'stop_limit']),
        sizing: sizingSchema,
        sl: stopSchema,
        tp: stopSchema,
        partials: partialsSchema,
        trailing: z.object({
          distancePips: z.number().positive(),
          activationPips: z.number().nonnegative().optional(),
          stepPips: z.number().positive().optional(),
        }).optional(),
        breakEven: z.object({ triggerPips: z.number().positive(), offsetPips: z.number().optional() }).optional(),
        maxOpen: z.number().int().positive().optional(),
        cooldownSec: z.number().int().nonnegative().optional(),
      }),
      z.object({ type: z.literal('close_all'), filter: filterSchema }),
      z.object({ type: z.literal('partial_close'), fraction: z.number().min(0.01).max(1), filter: filterSchema }),
      z.object({
        type: z.literal('move_sl'),
        mode: z.enum(['breakeven', 'price', 'pips_from_entry', 'pips_from_current']),
        price: z.number().optional(),
        pips: z.number().optional(),
        filter: filterSchema,
      }),
      z.object({
        type: z.literal('set_trailing'),
        distancePips: z.number().positive(),
        activationPips: z.number().nonnegative().optional(),
        stepPips: z.number().positive().optional(),
        filter: filterSchema,
      }),
    ]),
  ),
  maxTradesPerDay: z.number().int().positive().optional(),
  maxDailyDrawdownPercent: z.number().positive().optional(),
});

interface SignalRecipeRow {
  id: string;
  user_id: string;
  account_id: string;
  symbol: string;
  interval: string;
  enabled: number;
  name: string;
  payload: string;
  created_at: number;
  updated_at: number;
}

function rowToRecipe(row: SignalRecipeRow): SignalRecipe {
  const payload = JSON.parse(row.payload) as Pick<
    SignalRecipe,
    'logic' | 'conditions' | 'actions' | 'maxTradesPerDay' | 'maxDailyDrawdownPercent' | 'indicatorSpecs'
  >;
  return {
    ...payload,
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    symbol: row.symbol,
    interval: row.interval,
    enabled: row.enabled === 1,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function signalRoutes(fastify: FastifyInstance, db: AppDB, runner: SignalRunner): void {
  fastify.get('/api/signals', async (req) => {
    const user = getUser(req, db);
    const rows = db.raw
      .prepare(
        'SELECT id, user_id, account_id, symbol, interval, enabled, name, payload, created_at, updated_at FROM signal_recipes WHERE user_id = ?',
      )
      .all(user.id) as SignalRecipeRow[];
    return { items: rows.map(rowToRecipe) };
  });

  fastify.post('/api/signals', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = recipeSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_recipe', details: parsed.error.flatten() };
    }
    const now = Date.now();
    const id = `r_${nanoid(12)}`;
    const payload = JSON.stringify({
      logic: parsed.data.logic,
      conditions: parsed.data.conditions,
      actions: parsed.data.actions,
      indicatorSpecs: parsed.data.indicatorSpecs,
      maxTradesPerDay: parsed.data.maxTradesPerDay,
      maxDailyDrawdownPercent: parsed.data.maxDailyDrawdownPercent,
    });
    db.raw
      .prepare(
        `INSERT INTO signal_recipes (id, user_id, account_id, symbol, interval, enabled, name, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.id,
        parsed.data.accountId,
        parsed.data.symbol,
        parsed.data.interval,
        parsed.data.enabled ? 1 : 0,
        parsed.data.name,
        payload,
        now,
        now,
      );
    const recipe: SignalRecipe = {
      id,
      userId: user.id,
      accountId: parsed.data.accountId,
      symbol: parsed.data.symbol,
      interval: parsed.data.interval,
      enabled: parsed.data.enabled,
      logic: parsed.data.logic,
      conditions: parsed.data.conditions as SignalRecipe['conditions'],
      actions: parsed.data.actions as SignalRecipe['actions'],
      indicatorSpecs: parsed.data.indicatorSpecs as SignalRecipe['indicatorSpecs'],
      name: parsed.data.name,
      maxTradesPerDay: parsed.data.maxTradesPerDay,
      maxDailyDrawdownPercent: parsed.data.maxDailyDrawdownPercent,
      createdAt: now,
      updatedAt: now,
    };
    if (recipe.enabled) runner.upsert(recipe);
    return recipe;
  });

  fastify.put<{ Params: { id: string } }>('/api/signals/:id', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = recipeSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_recipe' };
    }
    const now = Date.now();
    const payload = JSON.stringify({
      logic: parsed.data.logic,
      conditions: parsed.data.conditions,
      actions: parsed.data.actions,
      indicatorSpecs: parsed.data.indicatorSpecs,
      maxTradesPerDay: parsed.data.maxTradesPerDay,
      maxDailyDrawdownPercent: parsed.data.maxDailyDrawdownPercent,
    });
    const result = db.raw
      .prepare(
        `UPDATE signal_recipes
         SET account_id = ?, symbol = ?, interval = ?, enabled = ?, name = ?, payload = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        parsed.data.accountId,
        parsed.data.symbol,
        parsed.data.interval,
        parsed.data.enabled ? 1 : 0,
        parsed.data.name,
        payload,
        now,
        req.params.id,
        user.id,
      );
    if (Number(result.changes) === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }
    const row = db.raw
      .prepare(
        'SELECT id, user_id, account_id, symbol, interval, enabled, name, payload, created_at, updated_at FROM signal_recipes WHERE id = ?',
      )
      .get(req.params.id) as SignalRecipeRow;
    const recipe = rowToRecipe(row);
    if (recipe.enabled) runner.upsert(recipe);
    else runner.remove(recipe.id);
    return recipe;
  });

  fastify.delete<{ Params: { id: string } }>('/api/signals/:id', async (req, reply) => {
    const user = getUser(req, db);
    const result = db.raw
      .prepare('DELETE FROM signal_recipes WHERE id = ? AND user_id = ?')
      .run(req.params.id, user.id);
    if (Number(result.changes) === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }
    runner.remove(req.params.id);
    return { ok: true };
  });

  /* ─── Bulk MT5 automation from a watchlist ─── */

  fastify.post('/api/signals/bulk-subscribe', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = bulkSubscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }
    const targets = parsed.data.symbols ?? SYMBOL_CATALOG.map((s) => s.id);
    if (targets.length === 0) {
      reply.code(400);
      return { error: 'no_symbols' };
    }

    // Idempotency floor — recipes already present for this user with the same
    // (accountId, symbol, interval, name) are skipped. We bake the recipe naming
    // convention into a tag so re-running this endpoint never duplicates.
    const existing = db.raw
      .prepare(
        `SELECT account_id as accountId, symbol, interval, name FROM signal_recipes WHERE user_id = ?`,
      )
      .all(user.id) as Array<{ accountId: string; symbol: string; interval: string; name: string }>;
    const have = new Set(existing.map((r) => `${r.accountId}|${r.symbol}|${r.interval}|${r.name}`));

    const { interval, ma, sizing, sides, sl, tp, maxOpen, cooldownSec, maxTradesPerDay } = parsed.data;
    const indicatorSpec: IndicatorInstance = {
      id: `ma_${ma.type}_${ma.length}`,
      type: ma.type,
      name: `${ma.type.toUpperCase()}(${ma.length})`,
      paneId: 'price',
      inputs: { length: ma.length, source: ma.source },
      style: { color: '#f5d524' },
      visible: true,
      locked: false,
    };

    const insertStmt = db.raw.prepare(
      `INSERT INTO signal_recipes (id, user_id, account_id, symbol, interval, enabled, name, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const created: SignalRecipe[] = [];
    let skipped = 0;
    const now = Date.now();

    for (const sym of targets) {
      for (const side of sides) {
        const tag = side === 'buy' ? 'BUY' : 'SELL';
        const name = `${tag} · MA cross ${ma.type.toUpperCase()}(${ma.length}) ${ma.source} · ${interval}`;
        const dedupKey = `${parsed.data.accountId}|${sym}|${interval}|${name}`;
        if (have.has(dedupKey)) {
          skipped += 1;
          continue;
        }
        const condition: SignalCondition = {
          type: 'price_crosses',
          source: 'close',
          operator: side === 'buy' ? 'crosses_above' : 'crosses_below',
          target: { kind: 'indicator', indicator: indicatorSpec.id, channel: 'value' },
        };
        const action: SignalAction = {
          type: 'open_position',
          side,
          kind: 'market',
          sizing,
          sl,
          tp,
          maxOpen,
          cooldownSec,
        };
        const recipe: SignalRecipe = {
          id: `r_${nanoid(12)}`,
          userId: user.id,
          accountId: parsed.data.accountId,
          symbol: sym,
          interval,
          enabled: true,
          name,
          logic: 'all',
          conditions: [condition],
          actions: [action],
          indicatorSpecs: [indicatorSpec],
          maxTradesPerDay,
          createdAt: now,
          updatedAt: now,
        };
        const payload = JSON.stringify({
          logic: recipe.logic,
          conditions: recipe.conditions,
          actions: recipe.actions,
          indicatorSpecs: recipe.indicatorSpecs,
          maxTradesPerDay: recipe.maxTradesPerDay,
          maxDailyDrawdownPercent: recipe.maxDailyDrawdownPercent,
        });
        insertStmt.run(
          recipe.id,
          recipe.userId,
          recipe.accountId,
          recipe.symbol,
          recipe.interval,
          1,
          recipe.name,
          payload,
          now,
          now,
        );
        runner.upsert(recipe);
        created.push(recipe);
      }
    }

    return { created: created.length, skipped, items: created };
  });
}

/* ─── Bulk-subscribe schema (declared after route module so the closure types
 * above resolve cleanly). ───────────────────────────────────────────────── */
const bulkSubscribeSchema = z.object({
  accountId: z.string().min(1),
  interval: z.string(),
  /** Subset of catalog. Omit to apply to every supported symbol. */
  symbols: z.array(z.string()).optional(),
  ma: z.object({
    type: z.enum(['sma', 'ema', 'rma', 'wma']),
    length: z.number().int().min(2).max(500),
    source: z.enum(['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4']),
  }),
  sides: z.array(z.enum(['buy', 'sell'])).min(1),
  sizing: sizingSchema,
  sl: z.object({ price: z.number().optional(), pips: z.number().optional() }).optional(),
  tp: z.object({ price: z.number().optional(), pips: z.number().optional() }).optional(),
  maxOpen: z.number().int().positive().optional(),
  cooldownSec: z.number().int().nonnegative().optional(),
  maxTradesPerDay: z.number().int().positive().optional(),
});
