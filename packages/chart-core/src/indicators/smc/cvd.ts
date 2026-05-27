import { safeDiv, type BarLike } from './shared';

export interface CvdInputs {
  pivotLen: number;
  /** How many bars back to consider when pairing pivots into divergences. */
  divLookback: number;
  showHidden: boolean;
}

export const DEFAULT_CVD_INPUTS: CvdInputs = {
  pivotLen: 5,
  divLookback: 60,
  showHidden: false,
};

export interface Divergence {
  side: 'bullish' | 'bearish';
  hidden: boolean;
  /** Price bar indices */
  priceA: number;
  priceB: number;
  cvdA: number;
  cvdB: number;
}

export interface CvdResult {
  cvd: Float64Array;
  divergences: Divergence[];
}

/**
 * Cumulative Volume Delta (CVD) using the `volume × (close-open)/(high-low)` proxy.
 *
 * Pairs the last two confirmed pivot highs (or lows) on price + CVD and flags:
 *   regular bullish — price LL + CVD HL
 *   regular bearish — price HH + CVD LH
 *   hidden bullish  — price HL + CVD LL
 *   hidden bearish  — price LH + CVD HH
 */
export function computeCvd(bars: ReadonlyArray<BarLike>, inputs: CvdInputs = DEFAULT_CVD_INPUTS): CvdResult {
  const n = bars.length;
  const cvd = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const b = bars[i]!;
    const range = b.high - b.low;
    if (range === 0) {
      // Doji / zero-range bar contributes nothing.
      cvd[i] = acc;
      continue;
    }
    const delta = b.volume * safeDiv(b.close - b.open, range, 0);
    acc += delta;
    cvd[i] = acc;
  }

  const priceHighs = pivots(bars.map((b) => b.high), inputs.pivotLen, 'high');
  const priceLows = pivots(bars.map((b) => b.low), inputs.pivotLen, 'low');
  const cvdHighs = pivots(Array.from(cvd), inputs.pivotLen, 'high');
  const cvdLows = pivots(Array.from(cvd), inputs.pivotLen, 'low');

  const divergences: Divergence[] = [];
  pairDivergences(priceHighs, cvdHighs, inputs, bars, cvd, 'bearish', divergences);
  pairDivergences(priceLows, cvdLows, inputs, bars, cvd, 'bullish', divergences);
  return { cvd, divergences };
}

function pivots(series: number[], len: number, side: 'high' | 'low'): number[] {
  const out: number[] = [];
  for (let i = len; i < series.length - len; i += 1) {
    let ok = true;
    for (let k = 1; k <= len; k += 1) {
      if (side === 'high') {
        if (series[i - k]! >= series[i]! || series[i + k]! >= series[i]!) {
          ok = false;
          break;
        }
      } else {
        if (series[i - k]! <= series[i]! || series[i + k]! <= series[i]!) {
          ok = false;
          break;
        }
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

function pairDivergences(
  priceP: number[],
  cvdP: number[],
  inputs: CvdInputs,
  bars: ReadonlyArray<BarLike>,
  cvd: Float64Array,
  side: 'bullish' | 'bearish',
  out: Divergence[],
): void {
  if (priceP.length < 2 || cvdP.length < 2) return;
  for (let i = 1; i < priceP.length; i += 1) {
    const b = priceP[i]!;
    const a = priceP[i - 1]!;
    if (b - a > inputs.divLookback) continue;
    // Match nearest CVD pivot within ±1 bar of each price pivot.
    const cA = cvdP.find((p) => Math.abs(p - a) <= 1);
    const cB = cvdP.find((p) => Math.abs(p - b) <= 1);
    if (cA == null || cB == null) continue;
    const priceA = side === 'bullish' ? bars[a]!.low : bars[a]!.high;
    const priceB = side === 'bullish' ? bars[b]!.low : bars[b]!.high;
    const cvdA = cvd[cA]!;
    const cvdB = cvd[cB]!;

    if (side === 'bearish') {
      // regular bearish: HH on price, LH on CVD
      if (priceB > priceA && cvdB < cvdA) {
        out.push({ side, hidden: false, priceA: a, priceB: b, cvdA, cvdB });
      } else if (inputs.showHidden && priceB < priceA && cvdB > cvdA) {
        out.push({ side, hidden: true, priceA: a, priceB: b, cvdA, cvdB });
      }
    } else {
      if (priceB < priceA && cvdB > cvdA) {
        out.push({ side, hidden: false, priceA: a, priceB: b, cvdA, cvdB });
      } else if (inputs.showHidden && priceB > priceA && cvdB < cvdA) {
        out.push({ side, hidden: true, priceA: a, priceB: b, cvdA, cvdB });
      }
    }
  }
}
