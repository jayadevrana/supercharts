import { describe, it, expect } from 'vitest';
import { computeMaCross } from '../packages/chart-core/src/indicators/ma-cross';
import { series } from './_helpers';

describe('computeMaCross', () => {
  it('detects a bullish price-vs-MA cross when price turns up through its MA', () => {
    const closes = [50, 48, 46, 44, 42, 40, 38, 36, 40, 46, 52, 58, 64, 70];
    const { ma, crosses } = computeMaCross(series(closes) as never, {
      type: 'sma',
      length: 5,
      source: 'close',
    });
    expect(ma.length).toBe(closes.length);
    expect(crosses.filter((c) => c.side === 'buy').length).toBeGreaterThanOrEqual(1);
    for (const c of crosses) {
      expect(Number.isFinite(c.price)).toBe(true);
      expect(Number.isFinite(c.maValue)).toBe(true);
    }
  });

  it('dual-MA mode emits a golden cross (fast over slow)', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i).concat(
      Array.from({ length: 20 }, (_, i) => 80 + i * 2),
    );
    const { maSlow, crosses } = computeMaCross(series(closes) as never, {
      type: 'ema',
      length: 5,
      source: 'close',
      crossWith: { type: 'ema', length: 10 },
    });
    expect(maSlow).toBeDefined();
    expect(crosses.some((c) => c.side === 'buy')).toBe(true);
  });

  it('no crosses on a flat series', () => {
    const { crosses } = computeMaCross(series(Array(30).fill(100)) as never, {
      type: 'ema',
      length: 5,
      source: 'close',
      crossWith: { type: 'ema', length: 10 },
    });
    expect(crosses.length).toBe(0);
  });
});
