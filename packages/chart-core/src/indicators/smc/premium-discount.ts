import type { BarLike } from './shared';
import { computeMarketStructure } from './market-structure';

export interface PremiumDiscountInputs {
  swingLen: number;
  /** Show OTE 0.618–0.786 inside the discount/premium band. */
  showOTE: boolean;
}

export const DEFAULT_PD_INPUTS: PremiumDiscountInputs = {
  swingLen: 50,
  showOTE: true,
};

export interface PremiumDiscountRange {
  startIndex: number;
  startTime: number;
  high: number;
  low: number;
  eq: number;
  /** OTE retracement levels — top of discount / bottom of premium. */
  ote: { low: number; high: number };
}

/**
 * Most-recent swing-high / swing-low range from the swing-length structure pipeline.
 * Splits into discount (low → eq) and premium (eq → high). Optional OTE band uses the
 * 0.618-0.786 fib retracement that LuxAlgo + ICT promote.
 */
export function computePremiumDiscount(
  bars: ReadonlyArray<BarLike>,
  inputs: PremiumDiscountInputs = DEFAULT_PD_INPUTS,
): PremiumDiscountRange | null {
  const ms = computeMarketStructure(bars, { pivotLen: inputs.swingLen, atrFilterMult: 0.15 });
  if (!ms.lastSwingHigh || !ms.lastSwingLow) return null;
  const hi = ms.lastSwingHigh.price;
  const lo = ms.lastSwingLow.price;
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  const range = hi - lo;
  if (range <= 0) return null;
  return {
    startIndex: Math.min(ms.lastSwingHigh.index, ms.lastSwingLow.index),
    startTime: bars[Math.min(ms.lastSwingHigh.index, ms.lastSwingLow.index)]!.openTime,
    high: hi,
    low: lo,
    eq: lo + range * 0.5,
    ote: { low: lo + range * 0.618, high: lo + range * 0.786 },
  };
}
