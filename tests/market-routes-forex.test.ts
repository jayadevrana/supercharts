import { describe, expect, it } from 'vitest';
import { marketRoutes } from '../apps/api/src/routes/market';
import type { IngestionContext } from '../apps/ingestion/src/main';
import type { MarketDataProvider } from '../packages/market-data/src/provider';
import type { Candle, Symbol as MarketSymbol } from '@supercharts/types';

function symbol(id: string, assetClass: MarketSymbol['assetClass'] = 'forex'): MarketSymbol {
  const raw = id.split(':')[1] ?? id;
  const [base = raw, quote = 'USD'] = raw.split('_');
  return {
    id,
    rawSymbol: raw,
    base,
    quote,
    venue: id.startsWith('BINANCE:') ? 'BINANCE' : 'YAHOO',
    provider: id.startsWith('BINANCE:') ? 'binance' : 'yahoo',
    assetClass,
    type: assetClass === 'crypto' ? 'spot' : assetClass,
    tickSize: assetClass === 'crypto' ? 0.01 : 0.00001,
    lotSize: 1,
    pricePrecision: assetClass === 'crypto' ? 2 : 5,
    quantityPrecision: 0,
    session: 'test',
    timezone: 'UTC',
    status: 'trading',
  };
}

function provider(
  id: MarketDataProvider['id'],
  searchItems: MarketSymbol[] = [],
  candles: Candle[] = [],
): MarketDataProvider {
  return {
    id,
    capabilities: {
      trades: false,
      quotes: false,
      orderBook: false,
      orderBookDepth: 0,
      candles: true,
      historicalCandles: true,
      historicalTrades: false,
      news: false,
      volumeKind: 'tick',
      assetClasses: ['forex'],
    },
    connect: async () => {},
    disconnect: async () => {},
    health: () => ({
      provider: id,
      venue: id.toUpperCase(),
      status: 'connected',
      lastMessageAt: 1,
      latencyMs: null,
      reconnects: 0,
      subscriptions: 0,
    }),
    onHealth: () => () => {},
    normalizeSymbol: (input) => input,
    searchSymbols: async (_query, limit = 50) => searchItems.slice(0, limit),
    getSymbol: async (canonicalId) => searchItems.find((s) => s.id === canonicalId) ?? null,
    subscribeTrades: (s) => ({ symbol: s, unsubscribe: () => {} }),
    subscribeQuotes: (s) => ({ symbol: s, unsubscribe: () => {} }),
    subscribeOrderBook: (s) => ({ symbol: s, unsubscribe: () => {} }),
    subscribeCandles: (s) => ({ symbol: s, unsubscribe: () => {} }),
    fetchHistoricalCandles: async (s, interval) =>
      candles.map((c) => ({ ...c, symbol: s, interval })),
  };
}

function candle(openTime: number, close: number, open = close): Candle {
  return {
    symbol: 'OANDA:EUR_USD',
    provider: 'yahoo',
    venue: 'YAHOO',
    interval: '1m',
    openTime,
    closeTime: openTime + 59_999,
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
    vwap: close,
    isClosed: true,
    volumeKind: 'tick',
  };
}

function context(providers: Partial<IngestionContext['providers']>): IngestionContext {
  return {
    providers: {
      binance: provider('binance') as IngestionContext['providers']['binance'],
      oanda: provider('yahoo'),
      mock: provider('mock') as IngestionContext['providers']['mock'],
      ...providers,
    },
    subscriptions: {},
    candleStore: {},
    deepTradeDetector: {},
    heatmapAggregator: {},
    footprintAggregator: {},
    bus: {},
  } as IngestionContext;
}

type RouteHandler = (
  req: { query?: unknown; params?: unknown },
  reply: { code: (status: number) => void },
) => Promise<unknown> | unknown;

function withRoutes(ctx: IngestionContext) {
  const routes = new Map<string, RouteHandler>();
  marketRoutes(
    {
      get: (path: string, handler: RouteHandler) => {
        routes.set(path, handler);
      },
    } as never,
    ctx,
  );
  return {
    call: async <T>(path: string, query: unknown): Promise<{ statusCode: number; body: T }> => {
      const handler = routes.get(path);
      if (!handler) throw new Error(`missing route ${path}`);
      let statusCode = 200;
      const body = await handler({ query }, { code: (next) => { statusCode = next; } });
      return { statusCode, body: body as T };
    },
  };
}

describe('market forex routes', () => {
  it('ranks curated forex search results ahead of non-catalog crypto quote matches', async () => {
    const app = withRoutes(
      context({
        binance: provider('binance', [symbol('BINANCE:BTCEUR', 'crypto')]) as IngestionContext['providers']['binance'],
        oanda: provider('yahoo', [
          symbol('OANDA:EUR_JPY'),
          symbol('OANDA:EUR_USD'),
          symbol('OANDA:EUR_GBP'),
        ]),
      }),
    );

    const res = await app.call<{ items: MarketSymbol[] }>('/api/symbols/search', { q: 'EUR', limit: 4 });

    expect(res.statusCode).toBe(200);
    expect(res.body.items.map((s) => s.id)).toEqual([
      'OANDA:EUR_USD',
      'OANDA:EUR_GBP',
      'OANDA:EUR_JPY',
      'BINANCE:BTCEUR',
    ]);
  });

  it('builds non-Binance quotes from provider candles', async () => {
    const app = withRoutes(
      context({
        oanda: provider('yahoo', [], [candle(1_000, 1.1), candle(61_000, 1.155)]),
      }),
    );

    const res = await app.call<{ items: Array<{ symbol: string; lastPrice: number; changePercent: number }> }>(
      '/api/quotes',
      { symbols: 'OANDA:EUR_USD' },
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      symbol: 'OANDA:EUR_USD',
      lastPrice: 1.155,
    });
    expect(res.body.items[0]!.changePercent).toBeCloseTo(5);
  });
});
