/**
 * Translate a high-level OrderIntent into one or more MT5 wire commands.
 *
 * The hard problem this solves: the EA only knows about positions and
 * pending orders. Trader concepts like "split TP1/TP2/TP3 with break-even
 * after TP1" need to be decomposed into:
 *
 *   - one open order at entry with the initial SL and the first TP
 *   - a watcher that listens for the first leg's fill (via tick + positions
 *     snapshots), then issues a partial close at TP2 and TP3, and modifies
 *     the SL on the remainder to break-even.
 *
 * Trailing stops + break-even shifts are also tick-driven on the backend
 * side, not on the EA — the EA receives plain `mt5_modify` commands once
 * the trigger condition is met. Keeping all that logic server-side means
 * the trader sees the same behaviour across brokers and across EA builds.
 */

import { nanoid } from 'nanoid';
import type {
  MT5OpenOrderCommand,
  MT5Position,
  MT5Tick,
  OrderIntent,
  PartialCloseLeg,
} from '@supercharts/types';
import type { MT5Bridge } from './bridge';
import type { MT5Store } from './state';
import { priceDistanceToPips, resolveSizing, resolveStops, checkRisk } from './risk';

interface ScheduledPartial {
  positionId: string;
  legs: PartialCloseLeg[];
  /** Index of the next leg to fire. */
  nextIdx: number;
  side: 'buy' | 'sell';
  symbol: string;
}

interface TrailingPlan {
  positionId: string;
  distancePips: number;
  activationPips: number;
  stepPips: number;
  side: 'buy' | 'sell';
  /** Highest favorable price seen so far (long) / lowest (short). */
  bestPrice: number;
  /** Cached entry price for activation comparisons. */
  entry: number;
  symbol: string;
  /** Last SL we applied so we don't churn modify commands. */
  appliedSl: number;
}

interface BreakEvenPlan {
  positionId: string;
  triggerPips: number;
  offsetPips: number;
  side: 'buy' | 'sell';
  entry: number;
  symbol: string;
  applied: boolean;
}

export interface IntentRouter {
  submit: (
    accountId: string,
    intent: OrderIntent,
  ) => { intentId: string; ok: boolean; reason?: string };
  onTick: (accountId: string, tick: MT5Tick) => void;
  onPositionsSnapshot: (accountId: string, positions: MT5Position[]) => void;
  /** Direct close (UI button → close N% of an existing position). */
  closePosition: (
    accountId: string,
    positionId: string,
    fraction?: number,
  ) => { clientId: string; ok: boolean };
  /** Direct modify SL/TP of an existing position. */
  modifyPosition: (
    accountId: string,
    positionId: string,
    sl: number | undefined,
    tp: number | undefined,
  ) => { clientId: string; ok: boolean };
  /** Cancel a pending order. */
  cancelOrder: (
    accountId: string,
    pendingOrderId: string,
  ) => { clientId: string; ok: boolean };
}

export function createIntentRouter(opts: { bridge: MT5Bridge; store: MT5Store }): IntentRouter {
  const { bridge, store } = opts;

  // Position-id keyed schedules. When an intent yields a position, we keep
  // the partials/trailing/breakeven plans here. Position id is unknown
  // until the EA fills the entry, so we keep the plan first by intentId
  // and patch it in when the result comes back.
  const partialsByPos = new Map<string, ScheduledPartial>();
  const trailingByPos = new Map<string, TrailingPlan>();
  const breakEvenByPos = new Map<string, BreakEvenPlan>();
  // Pending plans keyed by intent until the position id arrives.
  const pendingPlans = new Map<
    string,
    { partials?: ScheduledPartial; trailing?: TrailingPlan; breakEven?: BreakEvenPlan }
  >();

  function attachPlans(
    intentId: string,
    positionId: string,
    side: 'buy' | 'sell',
    symbol: string,
    entry: number,
  ): void {
    const slot = pendingPlans.get(intentId);
    if (!slot) return;
    if (slot.partials) {
      slot.partials.positionId = positionId;
      slot.partials.side = side;
      slot.partials.symbol = symbol;
      partialsByPos.set(positionId, slot.partials);
    }
    if (slot.trailing) {
      slot.trailing.positionId = positionId;
      slot.trailing.side = side;
      slot.trailing.symbol = symbol;
      slot.trailing.entry = entry;
      slot.trailing.bestPrice = entry;
      slot.trailing.appliedSl = 0;
      trailingByPos.set(positionId, slot.trailing);
    }
    if (slot.breakEven) {
      slot.breakEven.positionId = positionId;
      slot.breakEven.side = side;
      slot.breakEven.symbol = symbol;
      slot.breakEven.entry = entry;
      slot.breakEven.applied = false;
      breakEvenByPos.set(positionId, slot.breakEven);
    }
    pendingPlans.delete(intentId);
  }

  function submit(accountId: string, intent: OrderIntent) {
    const account = store.account(accountId);
    const sym = account?.symbols.get(intent.symbol);
    const snapshot = account?.snapshot ?? null;
    const intentId = nanoid(12);
    if (!account || !account.connected) {
      store.registerIntent(intentId, intent);
      store.updateIntent(intentId, { state: 'rejected', message: 'account_offline' });
      store.emitIntent(intentId);
      return { intentId, ok: false, reason: 'account_offline' };
    }
    if (!sym) {
      store.registerIntent(intentId, intent);
      store.updateIntent(intentId, { state: 'rejected', message: 'unknown_symbol' });
      store.emitIntent(intentId);
      return { intentId, ok: false, reason: 'unknown_symbol' };
    }
    const sizing = resolveSizing(intent, sym, snapshot);
    const tick = account.ticks.get(intent.symbol);
    const refPrice =
      intent.price ?? (intent.side === 'buy' ? tick?.ask ?? 0 : tick?.bid ?? 0);
    if (refPrice <= 0) {
      store.registerIntent(intentId, intent);
      store.updateIntent(intentId, { state: 'rejected', message: 'no_tick' });
      store.emitIntent(intentId);
      return { intentId, ok: false, reason: 'no_tick' };
    }
    const stops = resolveStops(intent, sym, refPrice);
    const initialSl = stops.sl;
    const initialTp =
      intent.partials && intent.partials.length > 0 ? intent.partials[0]!.price : stops.tp;
    const risk = checkRisk(
      intent,
      sym,
      snapshot,
      sizing,
      account.positions.size,
      {
        maxOpenPositions: 50,
        maxLotsPerOrder: Math.min(50, sym.volumeMax || 50),
      },
    );
    if (!risk.ok) {
      store.registerIntent(intentId, intent);
      store.updateIntent(intentId, { state: 'rejected', message: risk.reason });
      store.emitIntent(intentId);
      return { intentId, ok: false, reason: risk.reason };
    }
    store.registerIntent(intentId, intent);

    const clientId = nanoid(12);
    const cmd: MT5OpenOrderCommand = {
      type: 'mt5_open',
      clientId,
      symbol: intent.symbol,
      side: intent.side,
      kind: intent.kind,
      volume: sizing.volumeLots,
      price: intent.kind === 'market' ? undefined : intent.price,
      stopLimitPrice: intent.stopLimitPrice,
      sl: initialSl || undefined,
      tp: initialTp || undefined,
      tif: intent.tif,
      expiresAt: intent.expiresAt,
      deviationPoints: intent.deviationPoints ?? 20,
      comment: intent.comment ?? 'sc',
      magic: 880011,
      recipeId: intent.recipeId,
    };
    bridge.trackClientId(accountId, clientId, intentId);
    const sent = bridge.send(accountId, cmd);
    if (!sent) {
      store.updateIntent(intentId, { state: 'rejected', message: 'bridge_offline' });
      store.emitIntent(intentId);
      return { intentId, ok: false, reason: 'bridge_offline' };
    }
    store.updateIntent(intentId, { state: 'sent' });
    store.emitIntent(intentId);

    // Schedule downstream plans against the eventual position id.
    const slot: { partials?: ScheduledPartial; trailing?: TrailingPlan; breakEven?: BreakEvenPlan } = {};
    if (intent.partials && intent.partials.length > 0) {
      slot.partials = {
        positionId: '',
        legs: intent.partials,
        nextIdx: 0,
        side: intent.side,
        symbol: intent.symbol,
      };
    }
    if (intent.trailing) {
      slot.trailing = {
        positionId: '',
        distancePips: intent.trailing.distancePips,
        activationPips: intent.trailing.activationPips ?? 0,
        stepPips: intent.trailing.stepPips ?? Math.max(1, intent.trailing.distancePips / 5),
        side: intent.side,
        bestPrice: refPrice,
        entry: refPrice,
        symbol: intent.symbol,
        appliedSl: 0,
      };
    }
    if (intent.breakEven) {
      slot.breakEven = {
        positionId: '',
        triggerPips: intent.breakEven.triggerPips,
        offsetPips: intent.breakEven.offsetPips ?? 0,
        side: intent.side,
        entry: refPrice,
        symbol: intent.symbol,
        applied: false,
      };
    }
    if (slot.partials || slot.trailing || slot.breakEven) {
      pendingPlans.set(intentId, slot);
    }
    return { intentId, ok: true };
  }

  function onTick(accountId: string, tick: MT5Tick): void {
    const account = store.account(accountId);
    if (!account) return;
    const sym = account.symbols.get(tick.symbol);
    if (!sym) return;
    // Trailing
    for (const plan of trailingByPos.values()) {
      if (plan.symbol !== tick.symbol) continue;
      const pos = account.positions.get(plan.positionId);
      if (!pos) {
        trailingByPos.delete(plan.positionId);
        continue;
      }
      const px = plan.side === 'buy' ? tick.bid : tick.ask;
      const progressPips = priceDistanceToPips(
        plan.side === 'buy' ? px - plan.entry : plan.entry - px,
        sym,
      );
      if (progressPips < plan.activationPips) continue;
      const better =
        plan.side === 'buy' ? px > plan.bestPrice : px < plan.bestPrice;
      if (better) plan.bestPrice = px;
      const trailDistance = priceDistanceToPips(
        plan.side === 'buy' ? plan.bestPrice - px : px - plan.bestPrice,
        sym,
      );
      if (trailDistance < plan.distancePips) continue;
      // Pull SL to (bestPrice -/+ distance)
      const slCandidate =
        plan.side === 'buy'
          ? plan.bestPrice - (plan.distancePips * sym.point * (sym.digits === 5 || sym.digits === 3 ? 10 : 1))
          : plan.bestPrice + (plan.distancePips * sym.point * (sym.digits === 5 || sym.digits === 3 ? 10 : 1));
      const stepPriceDelta = plan.stepPips * sym.point * (sym.digits === 5 || sym.digits === 3 ? 10 : 1);
      const farEnough =
        plan.appliedSl === 0 ||
        Math.abs(slCandidate - plan.appliedSl) >= stepPriceDelta;
      if (!farEnough) continue;
      bridge.send(accountId, {
        type: 'mt5_modify',
        clientId: nanoid(10),
        positionId: plan.positionId,
        sl: slCandidate,
        tp: pos.tp || undefined,
      });
      plan.appliedSl = slCandidate;
    }
    // Break-even
    for (const plan of breakEvenByPos.values()) {
      if (plan.applied) continue;
      if (plan.symbol !== tick.symbol) continue;
      const pos = account.positions.get(plan.positionId);
      if (!pos) {
        breakEvenByPos.delete(plan.positionId);
        continue;
      }
      const px = plan.side === 'buy' ? tick.bid : tick.ask;
      const pips = priceDistanceToPips(
        plan.side === 'buy' ? px - plan.entry : plan.entry - px,
        sym,
      );
      if (pips < plan.triggerPips) continue;
      const offset = plan.offsetPips * sym.point * (sym.digits === 5 || sym.digits === 3 ? 10 : 1);
      const newSl = plan.side === 'buy' ? plan.entry + offset : plan.entry - offset;
      bridge.send(accountId, {
        type: 'mt5_modify',
        clientId: nanoid(10),
        positionId: plan.positionId,
        sl: newSl,
        tp: pos.tp || undefined,
      });
      plan.applied = true;
    }
    // Partials
    for (const plan of partialsByPos.values()) {
      if (plan.symbol !== tick.symbol) continue;
      const pos = account.positions.get(plan.positionId);
      if (!pos) {
        partialsByPos.delete(plan.positionId);
        continue;
      }
      const leg = plan.legs[plan.nextIdx];
      if (!leg) continue;
      const px = plan.side === 'buy' ? tick.bid : tick.ask;
      const reached = plan.side === 'buy' ? px >= leg.price : px <= leg.price;
      if (!reached) continue;
      bridge.send(accountId, {
        type: 'mt5_close',
        clientId: nanoid(10),
        positionId: plan.positionId,
        fraction: leg.fraction,
        comment: leg.label,
      });
      if (leg.moveSlToBreakEvenAfter) {
        const offset = (leg.breakEvenOffsetPips ?? 0) * sym.point * (sym.digits === 5 || sym.digits === 3 ? 10 : 1);
        const newSl = plan.side === 'buy' ? pos.openPrice + offset : pos.openPrice - offset;
        bridge.send(accountId, {
          type: 'mt5_modify',
          clientId: nanoid(10),
          positionId: plan.positionId,
          sl: newSl,
          tp: pos.tp || undefined,
        });
      }
      plan.nextIdx += 1;
      if (plan.nextIdx >= plan.legs.length) partialsByPos.delete(plan.positionId);
    }
  }

  function onPositionsSnapshot(accountId: string, _positions: MT5Position[]): void {
    // When a position appears for one of our pending intents, attach the plans.
    const account = store.account(accountId);
    if (!account) return;
    for (const [intentId, slot] of pendingPlans) {
      const intent = store.intent(intentId);
      if (!intent) continue;
      const candidate = [...account.positions.values()].find(
        (p) =>
          p.recipeId === intent.intent.recipeId &&
          p.symbol === intent.intent.symbol &&
          p.side === intent.intent.side,
      );
      if (candidate) {
        attachPlans(intentId, candidate.id, candidate.side, candidate.symbol, candidate.openPrice);
      } else if (intent.position) {
        attachPlans(
          intentId,
          intent.position.id,
          intent.position.side,
          intent.position.symbol,
          intent.position.openPrice,
        );
      }
      void slot;
    }
  }

  function closePosition(accountId: string, positionId: string, fraction?: number) {
    const clientId = nanoid(12);
    const sent = bridge.send(accountId, {
      type: 'mt5_close',
      clientId,
      positionId,
      fraction: fraction ?? 1,
    });
    if (fraction == null || fraction >= 0.999) {
      partialsByPos.delete(positionId);
      trailingByPos.delete(positionId);
      breakEvenByPos.delete(positionId);
    }
    return { clientId, ok: sent };
  }

  function modifyPosition(
    accountId: string,
    positionId: string,
    sl: number | undefined,
    tp: number | undefined,
  ) {
    const clientId = nanoid(12);
    const sent = bridge.send(accountId, {
      type: 'mt5_modify',
      clientId,
      positionId,
      sl,
      tp,
    });
    return { clientId, ok: sent };
  }

  function cancelOrder(accountId: string, pendingOrderId: string) {
    const clientId = nanoid(12);
    const sent = bridge.send(accountId, {
      type: 'mt5_cancel',
      clientId,
      pendingOrderId,
    });
    return { clientId, ok: sent };
  }

  return { submit, onTick, onPositionsSnapshot, closePosition, modifyPosition, cancelOrder };
}
