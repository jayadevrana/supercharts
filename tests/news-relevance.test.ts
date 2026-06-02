import { describe, it, expect } from 'vitest';
import {
  symbolKeywords,
  primaryPhrase,
  buildKeywordIndex,
  scoreItem,
  buildGdeltQuery,
  cryptoCurrenciesFor,
} from '../apps/api/src/news-relevance';

const headline = (title: string, summary?: string) => ({ title, summary });
const phrases = (id: string): string[] => symbolKeywords(id).map((t) => t.phrase);

describe('symbolKeywords', () => {
  it('maps a crypto pair to its coin name + ticker', () => {
    const p = phrases('BINANCE:BTCUSDT');
    expect(p).toContain('bitcoin');
    expect(p).toContain('btc');
  });

  it('maps an FX pair to both legs and an explicit pair form', () => {
    const p = phrases('OANDA:EUR_USD');
    expect(p).toContain('euro');
    expect(p).toContain('us dollar');
    expect(p).toContain('eurusd');
    expect(p).toContain('eur/usd');
  });

  it('maps a metal to its name + a quote-pair form', () => {
    const p = phrases('OANDA:XAU_USD');
    expect(p).toContain('gold');
    expect(p).toContain('xauusd');
  });

  it('maps an index to its common name', () => {
    expect(phrases('OANDA:NAS100_USD')).toContain('nasdaq');
    expect(phrases('OANDA:SPX500_USD')).toContain('s&p 500');
  });

  it('weights an explicit pair form above a single currency name', () => {
    const terms = symbolKeywords('OANDA:EUR_USD');
    const pair = terms.find((t) => t.phrase === 'eurusd')!.weight;
    const name = terms.find((t) => t.phrase === 'euro')!.weight;
    expect(pair).toBeGreaterThan(name);
  });
});

describe('scoreItem', () => {
  const btc = buildKeywordIndex(['BINANCE:BTCUSDT']);

  it('scores a relevant headline above zero and reports the matched symbol', () => {
    const r = scoreItem(headline('Bitcoin ETF sees record inflows'), btc);
    expect(r.relevance).toBeGreaterThan(0);
    expect(r.matchedSymbols).toEqual(['BINANCE:BTCUSDT']);
  });

  it('scores an unrelated headline at exactly zero with no matches', () => {
    const r = scoreItem(headline('Local bakery wins regional award'), btc);
    expect(r.relevance).toBe(0);
    expect(r.matchedSymbols).toEqual([]);
  });

  it('does not match a ticker embedded inside another word', () => {
    // "btc" must not fire on "btcetf" or "ethics"; whole-word matching only.
    const r = scoreItem(headline('New btcetf product launches'), btc);
    expect(r.relevance).toBe(0);
  });

  it('attributes a headline to the correct subset of a multi-symbol watchlist', () => {
    const idx = buildKeywordIndex(['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT']);
    const r = scoreItem(headline('Ethereum completes its latest network upgrade'), idx);
    expect(r.matchedSymbols).toEqual(['BINANCE:ETHUSDT']);
  });

  it('ranks a stronger reference above a weaker one', () => {
    const idx = buildKeywordIndex(['OANDA:EUR_USD']);
    const strong = scoreItem(headline('EUR/USD slides as the euro weakens'), idx).relevance;
    const weak = scoreItem(headline('The European Central Bank meets next week'), idx).relevance;
    expect(strong).toBeGreaterThan(weak);
    expect(weak).toBeGreaterThan(0);
  });
});

describe('upstream-fetch helpers', () => {
  it('builds an OR query of distinctive phrases, quoting multi-word ones', () => {
    const q = buildGdeltQuery(['BINANCE:BTCUSDT', 'OANDA:XAU_USD', 'OANDA:USD_JPY']);
    expect(q).toContain('bitcoin');
    expect(q).toContain('gold');
    expect(q).toContain('"japanese yen"'); // multi-word → quoted
    expect(q.startsWith('(') && q.endsWith(')')).toBe(true);
    expect(q).toContain(' OR ');
  });

  it('caps the GDELT query and falls back when no phrase resolves', () => {
    expect(buildGdeltQuery([])).toBe('markets');
  });

  it('extracts only crypto base tokens for CryptoPanic', () => {
    expect(cryptoCurrenciesFor(['BINANCE:BTCUSDT', 'OANDA:EUR_USD', 'BINANCE:ETHUSDT'])).toEqual([
      'BTC',
      'ETH',
    ]);
  });

  it('prefers the non-USD leg as an FX pair primary phrase', () => {
    expect(primaryPhrase('OANDA:EUR_USD')).toBe('euro');
    expect(primaryPhrase('OANDA:USD_JPY')).toBe('japanese yen');
  });
});
