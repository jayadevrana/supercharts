import type { Candle } from '@supercharts/types';

/**
 * Market Profile / TPO (Time Price Opportunity).
 *
 * Each completed UTC session is split into price rows; a row's TPO count is the
 * number of bars in that session whose [low, high] traded through it (each bar
 * is one time-price opportunity — a timeframe-agnostic stand-in for the classic
 * 30-minute letter, so it works on 1m…1h alike). The Point of Control is the
 * busiest row; the value area is the contiguous ±count band around the POC that
 * holds `valueAreaPercent` of all TPOs. Derived purely from real candles.
 */

export interface TPORow {
  price: number;
  count: number;
}

export interface SessionProfile {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  rowSize: number;
  rows: TPORow[];
  /** Price of the busiest (Point of Control) row. */
  poc: number;
  /** Value-area high / low prices. */
  vah: number;
  val: number;
  maxCount: number;
}

export interface MarketProfileOptions {
  /** Price rows per session. */
  bins?: number;
  /** Fraction of total TPOs the value area must cover (default 0.70). */
  valueAreaPercent?: number;
}

export function buildMarketProfiles(
  candles: readonly Candle[],
  opts: MarketProfileOptions = {},
): SessionProfile[] {
  const bins = Math.max(10, Math.floor(opts.bins ?? 40));
  const vaPct = Math.min(0.99, Math.max(0.1, opts.valueAreaPercent ?? 0.7));
  const n = candles.length;
  const out: SessionProfile[] = [];
  if (n === 0) return out;

  let i = 0;
  while (i < n) {
    const day = Math.floor(candles[i]!.openTime / 86_400_000);
    let j = i;
    let lo = Infinity;
    let hi = -Infinity;
    while (j < n && Math.floor(candles[j]!.openTime / 86_400_000) === day) {
      if (candles[j]!.low < lo) lo = candles[j]!.low;
      if (candles[j]!.high > hi) hi = candles[j]!.high;
      j++;
    }
    const start = i;
    const end = j - 1;
    i = j;
    if (!(hi > lo)) continue; // flat/degenerate session

    const rowSize = (hi - lo) / bins;
    const counts = new Int32Array(bins);
    for (let k = start; k <= end; k++) {
      const c = candles[k]!;
      const b0 = Math.max(0, Math.floor((c.low - lo) / rowSize));
      const b1 = Math.min(bins - 1, Math.floor((c.high - lo) / rowSize));
      for (let b = b0; b <= b1; b++) counts[b]! += 1;
    }

    let pocBin = 0;
    let maxCount = 0;
    let total = 0;
    for (let b = 0; b < bins; b++) {
      total += counts[b]!;
      if (counts[b]! > maxCount) {
        maxCount = counts[b]!;
        pocBin = b;
      }
    }
    if (total === 0) continue;

    // Value area: grow out from the POC, each step taking the higher-count side,
    // until the accumulated TPOs reach vaPct of the session total.
    const target = total * vaPct;
    let acc = counts[pocBin]!;
    let loBin = pocBin;
    let hiBin = pocBin;
    while (acc < target && (loBin > 0 || hiBin < bins - 1)) {
      const below = loBin > 0 ? counts[loBin - 1]! : -1;
      const above = hiBin < bins - 1 ? counts[hiBin + 1]! : -1;
      if (above >= below) {
        hiBin += 1;
        acc += Math.max(0, above);
      } else {
        loBin -= 1;
        acc += Math.max(0, below);
      }
    }

    const rows: TPORow[] = [];
    for (let b = 0; b < bins; b++) {
      if (counts[b]! > 0) rows.push({ price: lo + (b + 0.5) * rowSize, count: counts[b]! });
    }

    out.push({
      startIndex: start,
      endIndex: end,
      startTime: candles[start]!.openTime,
      endTime: candles[end]!.closeTime,
      rowSize,
      rows,
      poc: lo + (pocBin + 0.5) * rowSize,
      vah: lo + (hiBin + 1) * rowSize,
      val: lo + loBin * rowSize,
      maxCount,
    });
  }

  return out;
}
