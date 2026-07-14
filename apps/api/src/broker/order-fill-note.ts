/**
 * GW-7 polish (b): order-fill notifications.
 *
 * When an armed SuperTrend flip actually places (or is rejected by the broker for) a live order, the
 * owner should SEE money moving. This module builds the Telegram body; the alert-order executor
 * composes it over an injected sender (mirrors reconnect-nudge.ts). It is PURE + TESTED and never
 * places, reads, or touches an order.
 *
 * Only the two outcomes where an order was actually attempted generate a note:
 *   - `placed`          → an "opened"/"flipped" fill note with the broker order ids.
 *   - error `broker_rejected` → an honest failure note carrying the broker's verbatim message.
 * Routine gate states (skipped: kill-switch / daily-cap / not-whitelisted / token-expired), the
 * idempotent `noop` (already in that direction), and other errors (positions read failed, executor
 * backstop) move no money → NO note. The reconnect nudge + breaker Telegram already cover the
 * token/kill-switch cases and the arm UI surfaces the whitelist state, so we never double-spam.
 */

import type { BrokerId } from './types';
import type { FlipReason } from './flip-planner';

const BROKER_LABEL: Record<BrokerId, string> = { kite: 'Zerodha Kite', oanda: 'OANDA' };

export interface AutomationNoteContext {
  broker: BrokerId;
  tradingSymbol: string;
  exchange: string;
  side: 'buy' | 'sell';
  quantity: number;
  product: 'mis' | 'cnc' | 'nrml';
  appUrl?: string;
}

/**
 * Structural subset of the executor's `AlertOrderOutcome`, kept local so this pure module never
 * imports the executor (which imports flip-planner etc.) — avoids a circular dependency.
 */
export interface AutomationOutcomeLike {
  status: 'skipped' | 'noop' | 'placed' | 'error';
  flip?: FlipReason;
  brokerOrderIds?: string[];
  reason?: string;
  message?: string;
}

/** Escape for Telegram HTML parse mode so a broker string with < > & can't break the message. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HTML Telegram body for a successfully placed automated flip. */
export function formatOrderFillNote(
  ctx: AutomationNoteContext,
  flip: FlipReason,
  brokerOrderIds: string[],
): string {
  const label = BROKER_LABEL[ctx.broker] ?? ctx.broker;
  const dir = ctx.side === 'buy' ? 'long' : 'short';
  const verb = flip === 'flip' ? `Flipped to ${dir}` : `Opened ${dir}`;
  const emoji = ctx.side === 'buy' ? '🟢' : '🔴';
  const pair = `${esc(ctx.exchange)}:${esc(ctx.tradingSymbol)}`;
  const ids = brokerOrderIds.length ? `\nOrder ${brokerOrderIds.map(esc).join(' → ')}` : '';
  const link = ctx.appUrl ? `\n\n<a href="${esc(ctx.appUrl)}/terminal">Open terminal</a>` : '';
  return (
    `${emoji} <b>${verb} · ${pair}</b>\n` +
    `Automated ${ctx.side.toUpperCase()} ${ctx.quantity} (${ctx.product.toUpperCase()}) on ${label}.${ids}${link}`
  );
}

/** HTML Telegram body for a broker-rejected automated flip (owner must know it did NOT trade). */
export function formatOrderRejectNote(ctx: AutomationNoteContext, message: string): string {
  const label = BROKER_LABEL[ctx.broker] ?? ctx.broker;
  const pair = `${esc(ctx.exchange)}:${esc(ctx.tradingSymbol)}`;
  return (
    `⚠️ <b>Automated order rejected · ${pair}</b>\n` +
    `${label} rejected the ${ctx.side.toUpperCase()} ${ctx.quantity} (${ctx.product.toUpperCase()}) flip:\n` +
    `<i>${esc(message)}</i>`
  );
}

/** Map an executor outcome → the Telegram body, or null when nothing should be sent. */
export function buildAutomationNote(
  outcome: AutomationOutcomeLike,
  ctx: AutomationNoteContext,
): string | null {
  if (outcome.status === 'placed') {
    return formatOrderFillNote(ctx, outcome.flip ?? 'open', outcome.brokerOrderIds ?? []);
  }
  if (outcome.status === 'error' && outcome.reason === 'broker_rejected') {
    return formatOrderRejectNote(ctx, outcome.message ?? 'Unknown broker error');
  }
  return null;
}
