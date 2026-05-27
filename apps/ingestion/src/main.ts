/**
 * Ingestion service entry. Loaded by `pnpm dev:ingestion`.
 *
 * For our single-process MVP, the API server imports `bootstrapIngestion()` directly
 * and runs it in the same Node process. The standalone `main` is here so the same code
 * can scale out to a dedicated worker when traffic grows.
 */
import { BinanceProvider, MockProvider, OandaProvider } from '@supercharts/market-data';
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
    oanda: OandaProvider;
    mock: MockProvider;
  };
}

export async function bootstrapIngestion(env: NodeJS.ProcessEnv = process.env): Promise<IngestionContext> {
  const binanceEnabled = env.BINANCE_ENABLED !== 'false';
  const binance = new BinanceProvider();
  const oanda = new OandaProvider({
    apiToken: env.OANDA_API_TOKEN,
    accountId: env.OANDA_ACCOUNT_ID,
    env: env.OANDA_ENV === 'live' ? 'live' : 'practice',
  });
  const mock = new MockProvider();

  const subscriptions = new SubscriptionManager({ binance, oanda, mock });

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
    providers: { binance, oanda, mock },
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
