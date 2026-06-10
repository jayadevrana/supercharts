/**
 * Smooth price-scale auto-fit — pure math (unit-tested).
 *
 * TradingView's price axis fluidly follows the data while you pan/fling through
 * history instead of letting candles drift off-screen, and refits ease instead of
 * hard-cutting. The animated state machine lives in ChartCore; everything
 * deterministic lives here:
 *
 *  - `fitTarget`      — lo/hi + padding → target [min,max] (same math as PriceScale.fit)
 *  - `smoothStep`     — frame-rate-independent exponential approach toward a target
 *  - `isNearRange`    — animate vs snap guard (a symbol-sized jump must hard-cut,
 *                       never "fly" the axis across orders of magnitude)
 *  - `rangesOverlap`  — does new data still intersect the current manual range?
 */

export interface PriceRange {
  min: number;
  max: number;
}

/** Identical math to PriceScale.fit so the animation lands exactly where a snap would. */
export function fitTarget(lowestPrice: number, highestPrice: number, paddingFraction = 0.07): PriceRange {
  const span = Math.max(highestPrice - lowestPrice, lowestPrice * 1e-6, 1e-9);
  const pad = span * paddingFraction;
  return { min: lowestPrice - pad, max: highestPrice + pad };
}

/**
 * Advance `current` toward `target` by an exponential approach with time constant
 * `tauMs` (≈63% of the remaining distance covered every tau). Using `1 - exp(-dt/tau)`
 * makes the motion identical whether the browser delivers one 16ms frame or two 8ms
 * frames. Returns the next range plus `done` once the remainder is visually zero
 * (then the caller should snap to `target` exactly).
 */
export function smoothStep(
  current: PriceRange,
  target: PriceRange,
  dtMs: number,
  tauMs = 100,
): { next: PriceRange; done: boolean } {
  if (dtMs <= 0) return { next: { ...current }, done: false };
  const k = 1 - Math.exp(-dtMs / Math.max(tauMs, 1));
  let min = current.min + (target.min - current.min) * k;
  let max = current.max + (target.max - current.max) * k;
  const span = Math.max(target.max - target.min, 1e-9);
  const eps = span * 1e-3;
  const done = Math.abs(target.min - min) < eps && Math.abs(target.max - max) < eps;
  if (done) {
    min = target.min;
    max = target.max;
  }
  return { next: { min, max }, done };
}

export function rangesOverlap(a: PriceRange, b: PriceRange): boolean {
  return a.min <= b.max && b.min <= a.max;
}

/**
 * Should a refit animate (`true`) or snap (`false`)?
 * Animate only when the move reads as "the same market breathing": spans within 8×
 * of each other and the gap between ranges under 2× the larger span. A jump like
 * BTC 60k→EURUSD 1.07 (or any degenerate/non-finite range) snaps — easing across
 * that would send candles flying and look broken.
 */
export function isNearRange(current: PriceRange, target: PriceRange): boolean {
  if (
    !Number.isFinite(current.min) ||
    !Number.isFinite(current.max) ||
    !Number.isFinite(target.min) ||
    !Number.isFinite(target.max)
  ) {
    return false;
  }
  const curSpan = current.max - current.min;
  const tgtSpan = target.max - target.min;
  if (curSpan <= 0 || tgtSpan <= 0) return false;
  const ratio = curSpan > tgtSpan ? curSpan / tgtSpan : tgtSpan / curSpan;
  if (ratio > 8) return false;
  const bigSpan = Math.max(curSpan, tgtSpan);
  const gap = rangesOverlap(current, target)
    ? 0
    : current.min > target.max
      ? current.min - target.max
      : target.min - current.max;
  return gap <= bigSpan * 2;
}
