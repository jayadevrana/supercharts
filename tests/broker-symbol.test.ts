import { describe, expect, it } from 'vitest';
import { parseBrokerSymbol } from '../apps/web/lib/broker-symbol';

describe('parseBrokerSymbol', () => {
  it('parses a KITE equity id', () => {
    expect(parseBrokerSymbol('KITE:NSE:RELIANCE')).toEqual({ broker: 'kite', exchange: 'NSE', tradingSymbol: 'RELIANCE' });
  });
  it('restores spaces from canonical underscores', () => {
    expect(parseBrokerSymbol('KITE:NFO:NIFTY_50')).toEqual({ broker: 'kite', exchange: 'NFO', tradingSymbol: 'NIFTY 50' });
  });
  it('returns null for non-broker symbols', () => {
    expect(parseBrokerSymbol('BINANCE:BTCUSDT')).toBeNull();
    expect(parseBrokerSymbol('OANDA:EUR_USD')).toBeNull();
  });
});
