import type { OrderBookDelta } from '@supercharts/types';

/** Best bid/ask extracted from a depth snapshot, stamped with the exchange event time. */
export interface TopOfBook {
  bid: number;
  ask: number;
  time: number;
}

/**
 * Top-of-book from an order-book delta (depth20 arrays: bids desc, asks asc — index 0 is
 * the touch). Returns null for empty, non-finite, non-positive, or crossed books so the
 * buy/sell buttons can only ever show a real, sane market. Never fabricates a spread.
 */
export function topOfBook(
  delta: Pick<OrderBookDelta, 'bids' | 'asks' | 'eventTime'>,
): TopOfBook | null {
  const bid = delta.bids?.[0]?.[0];
  const ask = delta.asks?.[0]?.[0];
  if (bid === undefined || ask === undefined) return null;
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
  if (bid <= 0 || ask <= 0) return null;
  if (ask < bid) return null; // crossed book — corrupt frame, drop it
  return { bid, ask, time: delta.eventTime };
}

/** Raw spread (ask − bid) formatted TV-style: "0.01" on BTC, "12" on indices, sub-pip ok. */
export function formatSpread(bid: number, ask: number): string {
  const s = ask - bid;
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s === 0) return '0';
  if (s >= 100) return s.toFixed(0);
  if (s >= 0.01) return s.toFixed(2);
  if (s >= 0.0001) return s.toFixed(4);
  return s.toPrecision(2);
}

/** True when the snapshot is too old to honestly display (feed stalled / venue offline). */
export function isStaleBook(top: TopOfBook | null, nowMs: number, maxAgeMs = 10_000): boolean {
  if (!top) return true;
  return nowMs - top.time > maxAgeMs;
}
