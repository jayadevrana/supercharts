import type { Candle, Interval } from '@supercharts/types';
import { INTERVAL_MS } from '@supercharts/types';

/**
 * In-memory candle store, capped per interval. The API queries this for fast snapshots.
 * Survives until the ingestion process restarts — production swaps in ClickHouse, same interface.
 */
export class CandleStore {
  private store = new Map<string, Map<Interval, Candle[]>>();
  private maxPerInterval = 5000;

  upsert(symbol: string, interval: Interval, candle: Candle): void {
    let perSym = this.store.get(symbol);
    if (!perSym) {
      perSym = new Map();
      this.store.set(symbol, perSym);
    }
    let arr = perSym.get(interval);
    if (!arr) {
      arr = [];
      perSym.set(interval, arr);
    }
    const last = arr[arr.length - 1];
    if (last && last.openTime === candle.openTime) {
      arr[arr.length - 1] = candle;
      return;
    }
    if (last && candle.openTime < last.openTime) {
      // Out-of-order — find and replace.
      for (let i = arr.length - 1; i >= 0; i -= 1) {
        if (arr[i]!.openTime === candle.openTime) {
          arr[i] = candle;
          return;
        }
        if (arr[i]!.openTime < candle.openTime) {
          arr.splice(i + 1, 0, candle);
          return;
        }
      }
      arr.unshift(candle);
    } else {
      arr.push(candle);
    }
    if (arr.length > this.maxPerInterval) {
      arr.splice(0, arr.length - this.maxPerInterval);
    }
  }

  query(symbol: string, interval: Interval, from?: number, to?: number, limit = 1000): Candle[] {
    const arr = this.store.get(symbol)?.get(interval);
    if (!arr || arr.length === 0) return [];
    let start = 0;
    let end = arr.length;
    if (from !== undefined) {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid]!.openTime < from) lo = mid + 1;
        else hi = mid;
      }
      start = lo;
    }
    if (to !== undefined) {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid]!.openTime <= to) lo = mid + 1;
        else hi = mid;
      }
      end = lo;
    }
    const slice = arr.slice(start, end);
    if (slice.length > limit) return slice.slice(slice.length - limit);
    return slice;
  }

  latest(symbol: string, interval: Interval): Candle | undefined {
    const arr = this.store.get(symbol)?.get(interval);
    return arr?.[arr.length - 1];
  }

  /** Aggregate from a smaller interval into a larger one if needed. */
  aggregateFrom(
    symbol: string,
    sourceInterval: Interval,
    targetInterval: Interval,
  ): Candle[] {
    const src = this.store.get(symbol)?.get(sourceInterval);
    if (!src || src.length === 0) return [];
    const srcMs = INTERVAL_MS[sourceInterval];
    const tgtMs = INTERVAL_MS[targetInterval];
    if (!srcMs || !tgtMs || tgtMs <= srcMs) return [];
    const out: Candle[] = [];
    let bucket: Candle | null = null;
    for (const k of src) {
      const bucketOpen = Math.floor(k.openTime / tgtMs) * tgtMs;
      if (!bucket || bucket.openTime !== bucketOpen) {
        if (bucket) out.push(bucket);
        bucket = {
          ...k,
          interval: targetInterval,
          openTime: bucketOpen,
          closeTime: bucketOpen + tgtMs - 1,
        };
      } else {
        bucket.high = Math.max(bucket.high, k.high);
        bucket.low = Math.min(bucket.low, k.low);
        bucket.close = k.close;
        bucket.volume += k.volume;
        bucket.quoteVolume += k.quoteVolume;
        bucket.buyVolume += k.buyVolume;
        bucket.sellVolume += k.sellVolume;
        bucket.delta = bucket.buyVolume - bucket.sellVolume;
        bucket.trades += k.trades;
        bucket.vwap = bucket.volume > 0 ? bucket.quoteVolume / bucket.volume : bucket.close;
      }
    }
    if (bucket) out.push(bucket);
    return out;
  }
}

export const candleStore = new CandleStore();
