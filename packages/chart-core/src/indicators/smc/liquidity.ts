import { atrSeries, detectPivots, type BarLike, type Pivot } from './shared';

export interface LiquidityInputs {
  pivotLen: number;
  /** Cluster tolerance as fraction of price (5 basis points by default). */
  eqTolPct: number;
  /** Drop levels older than this many bars. */
  maxAgeBars: number;
  /** Require sweep wick to be at least this much ATR above the level. */
  atrSweepMult: number;
}

export const DEFAULT_LIQUIDITY_INPUTS: LiquidityInputs = {
  pivotLen: 5,
  eqTolPct: 0.0005,
  maxAgeBars: 1000,
  atrSweepMult: 0.25,
};

export interface LiquidityLevel {
  id: string;
  side: 'high' | 'low';
  price: number;
  touches: number;
  firstIndex: number;
  firstTime: number;
  /** Indices that contributed to this cluster. */
  pivotIndices: number[];
  state: 'pending' | 'swept';
  sweptIndex?: number;
  sweptTime?: number;
}

export interface LiquiditySweep {
  level: LiquidityLevel;
  index: number;
  time: number;
  side: 'BSL' | 'SSL';
}

export interface LiquidityResult {
  levels: LiquidityLevel[];
  sweeps: LiquiditySweep[];
}

/**
 * Liquidity Pools (clusters of equal highs/lows) + Liquidity Sweeps (wicks through
 * a level with a close back inside the prior range).
 *
 * Clustering uses single-pass centroid linkage with `eqTolPct` tolerance, which is
 * O(n × |levels|). Cheap enough at our level count cap.
 */
export function computeLiquidity(
  bars: ReadonlyArray<BarLike>,
  inputs: LiquidityInputs = DEFAULT_LIQUIDITY_INPUTS,
): LiquidityResult {
  const pivots = detectPivots(bars, inputs.pivotLen);
  const atr = atrSeries(bars, 14);
  const levels: LiquidityLevel[] = [];

  let seq = 0;
  for (const p of pivots) {
    const tol = p.price * inputs.eqTolPct;
    const match = levels.find(
      (L) => L.side === p.side && Math.abs(L.price - p.price) <= tol && L.state === 'pending',
    );
    if (match) {
      // Centroid average.
      match.price = (match.price * match.touches + p.price) / (match.touches + 1);
      match.touches += 1;
      match.pivotIndices.push(p.index);
    } else {
      levels.push({
        id: `lvl_${seq++}`,
        side: p.side,
        price: p.price,
        touches: 1,
        firstIndex: p.index,
        firstTime: bars[p.index]!.openTime,
        pivotIndices: [p.index],
        state: 'pending',
      });
    }
  }

  const sweeps: LiquiditySweep[] = [];

  // Walk bars and detect sweeps + expire levels.
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i]!;
    const a = atr[i] ?? 0;
    const minWick = a * inputs.atrSweepMult;
    for (const L of levels) {
      if (L.state !== 'pending') continue;
      if (i < L.firstIndex) continue;
      if (inputs.maxAgeBars > 0 && i - L.firstIndex > inputs.maxAgeBars) {
        L.state = 'swept';
        L.sweptIndex = i;
        L.sweptTime = b.openTime;
        continue;
      }
      if (L.side === 'high' && b.high > L.price + minWick && b.close < L.price) {
        L.state = 'swept';
        L.sweptIndex = i;
        L.sweptTime = b.openTime;
        sweeps.push({ level: L, index: i, time: b.openTime, side: 'BSL' });
      } else if (L.side === 'low' && b.low < L.price - minWick && b.close > L.price) {
        L.state = 'swept';
        L.sweptIndex = i;
        L.sweptTime = b.openTime;
        sweeps.push({ level: L, index: i, time: b.openTime, side: 'SSL' });
      }
    }
  }

  return { levels, sweeps };
}

export type { Pivot };
