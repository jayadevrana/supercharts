import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { marketRoutes } from '../apps/api/src/routes/market';
import { openDB } from '../apps/api/src/db';
import { saveConnection, updateAccessToken } from '../apps/api/src/broker/store';
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

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? 'd'.repeat(64);
const dir = mkdtempSync(join(tmpdir(), 'sc-kite-routes-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function makeCtx() {
  let requestedFrom = 0;
  const provider = {
    searchSymbols: async () => [symbol],
    getSymbol: async () => symbol,
    fetchHistoricalCandles: async (_symbol: string, _interval: string, from: number) => { requestedFrom = from; return [candle]; },
    capabilities: { historicalCandles: true, volumeKind: 'real' },
  };
  const ctx = { providers: { kite: provider }, candleStore: { query: () => [], upsert: () => {} }, subscriptions: { acquire: () => {}, health: () => [] }, heatmapAggregator: { history: () => [] }, deepTradeDetector: { history: () => [] } };
  return { ctx, requestedFrom: () => requestedFrom };
}

describe('Kite market routes', () => {
  it('GW-6 compliance: without an own active connection, KITE data is refused', async () => {
    const app = Fastify();
    const { ctx } = makeCtx();
    marketRoutes(app, ctx as never); // no db → gate fails closed
    const search = await app.inject('/api/symbols/search?q=infy');
    expect(search.statusCode).toBe(200);
    expect(search.json().items).toHaveLength(0); // kite results filtered out
    const chart = await app.inject(`/api/candles?symbol=${symbol.id}&interval=1d&from=0&to=${Date.now()}`);
    expect(chart.statusCode).toBe(403);
    expect(chart.json().error).toBe('broker_connection_required');
    const sym = await app.inject(`/api/symbols/${symbol.id}`);
    expect(sym.statusCode).toBe(403);
    await app.close();
  });

  it('with an own ACTIVE connection, Kite search + candles flow (1y history clamp intact)', async () => {
    const db = openDB({ DATABASE_URL: `file:${join(dir, 'routes.sqlite')}` } as NodeJS.ProcessEnv);
    saveConnection(db, { userId: 'demo', broker: 'kite', apiKey: 'k1', apiSecret: 's1', accessToken: null, accountMeta: null });
    updateAccessToken(db, 'demo', 'kite', 'tok');
    const prevAuth = process.env.AUTH_ENABLED;
    process.env.AUTH_ENABLED = '0'; // requests resolve to the demo user, who owns the connection
    try {
      const app = Fastify();
      const { ctx, requestedFrom } = makeCtx();
      marketRoutes(app, ctx as never, db);
      const search = await app.inject('/api/symbols/search?q=infy');
      expect(search.statusCode).toBe(200);
      expect(search.json().items[0]).toMatchObject({ id: symbol.id, provider: 'kite' });
      const chart = await app.inject(`/api/candles?symbol=${symbol.id}&interval=1d&from=0&to=${Date.now()}`);
      expect(chart.statusCode).toBe(200);
      expect(chart.json().candles).toHaveLength(1);
      expect(requestedFrom()).toBeGreaterThan(Date.now() - 366 * 24 * 60 * 60_000);
      await app.close();
    } finally {
      if (prevAuth === undefined) delete process.env.AUTH_ENABLED;
      else process.env.AUTH_ENABLED = prevAuth;
    }
  });
});
