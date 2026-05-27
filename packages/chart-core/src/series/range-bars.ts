import type { Candle } from '@supercharts/types';

export interface RangeBarOptions {
  /** Range in price units. A new bar opens when high-low exceeds this. */
  range: number;
}

export interface TickBarOptions {
  /** Number of trades per bar. */
  tradesPerBar: number;
}

export interface VolumeBarOptions {
  /** Volume threshold per bar. */
  volumePerBar: number;
}

export interface DollarBarOptions {
  /** Notional threshold per bar (price * volume). */
  notionalPerBar: number;
}

/**
 * Convert candles into range bars. Where the source granularity is large, this is only
 * an approximation; for true range bars feed trade ticks instead.
 */
export function toRangeBars(input: ReadonlyArray<Candle>, opts: RangeBarOptions): Candle[] {
  if (input.length === 0 || opts.range <= 0) return [];
  const out: Candle[] = [];
  let current: Candle | null = null;
  for (const k of input) {
    if (!current) {
      current = { ...k };
      continue;
    }
    current.high = Math.max(current.high, k.high);
    current.low = Math.min(current.low, k.low);
    current.close = k.close;
    current.closeTime = k.closeTime;
    current.volume += k.volume;
    current.quoteVolume += k.quoteVolume;
    current.buyVolume += k.buyVolume;
    current.sellVolume += k.sellVolume;
    current.delta = current.buyVolume - current.sellVolume;
    current.trades += k.trades;
    if (current.high - current.low >= opts.range) {
      out.push({ ...current, isClosed: true });
      current = { ...k, open: k.close, high: k.close, low: k.close };
    }
  }
  if (current) out.push({ ...current, isClosed: false });
  return out;
}

export function toTickBars(input: ReadonlyArray<Candle>, opts: TickBarOptions): Candle[] {
  return aggregateBy(input, (acc) => acc.trades >= opts.tradesPerBar);
}

export function toVolumeBars(input: ReadonlyArray<Candle>, opts: VolumeBarOptions): Candle[] {
  return aggregateBy(input, (acc) => acc.volume >= opts.volumePerBar);
}

export function toDollarBars(input: ReadonlyArray<Candle>, opts: DollarBarOptions): Candle[] {
  return aggregateBy(input, (acc) => acc.quoteVolume >= opts.notionalPerBar);
}

function aggregateBy(input: ReadonlyArray<Candle>, closeWhen: (acc: Candle) => boolean): Candle[] {
  const out: Candle[] = [];
  let acc: Candle | null = null;
  for (const k of input) {
    if (!acc) {
      acc = { ...k };
      continue;
    }
    acc.high = Math.max(acc.high, k.high);
    acc.low = Math.min(acc.low, k.low);
    acc.close = k.close;
    acc.closeTime = k.closeTime;
    acc.volume += k.volume;
    acc.quoteVolume += k.quoteVolume;
    acc.buyVolume += k.buyVolume;
    acc.sellVolume += k.sellVolume;
    acc.delta = acc.buyVolume - acc.sellVolume;
    acc.trades += k.trades;
    if (closeWhen(acc)) {
      out.push({ ...acc, isClosed: true });
      acc = null;
    }
  }
  if (acc) out.push({ ...acc, isClosed: false });
  return out;
}
