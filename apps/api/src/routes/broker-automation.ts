import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { AlertDefinition, IndicatorAlertConfig, Interval } from '@supercharts/types';
import { INTERVALS } from '@supercharts/types';
import type { AppDB } from '../db';
import { requirePro } from '../auth';
import {
  buildSupertrendAutomation,
  type SupertrendAutomationLeg,
} from '../broker/supertrend-automation';
import {
  resolveWriteGateway,
  defaultKiteGatewayFactory,
  type BrokerGatewayFactory,
} from '../broker/write-gateway';
import { isTokenStale, formatReconnectNudge } from '../broker/reconnect-nudge';

/**
 * GW-7 FINAL-DELIVERY arm surface — the route that turns a SuperTrend + Kite-instrument config into
 * an ARMED position-flip automation the owner runs on any Kite instrument.
 *
 * `POST /api/broker/automation/supertrend` (requirePro + a whitelisted Kite connection) runs the
 * pure `buildSupertrendAutomation` (already tested), persists BOTH legs as ordinary indicator
 * alerts sharing one `automation_id`, subscribes them to the live engine, and returns the pair ids.
 * When either leg fires, the already-wired GW-7 executor (`delivery.brokerOrder`) flips the
 * position through the audited, egress-whitelisted pipeline — BUY→long, SELL→short.
 *
 * The gate reuses `resolveWriteGateway` (the SAME precondition the executor needs at fire time), so
 * you can only arm what could actually trade: connected + fresh daily token + whitelisted egress IP.
 * This route places NO order and mutates no broker state — it only writes alert rows and subscribes.
 *
 * `GET /api/broker/automation` lists the armed pairs; `DELETE /api/broker/automation/:id` disarms
 * one pair (deletes both legs + unsubscribes). Additive: nothing here touches the live MA-cross
 * alerts or MT5 — legacy alerts carry a NULL `automation_id`.
 */

/** The slice of the AlertEngine this route needs — injectable so tests use a recording stub. */
export interface AlertSubscriber {
  subscribe(alert: AlertDefinition): void;
  unsubscribe(alertId: string): void;
}

const INTERVAL_SET = new Set<Interval>(INTERVALS);

const armSchema = z.object({
  symbol: z.string().min(1).max(64),
  interval: z.string().refine((v) => INTERVAL_SET.has(v as Interval), 'unknown interval'),
  atrLength: z.coerce.number().int().min(1).max(200).optional(),
  multiplier: z.coerce.number().positive().max(50).optional(),
  tradingSymbol: z.string().min(1).max(64),
  exchange: z.string().min(1).max(16),
  quantity: z.coerce.number().int().positive(),
  product: z.enum(['mis', 'cnc', 'nrml']),
  maxTradesPerDay: z.coerce.number().int().positive().optional(),
  telegram: z.boolean().optional(),
  telegramBotId: z.string().max(64).optional(),
  timezone: z.string().min(2).max(40).optional(),
});

interface AlertRow {
  id: string;
  symbol: string;
  interval: string;
  automationId: string | null;
  config: string;
  enabled: number;
  createdAt: number;
}

export function brokerAutomationRoutes(
  fastify: FastifyInstance,
  db: AppDB,
  engine: AlertSubscriber,
  gatewayFactory: BrokerGatewayFactory = defaultKiteGatewayFactory,
): void {
  /** Persist one leg as an indicator alert tagged with the shared automation id, then subscribe it. */
  const persistLeg = (
    userId: string,
    automationId: string,
    leg: SupertrendAutomationLeg,
    now: number,
  ): AlertDefinition => {
    const id = nanoid();
    db.raw
      .prepare(
        `INSERT INTO alerts (id, user_id, symbol_id, interval, type, config, enabled, automation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, leg.symbol, leg.interval, 'indicator', JSON.stringify(leg.config), 1, automationId, now, now);
    const alert: AlertDefinition = {
      id,
      userId,
      symbol: leg.symbol,
      interval: leg.interval,
      type: 'indicator',
      enabled: true,
      config: leg.config,
      createdAt: now,
      updatedAt: now,
    };
    engine.subscribe(alert);
    return alert;
  };

  fastify.post('/api/broker/automation/supertrend', async (req, reply) => {
    const user = requirePro(req, db);
    const parsed = armSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }

    // Same gate the executor needs at fire time: connected + fresh token + whitelisted egress IP.
    // Reused verbatim so you can only arm an automation that could actually place its flip orders.
    const gate = resolveWriteGateway(db, gatewayFactory, user.id, 'kite');
    if (!gate.ok) {
      reply.code(gate.code);
      return gate.ip
        ? { error: gate.error, message: gate.message, ip: gate.ip }
        : { error: gate.error, message: gate.message };
    }

    let pair;
    try {
      pair = buildSupertrendAutomation({
        symbol: parsed.data.symbol,
        interval: parsed.data.interval as Interval,
        atrLength: parsed.data.atrLength,
        multiplier: parsed.data.multiplier,
        tradingSymbol: parsed.data.tradingSymbol,
        exchange: parsed.data.exchange,
        quantity: parsed.data.quantity,
        product: parsed.data.product,
        maxTradesPerDay: parsed.data.maxTradesPerDay,
        telegram: parsed.data.telegram,
        telegramBotId: parsed.data.telegramBotId,
        timezone: parsed.data.timezone,
      });
    } catch (err) {
      reply.code(400);
      return { error: 'invalid_config', message: err instanceof Error ? err.message : 'invalid config' };
    }

    const automationId = nanoid();
    const now = Date.now();
    const buy = persistLeg(user.id, automationId, pair.buy, now);
    const sell = persistLeg(user.id, automationId, pair.sell, now);
    return {
      automationId,
      symbol: parsed.data.symbol,
      interval: parsed.data.interval,
      egressIp: gate.value.egressIp,
      buy: { id: buy.id, label: pair.buy.config.label },
      sell: { id: sell.id, label: pair.sell.config.label },
    };
  });

  fastify.get('/api/broker/automation', async (req) => {
    const user = requirePro(req, db);
    const rows = db.raw
      .prepare(
        `SELECT id, symbol_id as symbol, interval, automation_id as automationId, config, enabled, created_at as createdAt
         FROM alerts WHERE user_id = ? AND automation_id IS NOT NULL AND type = 'indicator'
         ORDER BY created_at DESC`,
      )
      .all(user.id) as AlertRow[];

    const groups = new Map<string, AlertRow[]>();
    for (const row of rows) {
      const key = row.automationId as string;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    const items = [...groups.entries()].flatMap(([automationId, legs]) => {
      const parsedLegs = legs.map((l) => ({ row: l, config: JSON.parse(l.config) as IndicatorAlertConfig }));
      const buyLeg = parsedLegs.find((l) => l.config.side === 'buy');
      const sellLeg = parsedLegs.find((l) => l.config.side === 'sell');
      const ref = buyLeg ?? parsedLegs[0];
      if (!ref) return []; // a group always has ≥1 leg, but keep the compiler + runtime honest
      const spec = ref.config.indicatorSpecs?.[0] as { inputs?: { atrLength?: number; multiplier?: number } } | undefined;
      return [{
        automationId,
        symbol: ref.row.symbol,
        interval: ref.row.interval,
        enabled: legs.every((l) => l.enabled === 1),
        atrLength: spec?.inputs?.atrLength ?? null,
        multiplier: spec?.inputs?.multiplier ?? null,
        brokerOrder: ref.config.delivery.brokerOrder ?? null,
        buy: buyLeg ? { id: buyLeg.row.id, enabled: buyLeg.row.enabled === 1 } : null,
        sell: sellLeg ? { id: sellLeg.row.id, enabled: sellLeg.row.enabled === 1 } : null,
      }];
    });
    return { items };
  });

  /**
   * GW-7 polish (a): per-user daily-token reconnect status for the arm UI. Read-only. Tells the
   * caller whether their Kite daily token has gone stale while they have armed automations — the one
   * operational reason an armed flip silently stops trading. The daily 9:00 IST scheduler (main.ts,
   * env-gated) pushes the same message to Telegram; this route surfaces it in-app.
   */
  fastify.get('/api/broker/automation/reconnect-status', async (req) => {
    const user = requirePro(req, db);
    const conn = db.raw
      .prepare(
        "SELECT status, last_login_at as lastLoginAt FROM broker_connections WHERE user_id = ? AND broker = 'kite'",
      )
      .get(user.id) as { status: string; lastLoginAt: number | null } | undefined;
    const armedAutomationCount = (
      db.raw
        .prepare(
          "SELECT COUNT(DISTINCT automation_id) as n FROM alerts WHERE user_id = ? AND automation_id IS NOT NULL",
        )
        .get(user.id) as { n: number }
    ).n;
    const connected = conn?.status === 'active';
    const lastLoginAt = conn?.lastLoginAt ?? null;
    const stale = connected ? isTokenStale(lastLoginAt, Date.now()) : false;
    const needsReconnect = connected && stale && armedAutomationCount > 0;
    return {
      connected,
      armedAutomationCount,
      lastLoginAt,
      stale,
      needsReconnect,
      message: needsReconnect
        ? formatReconnectNudge({ userId: user.id, broker: 'kite', armedAutomationCount, lastLoginAt })
        : null,
    };
  });

  fastify.delete('/api/broker/automation/:automationId', async (req, reply) => {
    const user = requirePro(req, db);
    const automationId = (req.params as { automationId: string }).automationId;
    const ids = (
      db.raw
        .prepare('SELECT id FROM alerts WHERE user_id = ? AND automation_id = ?')
        .all(user.id, automationId) as Array<{ id: string }>
    ).map((r) => r.id);
    if (ids.length === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }
    for (const id of ids) {
      db.raw.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').run(id, user.id);
      db.raw.prepare('DELETE FROM alert_events WHERE alert_id = ? AND user_id = ?').run(id, user.id);
      engine.unsubscribe(id);
    }
    return { ok: true, removed: ids.length };
  });
}
