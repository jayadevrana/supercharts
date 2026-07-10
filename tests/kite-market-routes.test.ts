import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { marketRoutes } from '../apps/api/src/routes/market';
import type { Candle, Symbol } from '@supercharts/types';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const Fastify = apiRequire('fastify').default as typeof import('fastify').default;

const symbol: Symbol = {
  id: 'KITE:NSE:INFY', base: 'INFOSYS', quote: 'INR', venue: 'KITE', provider: 'kite', assetClass: 'stock', type: 'spot',
  tickSize: 0.05, lotSize: 1, pricePrecision: 2, quantityPrecision: 0, rawSymbol: 'INFY', status: 'trading', timezone: 'Asia/Kolkata',
};
const candle: Candle = {
  symbol: symbol.id, provider: 'kite', venue: 'KITE', interval: '1d', openTime: 1, closeTime: 86_400_000,
  open: 100, high: 110, low: 90, close: 105, volume: 1_000, quoteVolume: 0, buyVolume: 0, sellVolume: 0, delta: 0, trades: 0, vwap: 105, isClosed: true, volumeKind: 'real',
};

describe('Kite market routes', () => {
  it('returns Kite catalog records through normal symbol search and candles routes', async () => {
    const app = Fastify();
    let requestedFrom = 0;
    const provider = { searchSymbols: async () => [symbol], getSymbol: async () => symbol, fetchHistoricalCandles: async (_symbol: string, _interval: string, from: number) => { requestedFrom = from; return [candle]; }, capabilities: { historicalCandles: true, volumeKind: 'real' } };
    const ctx = { providers: { kite: provider }, candleStore: { query: () => [], upsert: () => {} }, subscriptions: { acquire: () => {}, health: () => [] }, heatmapAggregator: { history: () => [] }, deepTradeDetector: { history: () => [] } };
    marketRoutes(app, ctx as never);
    const search = await app.inject('/api/symbols/search?q=infy');
    expect(search.statusCode).toBe(200);
    expect(search.json().items[0]).toMatchObject({ id: symbol.id, provider: 'kite' });
    const chart = await app.inject(`/api/candles?symbol=${symbol.id}&interval=1d&from=0&to=${Date.now()}`);
    expect(chart.statusCode).toBe(200);
    expect(chart.json().candles).toHaveLength(1);
    expect(requestedFrom).toBeGreaterThan(Date.now() - 366 * 24 * 60 * 60_000);
    await app.close();
  });
});
