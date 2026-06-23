import { describe, expect, it } from 'vitest';
import { YahooProvider } from '../packages/market-data/src/providers/yahoo';

describe('YahooProvider forex fallback', () => {
  it('discovers curated OANDA forex pairs without an API key', async () => {
    const provider = new YahooProvider({
      fetchFn: (() => {
        throw new Error('network should not be needed for symbol search');
      }) as typeof fetch,
    });

    const items = await provider.searchSymbols('EUR', 20);

    expect(items.map((s) => s.id)).toContain('OANDA:EUR_USD');
    expect(items.map((s) => s.id)).toContain('OANDA:EUR_JPY');
    expect(items.find((s) => s.id === 'OANDA:EUR_USD')).toMatchObject({
      provider: 'yahoo',
      venue: 'YAHOO',
      assetClass: 'forex',
    });
  });

  it('matches common forex query formats', async () => {
    const provider = new YahooProvider({
      fetchFn: (() => {
        throw new Error('network should not be needed for symbol search');
      }) as typeof fetch,
    });

    await expect(provider.searchSymbols('EURUSD', 5).then((items) => items.map((s) => s.id))).resolves.toContain(
      'OANDA:EUR_USD',
    );
    await expect(provider.searchSymbols('OANDA:EUR_USD', 5).then((items) => items.map((s) => s.id))).resolves.toContain(
      'OANDA:EUR_USD',
    );
  });

  it('maps OANDA-style symbols to Yahoo-backed metadata', async () => {
    const provider = new YahooProvider({
      fetchFn: (() => {
        throw new Error('network should not be needed for metadata');
      }) as typeof fetch,
    });

    const symbol = await provider.getSymbol('OANDA:AUD_JPY');

    expect(symbol).toMatchObject({
      id: 'OANDA:AUD_JPY',
      rawSymbol: 'AUD_JPY',
      provider: 'yahoo',
      venue: 'YAHOO',
      pricePrecision: 3,
    });
  });
});
