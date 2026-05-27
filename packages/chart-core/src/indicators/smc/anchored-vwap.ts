import type { BarLike } from './shared';

export interface AnchoredVwapInputs {
  anchorIndex: number;
  multipliers: number[];
  source: 'hlc3' | 'close' | 'ohlc4';
}

export const DEFAULT_AVWAP_INPUTS: AnchoredVwapInputs = {
  anchorIndex: 0,
  multipliers: [1, 2, 3],
  source: 'hlc3',
};

export interface AnchoredVwapResult {
  /** From `anchorIndex` onwards. Values before the anchor are NaN. */
  vwap: Float64Array;
  bandsUpper: Float64Array[];
  bandsLower: Float64Array[];
}

/**
 * Anchored VWAP with σ-bands.
 *
 * Running sums in O(n). σ derived from the volume-weighted variance of the typical
 * price: var = E[p²]·w - (E[p]·w)². Bands draw at vwap ± k·σ.
 */
export function computeAnchoredVwap(
  bars: ReadonlyArray<BarLike>,
  inputs: AnchoredVwapInputs = DEFAULT_AVWAP_INPUTS,
): AnchoredVwapResult {
  const n = bars.length;
  const vwap = new Float64Array(n);
  const bandsUpper = inputs.multipliers.map(() => new Float64Array(n));
  const bandsLower = inputs.multipliers.map(() => new Float64Array(n));
  for (let i = 0; i < n; i += 1) {
    vwap[i] = NaN;
    for (let k = 0; k < inputs.multipliers.length; k += 1) {
      bandsUpper[k]![i] = NaN;
      bandsLower[k]![i] = NaN;
    }
  }
  let sumPV = 0;
  let sumV = 0;
  let sumP2V = 0;
  let warmup = 0;
  const startIdx = Math.max(0, Math.min(inputs.anchorIndex, n - 1));
  for (let i = startIdx; i < n; i += 1) {
    const b = bars[i]!;
    const p = inputs.source === 'close' ? b.close : inputs.source === 'ohlc4' ? (b.open + b.high + b.low + b.close) / 4 : (b.high + b.low + b.close) / 3;
    const v = Math.max(0, b.volume);
    sumPV += p * v;
    sumP2V += p * p * v;
    sumV += v;
    warmup += 1;
    if (sumV === 0) {
      vwap[i] = p;
      continue;
    }
    const w = sumPV / sumV;
    vwap[i] = w;
    if (warmup >= 5) {
      const variance = Math.max(0, sumP2V / sumV - w * w);
      const sigma = Math.sqrt(variance);
      for (let k = 0; k < inputs.multipliers.length; k += 1) {
        const m = inputs.multipliers[k]!;
        bandsUpper[k]![i] = w + sigma * m;
        bandsLower[k]![i] = w - sigma * m;
      }
    }
  }
  return { vwap, bandsUpper, bandsLower };
}
