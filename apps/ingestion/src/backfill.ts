import type { Interval } from '@supercharts/types';
import { INTERVAL_MS } from '@supercharts/types';
import type { MarketDataProvider } from '@supercharts/market-data';
import { candleStore } from './candle-store';

export interface BackfillTarget {
  symbol: string;
  intervals: Interval[];
  /** Lookback per interval, in milliseconds. Defaults to 1 year. */
  lookbackMs?: number;
}

export interface BackfillOptions {
  provider: MarketDataProvider;
  targets: BackfillTarget[];
  /** Approx. max candles per chunked Binance request. */
  chunkSize?: number;
  /** Called with progress updates (`done/total`). */
  onProgress?: (info: { symbol: string; interval: Interval; loaded: number; total: number }) => void;
}

/**
 * Pulls historical candles in parallel-per-symbol, serial-per-interval, paginated through
 * the provider's `fetchHistoricalCandles`. Stores everything in the in-memory candleStore.
 *
 * Binance returns up to 1000 klines per call. For 1 year of 1h data that's 9 calls; for 1d
 * 1 call. The pagination is already handled inside the BinanceProvider, but we cap loops
 * defensively here too.
 */
export async function backfillHistory(opts: BackfillOptions): Promise<void> {
  const { provider, targets, chunkSize = 1000, onProgress } = opts;
  const ONE_YEAR_MS = 365 * 24 * 60 * 60_000;
  const now = Date.now();

  for (const target of targets) {
    const lookback = target.lookbackMs ?? ONE_YEAR_MS;
    const from = now - lookback;

    for (const interval of target.intervals) {
      const stepMs = INTERVAL_MS[interval];
      if (!stepMs) continue;
      const totalExpected = Math.ceil(lookback / stepMs);
      let loaded = 0;
      // Page through the requested window in fixed chunks so peak memory stays
      // bounded to ~`chunkSize` candles regardless of total lookback. Previously a
      // single fetch could pull ~525k 1m candles (~40 MB per symbol-interval) into
      // memory before any of them hit the store.
      let cursor = from;
      try {
        // Most providers stop paging on their own when a chunk is partial, but we cap
        // iterations defensively so a misbehaving provider can't lock us in the loop.
        const maxIterations = Math.ceil((totalExpected + chunkSize) / chunkSize) + 10;
        let iter = 0;
        while (cursor < now && iter < maxIterations) {
          iter += 1;
          const chunkTo = Math.min(now, cursor + stepMs * chunkSize);
          const candles = await provider.fetchHistoricalCandles(
            target.symbol,
            interval,
            cursor,
            chunkTo,
            chunkSize,
          );
          if (candles.length === 0) break;
          for (const c of candles) {
            candleStore.upsert(target.symbol, interval, c);
          }
          loaded += candles.length;
          onProgress?.({
            symbol: target.symbol,
            interval,
            loaded,
            total: totalExpected,
          });
          const lastOpen = candles[candles.length - 1]!.openTime;
          const nextCursor = lastOpen + stepMs;
          // Guard against providers that return the same window twice — without this
          // we could spin forever fetching the tail bar.
          if (nextCursor <= cursor) break;
          cursor = nextCursor;
          if (candles.length < chunkSize) break;
        }
        // eslint-disable-next-line no-console
        console.log(
          `[backfill] ${target.symbol} ${interval}: ${loaded}/${totalExpected} bars`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[backfill] ${target.symbol} ${interval} failed:`, err);
      }
    }
  }
}

/** Default watchlist symbols we backfill on startup. */
export const DEFAULT_BACKFILL_SYMBOLS = [
  'BINANCE:BTCUSDT',
  'BINANCE:ETHUSDT',
  'BINANCE:SOLUSDT',
  'BINANCE:BNBUSDT',
  'BINANCE:XRPUSDT',
  'BINANCE:DOGEUSDT',
  'BINANCE:AVAXUSDT',
  'BINANCE:ADAUSDT',
  'BINANCE:LINKUSDT',
  'BINANCE:DOTUSDT',
];

/** Intervals we cache 1 year of. 1m is left to on-demand fetches because 1y × 525k bars is wasteful. */
export const DEFAULT_BACKFILL_INTERVALS: Interval[] = ['15m', '1h', '4h', '1d'];
