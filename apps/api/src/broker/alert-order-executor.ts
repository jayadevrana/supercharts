import type { AlertBrokerOrderConfig } from '@supercharts/types';
import type { AppDB } from '../db';
import type { BrokerPosition } from './types';
import { planFlip, type FlipReason } from './flip-planner';
import { evaluateAutomationGate } from './automation-gate';
import { resolveWriteGateway, type BrokerGatewayFactory } from './write-gateway';
import { recordOrderAudit, completeOrderAudit } from './store';
import { buildAutomationNote } from './order-fill-note';
import { startOfUtcDay } from '../dd-breaker';

/**
 * GW-7 alert → broker order executor.
 *
 * When a saved PulseScript (`mark buy`/`mark sell` / `alert()`) or an indicator alert fires for a
 * user who has opted a `delivery.brokerOrder` config onto that alert, this routes a **position-flip
 * market order** through the SAME audited pipeline manual trades use (`resolveWriteGateway` +
 * `broker_orders` audit-before-broker). It NEVER throws — the alert engine calls it fire-and-forget,
 * exactly like Telegram delivery, so a broker hiccup can't break the alert or the live feed.
 *
 * Safety layers, in order (all must pass before any order leaves):
 *   1. Kill-switch — the dd-breaker halt gate (shared with the MT5 signal runner).
 *   2. Per-alert daily cap — an in-memory UTC-day counter (mirrors the signal runner's `firesToday`).
 *   3. Write-plane preconditions — active Pro connection, fresh daily token, and a SEBI-whitelisted
 *      egress IP (resolveWriteGateway). Any missing precondition → an honest `skipped`, no broker call.
 *   4. Idempotent flip — already in the signalled direction → no-op (never stacks a position).
 *
 * The LOOP that builds this never arms live automation; the owner does. Every path here is proven
 * against a stub gateway in tests — no live order is ever placed by the build process.
 */
export interface AlertOrderExecuteInput {
  userId: string;
  alertId: string;
  side: 'buy' | 'sell';
  config: AlertBrokerOrderConfig;
  /** Audit provenance — 'alert' for ma_cross/indicator alerts, 'indicator' reserved for finer tagging. */
  placedVia: 'alert' | 'indicator';
  /**
   * GW-7 polish (b): when present, an order-fill Telegram note is sent (via the wired notifier) on a
   * placed/rejected flip. The engine sets this ONLY when the alert opted into Telegram delivery, so
   * the fill note respects the user's existing notification choice — never a surprise message.
   */
  notify?: { telegramBotId?: string };
}

export type AlertOrderOutcome =
  | { status: 'skipped'; reason: string; detail?: string }
  | { status: 'noop'; reason: 'already_long' | 'already_short' }
  | { status: 'placed'; brokerOrderIds: string[]; flip: FlipReason }
  | { status: 'error'; reason: string; message: string };

export interface AlertOrderExecutor {
  execute(input: AlertOrderExecuteInput): Promise<AlertOrderOutcome>;
}

/**
 * GW-7 polish (b): optional Telegram order-fill notifier. Injected so tests never hit Telegram and
 * the loop can prove every path against a stub. Omitted → the executor sends no notifications
 * (the default / legacy path).
 */
export interface AlertOrderNotifier {
  /** Resolve the user's Telegram bot (prefer the alert's chosen botId, else their default). */
  resolveBot: (
    userId: string,
    botId?: string,
  ) => { botToken: string; chatId: string; enabled: number } | undefined;
  send: (args: { botToken: string; chatId: string; text: string }) => Promise<void>;
  appUrl?: string;
}

export interface AlertOrderExecutorDeps {
  db: AppDB;
  gatewayFactory: BrokerGatewayFactory;
  /** Returns true when the dd-breaker has halted new automation for the day. */
  isKillSwitchHalted: () => boolean;
  /** GW-7 polish (b): when wired, order-fill Telegram notes are sent on placed/rejected flips. */
  notifier?: AlertOrderNotifier;
  now?: () => number;
  log?: (msg: string, extra?: unknown) => void;
}

export function createAlertOrderExecutor(deps: AlertOrderExecutorDeps): AlertOrderExecutor {
  const now = deps.now ?? (() => Date.now());
  // Per-alert flips acted on today (UTC). Restart-reset — same durability contract as the MT5
  // signal runner's `firesToday`; the kill-switch + whitelist gate are the hard, durable safety.
  const firesByAlert = new Map<string, { day: number; count: number }>();

  function tradesToday(alertId: string): number {
    const day = startOfUtcDay(now());
    const entry = firesByAlert.get(alertId);
    if (!entry || entry.day !== day) return 0;
    return entry.count;
  }
  function bumpToday(alertId: string): void {
    const day = startOfUtcDay(now());
    const entry = firesByAlert.get(alertId);
    if (!entry || entry.day !== day) firesByAlert.set(alertId, { day, count: 1 });
    else entry.count += 1;
  }

  /**
   * Send the order-fill Telegram note for a placed/rejected flip. Fire-and-forget: NEVER throws and
   * never changes the outcome — a wedged Telegram can't undo (or hide) a live order. Only runs when a
   * notifier is wired AND the alert opted into Telegram (`inp.notify` set).
   */
  async function notifyFill(inp: AlertOrderExecuteInput, outcome: AlertOrderOutcome): Promise<void> {
    const notifier = deps.notifier;
    if (!notifier || !inp.notify) return;
    try {
      const text = buildAutomationNote(outcome, {
        broker: inp.config.broker,
        tradingSymbol: inp.config.tradingSymbol,
        exchange: inp.config.exchange,
        side: inp.side,
        quantity: inp.config.quantity,
        product: inp.config.product,
        appUrl: notifier.appUrl,
      });
      if (!text) return; // noop / skipped / non-reject error → nothing to say
      const bot = notifier.resolveBot(inp.userId, inp.notify.telegramBotId);
      if (!bot || bot.enabled !== 1 || !bot.botToken || !bot.chatId) return;
      await notifier.send({ botToken: bot.botToken, chatId: bot.chatId, text });
    } catch (err) {
      deps.log?.('[gw7] order-fill notification failed', { alertId: inp.alertId, err });
    }
  }

  async function execute(inp: AlertOrderExecuteInput): Promise<AlertOrderOutcome> {
    const outcome = await runFlip(inp);
    await notifyFill(inp, outcome);
    return outcome;
  }

  async function runFlip(inp: AlertOrderExecuteInput): Promise<AlertOrderOutcome> {
    const { userId, alertId, side, config, placedVia } = inp;
    try {
      // 1 + 2: kill-switch + per-alert daily cap. Neither touches the broker.
      const gate = evaluateAutomationGate({
        killSwitchHalted: deps.isKillSwitchHalted(),
        tradesToday: tradesToday(alertId),
        maxTradesPerDay: config.maxTradesPerDay,
      });
      if (!gate.allowed) return { status: 'skipped', reason: gate.reason };

      // 3: write-plane preconditions (Pro connection, daily token, whitelisted egress IP).
      const resolved = resolveWriteGateway(deps.db, deps.gatewayFactory, userId, config.broker);
      if (!resolved.ok) return { status: 'skipped', reason: resolved.error, detail: resolved.message };
      const { readGw, writeGw, egressIp } = resolved.value;

      // Read the current position for THIS instrument+product (main IP) → signed size.
      let positions: BrokerPosition[];
      try {
        positions = await readGw.getPositions();
      } catch (err) {
        return { status: 'error', reason: 'positions_failed', message: errMsg(err) };
      }
      const match = positions.find(
        (p) =>
          p.symbol === config.tradingSymbol &&
          p.exchange === config.exchange &&
          p.product.toLowerCase() === config.product.toLowerCase(),
      );
      const currentSigned = match?.quantity ?? 0;

      // 4: plan the flip. No-op (already in direction) consumes no cap budget.
      const plan = planFlip({
        currentSigned,
        side,
        symbol: config.tradingSymbol,
        exchange: config.exchange,
        product: config.product,
        quantity: config.quantity,
      });
      if (plan.intents.length === 0) {
        return { status: 'noop', reason: plan.reason as 'already_long' | 'already_short' };
      }

      // Place each leg sequentially, audit BEFORE the broker (spec hard rule 5). If the close leg
      // rejects we STOP — never open a fresh side while the old position is still open.
      const brokerOrderIds: string[] = [];
      for (const intent of plan.intents) {
        const auditId = recordOrderAudit(deps.db, { userId, broker: config.broker, intent, placedVia, egressIp });
        try {
          const ref = await writeGw.placeOrder(intent);
          completeOrderAudit(deps.db, auditId, { brokerOrderId: ref.brokerOrderId, status: 'placed' });
          brokerOrderIds.push(ref.brokerOrderId);
        } catch (err) {
          const message = errMsg(err);
          completeOrderAudit(deps.db, auditId, { status: 'rejected', error: message });
          deps.log?.('[gw7] broker rejected an automated order', { alertId, message });
          return { status: 'error', reason: 'broker_rejected', message };
        }
      }
      bumpToday(alertId);
      return { status: 'placed', brokerOrderIds, flip: plan.reason };
    } catch (err) {
      // Absolute backstop — the executor must never throw into the alert engine.
      deps.log?.('[gw7] executor unexpected failure', { alertId: inp.alertId, err });
      return { status: 'error', reason: 'executor_failed', message: errMsg(err) };
    }
  }

  return { execute };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
