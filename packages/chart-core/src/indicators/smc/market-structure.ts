import { detectPivots, type BarLike, type Pivot } from './shared';

export interface MarketStructureInputs {
  /** Pivot lookback used to discover swings. */
  pivotLen: number;
  /** ATR-scaled buffer so micro-pokes don't register as a BOS. */
  atrFilterMult: number;
}

export const DEFAULT_MS_INPUTS: MarketStructureInputs = {
  pivotLen: 5,
  atrFilterMult: 0.15,
};

export type StructureEventKind = 'BOS' | 'CHoCH';

export interface StructureEvent {
  index: number;
  time: number;
  kind: StructureEventKind;
  side: 'bull' | 'bear';
  /** Price of the level that was broken (prior swing). */
  brokenLevel: number;
  brokenIndex: number;
  brokenTime: number;
}

export interface MarketStructureResult {
  pivots: Pivot[];
  /** Confirmed HH/HL/LH/LL chips at pivots, in chronological order. */
  chips: Array<{ pivot: Pivot; label: 'HH' | 'HL' | 'LH' | 'LL' }>;
  events: StructureEvent[];
  /** Last confirmed swing high/low — used by Premium/Discount and OTE. */
  lastSwingHigh: Pivot | null;
  lastSwingLow: Pivot | null;
  /** Direction the engine currently believes the market is heading in. */
  trend: 1 | -1 | 0;
}

/**
 * Pivot-driven Break of Structure / Change of Character engine.
 *
 * Algorithm:
 *  1. Detect fractal pivots with `pivotLen` neighbors each side.
 *  2. Walk pivots in chronological order, classifying each as HH/HL/LH/LL relative
 *     to the prior same-side pivot.
 *  3. Walk bars after each pivot looking for the first bar that closes beyond it by
 *     more than ATR * `atrFilterMult`. Emit BOS if the break continues the current
 *     trend, CHoCH if it reverses it.
 *
 * The engine deliberately operates only on *confirmed* pivots (no look-ahead) — the
 * earliest a pivot can be emitted is `pivotLen` bars after it forms.
 */
export function computeMarketStructure(
  bars: ReadonlyArray<BarLike>,
  inputs: MarketStructureInputs = DEFAULT_MS_INPUTS,
): MarketStructureResult {
  const pivots = detectPivots(bars, inputs.pivotLen);
  const chips: MarketStructureResult['chips'] = [];
  const events: StructureEvent[] = [];

  let lastHigh: Pivot | null = null;
  let lastLow: Pivot | null = null;
  let trend: 1 | -1 | 0 = 0;

  for (const p of pivots) {
    if (p.side === 'high') {
      if (lastHigh) {
        chips.push({ pivot: p, label: p.price > lastHigh.price ? 'HH' : 'LH' });
      }
      lastHigh = p;
    } else {
      if (lastLow) {
        chips.push({ pivot: p, label: p.price > lastLow.price ? 'HL' : 'LL' });
      }
      lastLow = p;
    }
  }

  // Now scan bars and trigger BOS / CHoCH when close > / < prior confirmed pivot.
  let pendingHigh: Pivot | null = null;
  let pendingLow: Pivot | null = null;
  const pivotByIndex = new Map<number, Pivot[]>();
  for (const p of pivots) {
    const arr = pivotByIndex.get(p.index) ?? [];
    arr.push(p);
    pivotByIndex.set(p.index, arr);
  }

  for (let i = inputs.pivotLen; i < bars.length; i += 1) {
    const b = bars[i]!;
    // Any pivot confirmed at i - pivotLen becomes available now.
    const newlyConfirmed = pivotByIndex.get(i - inputs.pivotLen) ?? [];
    for (const p of newlyConfirmed) {
      if (p.side === 'high') pendingHigh = p;
      else pendingLow = p;
    }

    // ATR proxy: use the difference between high and low over the last `pivotLen` bars
    const atrApprox = approxLocalATR(bars, i, inputs.pivotLen);
    const buf = atrApprox * inputs.atrFilterMult;

    if (pendingHigh && b.close > pendingHigh.price + buf) {
      const kind: StructureEventKind = trend >= 0 ? 'BOS' : 'CHoCH';
      events.push({
        index: i,
        time: b.openTime,
        kind,
        side: 'bull',
        brokenLevel: pendingHigh.price,
        brokenIndex: pendingHigh.index,
        brokenTime: bars[pendingHigh.index]!.openTime,
      });
      trend = 1;
      pendingHigh = null;
    }
    if (pendingLow && b.close < pendingLow.price - buf) {
      const kind: StructureEventKind = trend <= 0 ? 'BOS' : 'CHoCH';
      events.push({
        index: i,
        time: b.openTime,
        kind,
        side: 'bear',
        brokenLevel: pendingLow.price,
        brokenIndex: pendingLow.index,
        brokenTime: bars[pendingLow.index]!.openTime,
      });
      trend = -1;
      pendingLow = null;
    }
  }

  return {
    pivots,
    chips,
    events,
    lastSwingHigh: lastHigh,
    lastSwingLow: lastLow,
    trend,
  };
}

function approxLocalATR(bars: ReadonlyArray<BarLike>, i: number, win: number): number {
  let sum = 0;
  let count = 0;
  for (let k = Math.max(0, i - win); k <= i; k += 1) {
    sum += bars[k]!.high - bars[k]!.low;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}
