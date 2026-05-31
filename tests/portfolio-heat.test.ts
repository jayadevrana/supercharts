import { describe, it, expect } from 'vitest';
import { pearson, decompose, buildPortfolioHeat } from '../apps/api/src/portfolio-heat';
import { series } from './_helpers';

describe('pearson', () => {
  it('is +1 for perfectly correlated, -1 for anti-correlated', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(pearson(a, a.map((x) => x * 2 + 1))!).toBeCloseTo(1, 5);
    expect(pearson(a, [...a].reverse())!).toBeCloseTo(-1, 5);
  });
  it('returns null for fewer than 8 paired points', () => {
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeNull();
  });
});

describe('decompose', () => {
  it('splits FX and concatenated crypto symbols', () => {
    expect(decompose('OANDA:EUR_USD')).toEqual({ base: 'EUR', quote: 'USD' });
    expect(decompose('BINANCE:BTCUSDT')).toEqual({ base: 'BTC', quote: 'USDT' });
  });
});

describe('buildPortfolioHeat', () => {
  it('flags two correlated long positions as stacked risk', () => {
    const candles = new Map<string, ReturnType<typeof series>>([
      ['BINANCE:BTCUSDT', series(Array.from({ length: 30 }, (_, i) => 100 + i))],
      ['BINANCE:ETHUSDT', series(Array.from({ length: 30 }, (_, i) => 50 + i * 0.5))],
    ]);
    const heat = buildPortfolioHeat(
      [
        { symbol: 'BINANCE:BTCUSDT', side: 'buy' },
        { symbol: 'BINANCE:ETHUSDT', side: 'buy' },
      ],
      candles as never,
      { lookback: 30, interval: '1m' },
    );
    expect(heat.symbols.length).toBe(2);
    expect(heat.pairs.length).toBeGreaterThanOrEqual(1);
    const p = heat.pairs[0]!;
    expect(p.corr).toBeGreaterThan(0.6);
    expect(p.stacked).toBe(true); // both long + positively correlated → amplified risk
    expect(heat.concentration).toBeGreaterThan(0);
  });

  it('two opposite-side legs on correlated symbols hedge (not stacked)', () => {
    const candles = new Map<string, ReturnType<typeof series>>([
      ['BINANCE:BTCUSDT', series(Array.from({ length: 30 }, (_, i) => 100 + i))],
      ['BINANCE:ETHUSDT', series(Array.from({ length: 30 }, (_, i) => 50 + i * 0.5))],
    ]);
    const heat = buildPortfolioHeat(
      [
        { symbol: 'BINANCE:BTCUSDT', side: 'buy' },
        { symbol: 'BINANCE:ETHUSDT', side: 'sell' },
      ],
      candles as never,
      { lookback: 30, interval: '1m' },
    );
    expect(heat.pairs[0]!.stacked).toBe(false);
  });
});
