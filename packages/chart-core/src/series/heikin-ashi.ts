import type { Candle } from '@supercharts/types';

/**
 * Heikin Ashi conversion.
 *
 * haOpen   = (prevHaOpen + prevHaClose) / 2     (seeded with (open0 + close0)/2)
 * haClose  = (open + high + low + close) / 4
 * haHigh   = max(high, haOpen, haClose)
 * haLow    = min(low,  haOpen, haClose)
 */
export function toHeikinAshi(input: ReadonlyArray<Candle>): Candle[] {
  if (input.length === 0) return [];
  const out: Candle[] = new Array(input.length);
  const first = input[0]!;
  let prevHaOpen = (first.open + first.close) / 2;
  let prevHaClose = (first.open + first.high + first.low + first.close) / 4;
  out[0] = {
    ...first,
    open: prevHaOpen,
    close: prevHaClose,
    high: Math.max(first.high, prevHaOpen, prevHaClose),
    low: Math.min(first.low, prevHaOpen, prevHaClose),
  };
  for (let i = 1; i < input.length; i += 1) {
    const k = input[i]!;
    const haClose = (k.open + k.high + k.low + k.close) / 4;
    const haOpen = (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(k.high, haOpen, haClose);
    const haLow = Math.min(k.low, haOpen, haClose);
    out[i] = { ...k, open: haOpen, high: haHigh, low: haLow, close: haClose };
    prevHaOpen = haOpen;
    prevHaClose = haClose;
  }
  return out;
}
