import { describe, it, expect } from 'vitest';
import { computeAll } from '../packages/indicators/src/runner';
import { ema } from '../packages/indicators/src/ma';
import type { Candle } from '@supercharts/types';

const candles: Candle[] = Array.from({ length: 80 }, (_, i) => {
  const close = 100 + Math.sin(i / 5) * 10 + i * 0.3;
  return { openTime: i, closeTime: i, open: close, high: close + 1, low: close - 1, close, volume: 100 } as Candle;
});

describe('ema over a NaN-prefixed series (regression)', () => {
  it('seeds past the leading NaN instead of propagating NaN forever', () => {
    const series = [NaN, NaN, NaN, 10, 11, 12, 13, 14, 15, 16];
    const out = ema(series, 3);
    // First finite value is at the first window end past the prefix; the tail must be finite.
    expect(Number.isFinite(out[out.length - 1]!)).toBe(true);
    expect(out.slice(0, 3).every((v) => Number.isNaN(v))).toBe(true);
  });
  it('is unchanged for a plain series with no NaN prefix', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeCloseTo(2, 6); // SMA seed of [1,2,3]
  });
});

describe('computeAll macd', () => {
  it('produces finite signal + histogram after warmup', () => {
    const ch = computeAll('macd', candles, { fast: 12, slow: 26, signal: 9 });
    const macdLine = ch.get('macd')!;
    const signal = ch.get('signal')!;
    const hist = ch.get('histogram')!;
    // signal needs slow(26)+signal(9) ≈ 35 bars warmup; by bar 60 all three must be finite.
    expect(Number.isFinite(macdLine[60]!)).toBe(true);
    expect(Number.isFinite(signal[60]!)).toBe(true);
    expect(Number.isFinite(hist[60]!)).toBe(true);
    expect(hist[60]!).toBeCloseTo(macdLine[60]! - signal[60]!, 6);
  });
});
