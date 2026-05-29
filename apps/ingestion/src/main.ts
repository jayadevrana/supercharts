/**
 * Ingestion service entry. Loaded by `pnpm dev:ingestion`.
 *
 * For our single-process MVP, the API server imports `bootstrapIngestion()` directly
 * and runs it in the same Node process. The standalone `main` is here so the same code
 * can scale out to a dedicated worker when traffic grows.
 */
import {
  BinanceProvider,
  MockProvider,
  OandaProvider,
  YahooProvider,
  type MarketDataProvider,
} from '@supercharts/market-data';
import { SubscriptionManager } from './subscription-manager';
import { bus } from './event-bus';
import { candleStore } from './candle-store';
import { deepTradeDetector } from './deep-trade-detector';
import { heatmapAggregator } from './heatmap-aggregator';
import {
  backfillHistory,
  DEFAULT_BACKFILL_SYMBOLS,
  DEFAULT_BACKFILL_INTERVALS,
} from './backfill';

export interface IngestionContext {
  subscriptions: SubscriptionManager;
  candleStore: typeof candleStore;
  deepTradeDetector: typeof deepTradeDetector;
  heatmapAggregator: typeof heatmapAggregator;
  bus: typeof bus;
  providers: {
    binance: BinanceProvider;
    /**
     * Forex / metals / indices provider. OANDA when a token is configured; otherwise
     * the free YahooProvider (no key). Routes only touch the shared interface, so the
     * concrete type doesn't matter to callers.
     */
    oanda: MarketDataProvider;
    mock: MockProvider;
  };
}

export async function bootstrapIngestion(env: NodeJS.ProcessEnv = process.env): Promise<IngestionContext> {
  const binanceEnabled = env.BINANCE_ENABLED !== 'false';
  const binance = new BinanceProvider();
  // Forex/metals/indices: prefer OANDA when a token is set (true broker prices),
  // otherwise fall back to the free Yahoo Finance feed so these symbols still produce
  // candles + alerts with zero cost / zero signup.
  const hasOanda = Boolean(env.OANDA_API_TOKEN && env.OANDA_ACCOUNT_ID);
  const forex: MarketDataProvider = hasOanda
    ? new OandaProvider({
        apiToken: env.OANDA_API_TOKEN,
        accountId: env.OANDA_ACCOUNT_ID,
        env: env.OANDA_ENV === 'live' ? 'live' : 'practice',
      })
    : new YahooProvider();
  const mock = new MockProvider();

  // Registered under the `oanda` key so the venue resolver (`OANDA:` → providers.oanda)
  // and every route keep working unchanged regardless of which feed is active.
  const subscriptions = new SubscriptionManager({ binance, oanda: forex, mock });

  if (binanceEnabled) {
    try {
      await binance.connect();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ingestion] Binance connect failed, will retry in background:', err);
    }
  }
  // Mock is always running; gives developers a baseline even offline.
  await mock.connect();
  // Forex feed (OANDA or Yahoo) — connect is cheap/idempotent for both.
  try {
    await forex.connect();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ingestion] forex provider connect failed:', err);
  }

  // Backfill ~1 year of medium-frequency history for the default watchlist symbols.
  // Runs in the background so the API can serve immediately while history streams in.
  if (binanceEnabled) {
    void (async () => {
      try {
        await backfillHistory({
          provider: binance,
          targets: DEFAULT_BACKFILL_SYMBOLS.map((symbol) => ({
            symbol,
            intervals: DEFAULT_BACKFILL_INTERVALS,
          })),
        });
        // eslint-disable-next-line no-console
        console.log('[ingestion] backfill complete');
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ingestion] backfill failed', err);
      }
    })();
  }

  return {
    subscriptions,
    candleStore,
    deepTradeDetector,
    heatmapAggregator,
    bus,
    providers: { binance, oanda: forex, mock },
  };
}

// Allow standalone execution.
const isMain = process.argv[1]?.endsWith('main.ts') || process.argv[1]?.endsWith('main.js');
if (isMain) {
  bootstrapIngestion()
    .then((ctx) => {
      // eslint-disable-next-line no-console
      console.log('[ingestion] running. providers=%o', Object.keys(ctx.providers));
      // Pre-subscribe to a couple of popular markets so the in-memory store warms.
      ctx.subscriptions.acquire({ symbol: 'BINANCE:BTCUSDT', kind: 'candles', interval: '1m' });
      ctx.subscriptions.acquire({ symbol: 'BINANCE:BTCUSDT', kind: 'trades' });
      ctx.subscriptions.acquire({ symbol: 'BINANCE:BTCUSDT', kind: 'orderbook' });
      ctx.subscriptions.acquire({ symbol: 'BINANCE:ETHUSDT', kind: 'candles', interval: '1m' });
      ctx.subscriptions.acquire({ symbol: 'BINANCE:ETHUSDT', kind: 'trades' });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[ingestion] fatal', err);
      process.exit(1);
    });
}
