import { atrSeries, nextZoneId, type BarLike, type ZoneBox } from './shared';
import { computeMarketStructure, type StructureEvent } from './market-structure';

export interface OrderBlockInputs {
  pivotLen: number;
  /** Displacement = bar close beyond a swing by displacementMult × ATR. */
  displacementMult: number;
  /** Look back at most this many bars to find the opposite-direction OB candle. */
  lookback: number;
  /** Stop tracking blocks older than maxAge bars. */
  maxAge: number;
  /** Show mitigated blocks (faded). */
  showMitigated: boolean;
  /** Show breaker blocks (flipped polarity). */
  showBreaker: boolean;
}

export const DEFAULT_OB_INPUTS: OrderBlockInputs = {
  pivotLen: 5,
  displacementMult: 1.5,
  lookback: 10,
  maxAge: 800,
  showMitigated: false,
  showBreaker: true,
};

/**
 * Order Block detection.
 *
 *  1. Compute market structure to surface BOS events (continuation).
 *  2. For each bullish BOS, walk back up to `lookback` bars and find the last
 *     bearish candle (`close < open`); that candle becomes a bullish Order Block.
 *  3. Track per-OB state machine:
 *       active   → price hasn't returned
 *       mitigated→ a later bar tagged the OB body
 *       breaker  → after mitigation, price closed clean through, flipping role
 *       failed   → price aged out of `maxAge` or violated cleanly without sweep
 *
 * Returns ZoneBox[] suitable for the canvas layer.
 */
export function computeOrderBlocks(
  bars: ReadonlyArray<BarLike>,
  inputs: OrderBlockInputs = DEFAULT_OB_INPUTS,
): ZoneBox[] {
  const n = bars.length;
  if (n < inputs.pivotLen * 2 + 5) return [];
  const ms = computeMarketStructure(bars, {
    pivotLen: inputs.pivotLen,
    atrFilterMult: 0.15,
  });
  const atr = atrSeries(bars, 14);
  const out: ZoneBox[] = [];

  for (const ev of ms.events as StructureEvent[]) {
    const displ = (atr[ev.index] ?? 0) * inputs.displacementMult;
    const move = Math.abs(bars[ev.index]!.close - bars[ev.index - 1]!.close);
    if (move < displ) continue;

    const startSearch = Math.max(0, ev.index - inputs.lookback);
    // For a bullish BOS we want the last *bearish* candle before the breakout.
    // For a bearish BOS we want the last *bullish* candle.
    const targetSide = ev.side === 'bull' ? 'bear' : 'bull';
    for (let k = ev.index - 1; k >= startSearch; k -= 1) {
      const b = bars[k]!;
      const candleSide = b.close < b.open ? 'bear' : 'bull';
      if (candleSide !== targetSide) continue;
      out.push({
        id: nextZoneId('ob'),
        side: ev.side,
        startIndex: k,
        endIndex: null,
        startTime: b.openTime,
        endTime: null,
        top: b.high,
        bottom: b.low,
        state: 'active',
        label: ev.side === 'bull' ? 'Bull OB' : 'Bear OB',
      });
      break;
    }
  }

  // Lifecycle pass.
  for (let i = 0; i < n; i += 1) {
    const b = bars[i]!;
    for (const z of out) {
      if (i <= z.startIndex || z.state === 'failed') continue;
      if (inputs.maxAge > 0 && i - z.startIndex > inputs.maxAge && z.state === 'active') {
        z.state = 'failed';
        z.endIndex = i;
        z.endTime = b.openTime;
        continue;
      }
      if (z.state === 'active') {
        if (z.side === 'bull' && b.low <= z.top && b.low >= z.bottom) {
          z.state = 'mitigated';
        } else if (z.side === 'bear' && b.high >= z.bottom && b.high <= z.top) {
          z.state = 'mitigated';
        }
      }
      if (z.state === 'mitigated') {
        if (z.side === 'bull' && b.close < z.bottom) {
          z.state = inputs.showBreaker ? 'breaker' : 'failed';
          z.side = 'bear';
          z.label = 'Breaker';
        } else if (z.side === 'bear' && b.close > z.top) {
          z.state = inputs.showBreaker ? 'breaker' : 'failed';
          z.side = 'bull';
          z.label = 'Breaker';
        }
      }
    }
  }

  const visible = out.filter((z) => {
    if (z.state === 'failed') return false;
    if (z.state === 'mitigated' && !inputs.showMitigated) return false;
    if (z.state === 'breaker' && !inputs.showBreaker) return false;
    return true;
  });
  return visible;
}
