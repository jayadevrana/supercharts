import { atrSeries, type BarLike } from './shared';
import { ema } from '../series-math';

export interface RegimeInputs {
  fastSma: number;
  slowSma: number;
  atrLen: number;
  /** |score| ≥ this means trending; below means choppy. */
  trendThreshold: number;
}

export const DEFAULT_REGIME_INPUTS: RegimeInputs = {
  fastSma: 50,
  slowSma: 200,
  atrLen: 20,
  trendThreshold: 1,
};

export type RegimeLabel = 'strong_up' | 'up' | 'choppy' | 'down' | 'strong_down';

export interface RegimeResult {
  score: Float64Array;
  label: RegimeLabel[];
  /** Current bar label for the indicator badge. */
  currentLabel: RegimeLabel;
  currentScore: number;
}

/**
 * Trend/range regime score from Hermes's spec:
 *   score = (close - SMA_fast) / ATR_atrLen × sign(close - SMA_slow)
 *
 * |score| ≥ trendThreshold → trending; below → choppy. The label palette
 * (strong_up / up / choppy / down / strong_down) drives the UI badge color.
 */
export function computeRegime(
  bars: ReadonlyArray<BarLike>,
  inputs: RegimeInputs = DEFAULT_REGIME_INPUTS,
): RegimeResult | null {
  const n = bars.length;
  if (n < Math.max(inputs.fastSma, inputs.slowSma, inputs.atrLen)) return null;
  const closes = bars.map((b) => b.close);
  const fast = ema(closes, inputs.fastSma);
  const slow = ema(closes, inputs.slowSma);
  const atr = atrSeries(bars, inputs.atrLen);
  const score = new Float64Array(n);
  const labels: RegimeLabel[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const f = fast[i] ?? 0;
    const s = slow[i] ?? 0;
    const a = atr[i] ?? 0;
    if (a === 0) {
      score[i] = 0;
      labels[i] = 'choppy';
      continue;
    }
    const sigma = (bars[i]!.close - f) / a;
    const sign = Math.sign(bars[i]!.close - s);
    const v = sigma * sign;
    score[i] = v;
    labels[i] =
      v > inputs.trendThreshold * 2
        ? 'strong_up'
        : v > inputs.trendThreshold
          ? 'up'
          : v < -inputs.trendThreshold * 2
            ? 'strong_down'
            : v < -inputs.trendThreshold
              ? 'down'
              : 'choppy';
  }
  return {
    score,
    label: labels,
    currentLabel: labels[n - 1] ?? 'choppy',
    currentScore: score[n - 1] ?? 0,
  };
}
