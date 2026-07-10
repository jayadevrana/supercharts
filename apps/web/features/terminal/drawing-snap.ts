/** Minimal candle shape the magnet needs — structural subset of `Candle`. */
export interface SnapCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Magnet snap: resolve a pointer (time, price) to the nearest candle's openTime and the
 * nearest of that candle's O/H/L/C values. The buffer is assumed time-ascending (the
 * chart-pane candle buffer invariant). Returns null when there is nothing to snap to.
 */
export function snapToOhlc(
  candles: readonly SnapCandle[],
  time: number,
  price: number,
): { time: number; price: number } | null {
  if (candles.length === 0) return null;

  // Binary search for the nearest candle by openTime.
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.openTime < time) lo = mid + 1;
    else hi = mid;
  }
  const right = candles[lo]!;
  const left = lo > 0 ? candles[lo - 1]! : right;
  const nearest =
    Math.abs(left.openTime - time) <= Math.abs(right.openTime - time) ? left : right;

  let snapped = nearest.open;
  let best = Math.abs(price - nearest.open);
  for (const v of [nearest.high, nearest.low, nearest.close]) {
    const d = Math.abs(price - v);
    if (d < best) {
      best = d;
      snapped = v;
    }
  }
  return { time: nearest.openTime, price: snapped };
}
