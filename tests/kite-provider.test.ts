import { describe, expect, it, vi } from 'vitest';
import {
  KITE_ALLOWED_PATHS,
  KiteProvider,
  assertKiteReadOnlyPath,
  parseKiteInstrumentsCsv,
} from '../packages/market-data/src/providers/kite';

const CSV = [
  'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
  '408065,1594,INFY,INFOSYS,0,,,0.05,1,EQ,NSE,NSE',
  '256265,1001,NIFTY 50,NIFTY 50,0,,,0.05,1,EQ,INDICES,NSE',
  '123,456,NIFTY26JULFUT,,0,2026-07-30,,0.05,75,FUT,NFO-FUT,NFO',
  // Non-NSE rows below — must be dropped by the NSE-only scope.
  '500325,2885,RELIANCE,RELIANCE INDUSTRIES,0,,,0.05,1,EQ,BSE,BSE', // BSE stock
  '1,9,SENSEX,SENSEX,0,,,0.01,1,EQ,INDICES,BSE',                    // BSE index
  '2,8,GOLD26AUGFUT,GOLD,0,2026-08-05,,1,100,FUT,FUT,MCX',          // MCX commodity
  '3,7,USDINR26JULFUT,USDINR,0,2026-07-28,,0.0025,1,FUT,FUT,CDS',   // NSE currency (out per scope)
].join('\n');

describe('KiteProvider', () => {
  it('maps every active CSV record to an exchange-qualified canonical symbol', () => {
    const catalog = parseKiteInstrumentsCsv(CSV);
    expect(catalog.map((x) => x.id)).toEqual(['KITE:NSE:INFY', 'KITE:NSE:NIFTY_50', 'KITE:NFO:NIFTY26JULFUT']);
    expect(catalog[2]).toMatchObject({ assetClass: 'futures', expiry: '2026-07-30', lotSize: 75 });
  });

  it('NSE-only scope drops BSE stocks/indices, MCX, and currency', () => {
    const ids = parseKiteInstrumentsCsv(CSV).map((x) => x.id);
    expect(ids.some((id) => id.startsWith('KITE:BSE:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('KITE:MCX:'))).toBe(false);
    expect(ids.some((id) => id.startsWith('KITE:CDS:'))).toBe(false);
    // Only NSE-family (NSE + NFO) survives.
    expect(ids.every((id) => id.startsWith('KITE:NSE:') || id.startsWith('KITE:NFO:'))).toBe(true);
  });

  it('allows only read-only market data paths before issuing a request', () => {
    expect(() => assertKiteReadOnlyPath('/instruments')).not.toThrow();
    expect(() => assertKiteReadOnlyPath('/instruments/historical/408065/day')).not.toThrow();
    expect(() => assertKiteReadOnlyPath('/orders/regular')).toThrow('not allowed');
    expect(KITE_ALLOWED_PATHS).not.toEqual(expect.arrayContaining(['/orders', '/portfolio', '/gtt']));
  });

  it('ranks the equity above its F&O contracts and matches lowercase queries', async () => {
    const rankCsv = [
      'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
      // Deliberately list the derivatives FIRST (as Kite's dump often does) to prove the ranking
      // — not insertion order — decides the result.
      '800002,7001,IDEA26JULFUT,VODAFONE IDEA,0,2026-07-30,,0.05,4000,FUT,NFO-FUT,NFO',
      '800003,7002,IDEA26JUL14CE,VODAFONE IDEA,0,2026-07-14,14,0.05,4000,CE,NFO-OPT,NFO',
      '800001,7000,IDEA,VODAFONE IDEA,0,,,0.05,1,EQ,NSE,NSE',
    ].join('\n');
    const provider = new KiteProvider({ apiKey: 'k', accessToken: 't', fetchFn: vi.fn(async () => new Response(rankCsv, { status: 200 })) });
    await provider.refreshInstruments();
    // Lowercase query must work AND put the cash equity at the top.
    const hits = await provider.searchSymbols('idea', 10);
    expect(hits[0]!.id).toBe('KITE:NSE:IDEA');
    expect(hits[0]!.assetClass).toBe('stock');
    // The F&O contracts still appear, just below the equity.
    expect(hits.map((h) => h.id)).toContain('KITE:NFO:IDEA26JULFUT');
    // Mixed-case query resolves identically.
    expect((await provider.searchSymbols('IdEa'))[0]!.id).toBe('KITE:NSE:IDEA');
  });

  it('searches the imported catalog and maps real historical candles', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/instruments')) return new Response(CSV, { status: 200 });
      if (url.includes('/historical/408065/day')) return Response.json({ status: 'success', data: { candles: [['2026-07-09T00:00:00+0530', 100, 110, 90, 105, 1234]] } });
      return new Response('unexpected', { status: 404 });
    });
    const provider = new KiteProvider({ apiKey: 'key', accessToken: 'token', fetchFn });
    await provider.refreshInstruments();
    expect((await provider.searchSymbols('infy'))[0]).toMatchObject({ id: 'KITE:NSE:INFY', provider: 'kite' });
    const candles = await provider.fetchHistoricalCandles('KITE:NSE:INFY', '1d', 0, Date.now());
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ symbol: 'KITE:NSE:INFY', close: 105, volume: 1234, volumeKind: 'real' });
  });

  it('does not open more than 3,000 live subscriptions on one connection', () => {
    const provider = new KiteProvider({ apiKey: 'key', accessToken: 'token' });
    expect(() => provider.assertSubscriptionCapacity(3001)).toThrow('live_capacity_reached');
  });
});
