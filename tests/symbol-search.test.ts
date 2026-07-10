import { describe, expect, it } from 'vitest';
import { symbolResultLabel, symbolResultTone, type RemoteSymbolResult } from '../apps/web/features/terminal/symbol-search-util';
import { supportsInterval } from '../apps/web/features/terminal/interval-support';

const kiteFuture: RemoteSymbolResult = {
  id: 'KITE:NFO:NIFTY26JULFUT', assetClass: 'futures', venue: 'KITE', rawSymbol: 'NIFTY26JULFUT', segment: 'NFO-FUT', expiry: '2026-07-30',
};

describe('symbol search presentation', () => {
  it('labels a Kite derivative with exchange and segment details', () => {
    expect(symbolResultLabel(kiteFuture)).toBe('NIFTY26JULFUT · NFO · FUT');
    expect(symbolResultTone(kiteFuture)).toBe('warn');
  });

  it('keeps normal symbols compact', () => {
    const crypto: RemoteSymbolResult = { id: 'BINANCE:BTCUSDT', assetClass: 'crypto', venue: 'BINANCE', rawSymbol: 'BTCUSDT' };
    expect(symbolResultLabel(crypto)).toBe('BTCUSDT · BINANCE');
    expect(symbolResultTone(crypto)).toBe('accent');
  });

  it('shows only Kite-supported chart intervals', () => {
    expect(supportsInterval('KITE:NSE:INFY', '1m')).toBe(true);
    expect(supportsInterval('KITE:NSE:INFY', '1d')).toBe(true);
    expect(supportsInterval('KITE:NSE:INFY', '1s')).toBe(false);
    expect(supportsInterval('KITE:NSE:INFY', '4h')).toBe(false);
  });
});
