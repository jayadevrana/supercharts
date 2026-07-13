import type { OrderIntent } from './types';

/**
 * Position-flip order planner (GW-7). PURE + TESTED so the automation semantics the SuperTrend
 * strategy depends on are pinned independently of the broker, the alert engine, and Fastify.
 *
 * Semantics (per the BYOB final-delivery goal):
 *   - BUY signal  → end state = LONG `quantity`.  From short → close the short, then open long.
 *   - SELL signal → end state = SHORT `quantity`. From long  → close the long, then open short.
 *   - Already in that direction → NO-OP. We never stack or resize an existing position (idempotent),
 *     so a strategy that re-emits the same side on consecutive bars can't pyramid.
 *
 * All emitted orders are MARKET orders (a flip must fill now, not rest). The close leg is sized to
 * the *actual* open quantity (`|currentSigned|`) so we flatten exactly, and the open leg to the
 * configured target `quantity`. Emitting the close as a distinct order (rather than one netting
 * order) keeps the audit trail explicit — every leg lands in `broker_orders`.
 */
export type FlipReason = 'open' | 'flip' | 'already_long' | 'already_short';

export interface FlipPlanInput {
  /** Signed current position for THIS instrument+product: >0 long, <0 short, 0 flat. */
  currentSigned: number;
  /** The signal side that just fired. */
  side: 'buy' | 'sell';
  symbol: string;
  exchange: string;
  product: OrderIntent['product'];
  /** Target position size after the flip (> 0). */
  quantity: number;
}

export interface FlipPlan {
  intents: OrderIntent[];
  reason: FlipReason;
}

export function planFlip(input: FlipPlanInput): FlipPlan {
  const { currentSigned, side, symbol, exchange, product, quantity } = input;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`planFlip: quantity must be a positive number (got ${quantity})`);
  }

  const openIntent: OrderIntent = {
    symbol, exchange, side, quantity, orderType: 'market', product, variety: 'regular',
  };

  // Already in the target direction → idempotent no-op.
  if (side === 'buy' && currentSigned > 0) return { intents: [], reason: 'already_long' };
  if (side === 'sell' && currentSigned < 0) return { intents: [], reason: 'already_short' };

  // Flat → a single open in the signalled direction.
  if (currentSigned === 0) return { intents: [openIntent], reason: 'open' };

  // Opposite direction open → close it first (market, opposite of the current position), then open.
  const closeIntent: OrderIntent = {
    symbol,
    exchange,
    side, // buying to close a short, or selling to close a long — same side as the new signal
    quantity: Math.abs(currentSigned),
    orderType: 'market',
    product,
    variety: 'regular',
  };
  return { intents: [closeIntent, openIntent], reason: 'flip' };
}
