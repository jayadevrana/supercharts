import type { Candle } from '@supercharts/types';
import type { MaSource, MaType } from '@supercharts/types';
import { ema, rma, sma, wma } from './series-math';

/**
 * MA cross detector — the math used by both the on-chart line/labels and the
 * server-side alert engine. Keeping it in chart-core means the two can never get out
 * of sync: a crossover the engine fires is exactly the bar where the chart draws BUY.
 */

export interface MaCrossInputs {
  type: MaType;
  length: number;
  source: MaSource;
  /**
   * Optional second MA. When present, the detector compares MA1 (this one) against
   * MA2 (`crossWith`) at each bar instead of price-vs-MA.
   */
  crossWith?: {
    type: MaType;
    length: number;
  };
}

export interface MaCrossPoint {
  /** Bar index in the source candle array. */
  index: number;
  /** openTime of the bar — what the alert engine dedupes on. */
  time: number;
  side: 'buy' | 'sell';
  /** Source price at the bar. */
  price: number;
  /** MA value at the bar. */
  maValue: number;
}

export interface MaCrossResult {
  /** Primary (fast) MA. */
  ma: Float64Array;
  /** Secondary (slow) MA — only present in dual-MA mode. */
  maSlow?: Float64Array;
  /** All detected crossover bars across the whole candle window. */
  crosses: MaCrossPoint[];
}

/** Resolve the chosen price source for one candle. */
export function pickSource(c: Candle, source: MaSource): number {
  switch (source) {
    case 'open':
      return c.open;
    case 'high':
      return c.high;
    case 'low':
      return c.low;
    case 'hl2':
      return (c.high + c.low) / 2;
    case 'hlc3':
      return (c.high + c.low + c.close) / 3;
    case 'ohlc4':
      return (c.open + c.high + c.low + c.close) / 4;
    case 'close':
    default:
      return c.close;
  }
}

function computeMa(values: ReadonlyArray<number>, inputs: MaCrossInputs): Float64Array {
  switch (inputs.type) {
    case 'ema':
      return ema(values, inputs.length);
    case 'rma':
      return rma(values, inputs.length);
    case 'wma':
      return wma(values, inputs.length);
    case 'sma':
    default:
      return sma(values, inputs.length);
  }
}

/**
 * Compute the MA and every crossover bar in one pass. Crosses are detected on the
 * relationship between the *previous closed* bar (i-1) and the *current* bar (i):
 *
 *   prev.source <= prev.ma  &&  cur.source >  cur.ma  →  BUY at bar i
 *   prev.source >= prev.ma  &&  cur.source <  cur.ma  →  SELL at bar i
 *
 * Equality on the prior bar is allowed so a flat-line tag-then-break still fires. The
 * MA must be defined (non-NaN) on both bars or the cross is ignored — this filters
 * out the warm-up window where MA(length) hasn't accumulated enough data.
 *
 * NOTE: the function does NOT filter on candle.isClosed. The renderer always feeds
 * closed candles for historical bars; the live/forming bar is added separately by the
 * caller when it wants a live preview. The alert engine, in contrast, only invokes
 * this against closed bars so it never double-fires a wick poke.
 */
export function computeMaCross(
  candles: ReadonlyArray<Candle>,
  inputs: MaCrossInputs,
): MaCrossResult {
  const n = candles.length;
  if (n === 0) return { ma: new Float64Array(0), crosses: [] };
  const src = new Array<number>(n);
  for (let i = 0; i < n; i += 1) src[i] = pickSource(candles[i]!, inputs.source);
  const ma = computeMa(src, inputs);

  // Dual-MA mode: compute the slow leg from the same source array. Comparing the two
  // MAs (instead of price-vs-MA) gives the canonical "golden cross / death cross"
  // signal that retail traders expect.
  const maSlow = inputs.crossWith
    ? computeMa(src, { type: inputs.crossWith.type, length: inputs.crossWith.length, source: inputs.source })
    : undefined;

  const crosses: MaCrossPoint[] = [];
  for (let i = 1; i < n; i += 1) {
    if (maSlow) {
      const f0 = ma[i - 1];
      const f1 = ma[i];
      const s0 = maSlow[i - 1];
      const s1 = maSlow[i];
      if (
        !Number.isFinite(f0!) ||
        !Number.isFinite(f1!) ||
        !Number.isFinite(s0!) ||
        !Number.isFinite(s1!)
      )
        continue;
      // Strict inequality on the leading bar so we only emit on a clean flip — not
      // on the warm-up tick where both legs may briefly equal each other.
      if (f0! <= s0! && f1! > s1!) {
        crosses.push({
          index: i,
          time: candles[i]!.openTime,
          side: 'buy',
          price: src[i]!,
          maValue: f1!,
        });
      } else if (f0! >= s0! && f1! < s1!) {
        crosses.push({
          index: i,
          time: candles[i]!.openTime,
          side: 'sell',
          price: src[i]!,
          maValue: f1!,
        });
      }
      continue;
    }
    // Single-MA mode (price-vs-MA).
    const m0 = ma[i - 1];
    const m1 = ma[i];
    const p0 = src[i - 1]!;
    const p1 = src[i]!;
    if (!Number.isFinite(m0!) || !Number.isFinite(m1!)) continue;
    if (p0 <= m0! && p1 > m1!) {
      crosses.push({
        index: i,
        time: candles[i]!.openTime,
        side: 'buy',
        price: p1,
        maValue: m1!,
      });
    } else if (p0 >= m0! && p1 < m1!) {
      crosses.push({
        index: i,
        time: candles[i]!.openTime,
        side: 'sell',
        price: p1,
        maValue: m1!,
      });
    }
  }
  return { ma, maSlow, crosses };
}

/**
 * Re-export the indicator config defaults so the UI and the alert engine pick the
 * exact same numbers. Treat `length: 20` and `source: 'close'` as canonical (matches
 * TradingView's "MA Cross" default).
 */
export const DEFAULT_MA_CROSS_INPUTS: MaCrossInputs = {
  type: 'ema',
  length: 20,
  source: 'close',
};
