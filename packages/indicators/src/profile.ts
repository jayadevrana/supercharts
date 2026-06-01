import type { Candle } from '@supercharts/types';

/**
 * Market-profile-family indicators derived from candle volume.
 *
 * POC (Point of Control) here uses the same OHLCV approximation as the app's
 * Volume Profile (VPVR): each candle's real traded volume is spread uniformly
 * across the price bins its [low, high] range spans, and the POC is the
 * highest-volume bin. This is the standard volume-profile-on-OHLCV method —
 * the volume is real Binance/exchange volume; only the intra-bar distribution
 * is approximated (true tick distribution needs footprint/L2 data).
 */

export interface NakedPOCOptions {
  /** Price bins per session profile. */
  bins?: number;
  /** Keep only the most recent N session POCs (bounds work + chart clutter). */
  maxLevels?: number;
}

export interface NakedPOCLevel {
  /** POC price for the session that produced this level. */
  price: number;
  /** Candle index where that session ended — the level's line starts here. */
  fromIndex: number;
  /** First later index whose range traded through the POC (line ends), else last index. */
  toIndex: number;
  /** True when price never traded back to the POC within the data → still "naked"/virgin. */
  naked: boolean;
}

/**
 * Naked / Virgin POC — the volume Point of Control of each completed UTC
 * session, drawn forward until price trades back through it. Levels that are
 * never revisited stay "naked" and extend to the latest bar; those are the
 * untested high-interest prices traders watch as magnets. The still-forming
 * current session is skipped (its POC isn't final yet).
 */
export function nakedPOC(candles: readonly Candle[], opts: NakedPOCOptions = {}): NakedPOCLevel[] {
  const bins = Math.max(10, Math.floor(opts.bins ?? 50));
  const maxLevels = Math.max(1, Math.floor(opts.maxLevels ?? 25));
  const n = candles.length;
  if (n === 0) return [];

  // Group contiguous candle index ranges by UTC session day.
  const sessions: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < n) {
    const day = Math.floor(candles[i]!.openTime / 86_400_000);
    let j = i;
    while (j < n && Math.floor(candles[j]!.openTime / 86_400_000) === day) j++;
    sessions.push({ start: i, end: j - 1 });
    i = j;
  }

  const levels: NakedPOCLevel[] = [];
  // Skip the last session — it's still forming, so its POC isn't final.
  for (let s = 0; s < sessions.length - 1; s++) {
    const { start, end } = sessions[s]!;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = start; k <= end; k++) {
      if (candles[k]!.low < lo) lo = candles[k]!.low;
      if (candles[k]!.high > hi) hi = candles[k]!.high;
    }
    if (!(hi > lo)) continue; // degenerate (flat) session — no meaningful POC
    const rowSize = (hi - lo) / bins;
    const vol = new Float64Array(bins);
    for (let k = start; k <= end; k++) {
      const c = candles[k]!;
      const b0 = Math.max(0, Math.floor((c.low - lo) / rowSize));
      const b1 = Math.min(bins - 1, Math.floor((c.high - lo) / rowSize));
      const per = c.volume / (b1 - b0 + 1);
      for (let b = b0; b <= b1; b++) vol[b]! += per;
    }
    let pocBin = 0;
    let pocVol = -1;
    for (let b = 0; b < bins; b++) {
      if (vol[b]! > pocVol) {
        pocVol = vol[b]!;
        pocBin = b;
      }
    }
    const price = lo + (pocBin + 0.5) * rowSize;

    // Walk forward: the first candle whose range straddles the POC "fills" it.
    let toIndex = n - 1;
    let naked = true;
    for (let k = end + 1; k < n; k++) {
      if (candles[k]!.low <= price && price <= candles[k]!.high) {
        toIndex = k;
        naked = false;
        break;
      }
    }
    levels.push({ price, fromIndex: end, toIndex, naked });
  }

  return levels.slice(-maxLevels);
}
