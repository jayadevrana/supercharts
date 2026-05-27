import type { Candle } from '@supercharts/types';

export interface LineBreakOptions {
  /** Number of prior bars that the close must break above/below. Default 3 (three-line break). */
  count: number;
}

/**
 * Three-line break (or N-line break) transformation.
 *
 * Algorithm: a new up-bar opens at the previous close and closes at price IF price exceeds
 * the previous N bars' highest close. A new down-bar requires price below the lowest of
 * the previous N bars' lows. Mixed bars are ignored.
 *
 * Output: bars laid out on the original time axis (synthetic time slots spaced by the
 * incoming candle's bar duration). Each bar is rendered through the existing candlestick
 * renderer with open/close set to the start/end of the break.
 */
export function toLineBreak(input: ReadonlyArray<Candle>, opts: LineBreakOptions): Candle[] {
  if (input.length === 0) return [];
  const count = Math.max(1, opts.count);
  const out: Candle[] = [];
  let direction: 1 | -1 | 0 = 0;
  let synthTime = input[0]!.openTime;
  const step = (input[1]?.openTime ?? input[0]!.closeTime) - input[0]!.openTime || 60_000;

  for (const k of input) {
    const recent = out.slice(-count);
    const recentHigh = Math.max(...recent.map((r) => Math.max(r.open, r.close)), -Infinity);
    const recentLow = Math.min(...recent.map((r) => Math.min(r.open, r.close)), Infinity);

    if (out.length === 0) {
      // Seed with the first candle as a directional line.
      const open = k.open;
      const close = k.close;
      direction = close >= open ? 1 : -1;
      out.push(buildBar(k, synthTime, step, open, close));
      synthTime += step;
      continue;
    }

    if (Number.isFinite(recentHigh) && k.close > recentHigh) {
      const open = out[out.length - 1]!.close;
      const close = k.close;
      out.push(buildBar(k, synthTime, step, open, close));
      synthTime += step;
      direction = 1;
    } else if (Number.isFinite(recentLow) && k.close < recentLow) {
      const open = out[out.length - 1]!.close;
      const close = k.close;
      out.push(buildBar(k, synthTime, step, open, close));
      synthTime += step;
      direction = -1;
    }
    // Otherwise: no new bar — the move was too small.
  }
  void direction;
  return out;
}

function buildBar(source: Candle, openTime: number, step: number, open: number, close: number): Candle {
  return {
    symbol: source.symbol,
    provider: source.provider,
    venue: source.venue,
    interval: source.interval,
    openTime,
    closeTime: openTime + step - 1,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 0,
    quoteVolume: 0,
    buyVolume: 0,
    sellVolume: 0,
    delta: 0,
    trades: 0,
    vwap: (open + close) / 2,
    isClosed: true,
    volumeKind: 'synthetic',
  };
}
