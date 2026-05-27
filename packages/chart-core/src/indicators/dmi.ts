import { rma } from './series-math';

export interface DMI {
  diPlus: Float64Array;
  diMinus: Float64Array;
  adx: Float64Array;
}

/**
 * Welles Wilder DMI / ADX.
 * Mirrors `ta.dmi(period, period)` from Pine Script.
 */
export function dmi(
  high: ReadonlyArray<number>,
  low: ReadonlyArray<number>,
  close: ReadonlyArray<number>,
  period: number,
): DMI {
  const n = high.length;
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [0];
  for (let i = 1; i < n; i += 1) {
    const upMove = high[i]! - high[i - 1]!;
    const downMove = low[i - 1]! - low[i]!;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const hl = high[i]! - low[i]!;
    const hc = Math.abs(high[i]! - close[i - 1]!);
    const lc = Math.abs(low[i]! - close[i - 1]!);
    tr.push(Math.max(hl, hc, lc));
  }
  const smPlus = rma(plusDM, period);
  const smMinus = rma(minusDM, period);
  const smTR = rma(tr, period);
  const diPlus = new Float64Array(n);
  const diMinus = new Float64Array(n);
  const dx = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const trv = smTR[i]!;
    if (!Number.isFinite(trv) || trv === 0) {
      diPlus[i] = NaN;
      diMinus[i] = NaN;
      dx[i] = NaN;
      continue;
    }
    const p = (100 * smPlus[i]!) / trv;
    const m = (100 * smMinus[i]!) / trv;
    diPlus[i] = p;
    diMinus[i] = m;
    const denom = p + m;
    dx[i] = denom === 0 ? 0 : (100 * Math.abs(p - m)) / denom;
  }
  const adx = rma(Array.from(dx), period);
  return { diPlus, diMinus, adx };
}
