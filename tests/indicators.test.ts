import { describe, it, expect } from 'vitest';
import { computeAll } from '../packages/indicators/src/runner';
import { series } from './_helpers';

describe('computeAll', () => {
  it('SMA matches a hand-computed value', () => {
    const out = computeAll('sma', series([1, 2, 3, 4, 5]) as never, { length: 3, source: 'close' });
    const v = out.get('value')!;
    expect(v[2]).toBeCloseTo(2); // (1+2+3)/3
    expect(v[4]).toBeCloseTo(4); // (3+4+5)/3
  });

  it('EMA returns one value per candle, finite at the end', () => {
    const out = computeAll('ema', series([10, 11, 12, 13, 14, 15, 16]) as never, {
      length: 3,
      source: 'close',
    });
    const v = out.get('value')!;
    expect(v.length).toBe(7);
    expect(Number.isFinite(v[v.length - 1]!)).toBe(true);
  });

  it('RSI stays within 0..100', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const out = computeAll('rsi', series(closes) as never, { length: 14, source: 'close' });
    const v = out.get('value')!.filter((x) => Number.isFinite(x));
    expect(v.length).toBeGreaterThan(0);
    for (const x of v) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
    }
  });
});
