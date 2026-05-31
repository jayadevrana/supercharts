import { describe, it, expect } from 'vitest';
import { buildVisibleRangeProfile } from '../packages/chart-core/src/profile-builder';
import { k } from './_helpers';

describe('buildVisibleRangeProfile', () => {
  it('returns empty for no candles', () => {
    const r = buildVisibleRangeProfile([], 1, 0.7);
    expect(r.levels).toEqual([]);
    expect(r.totalVolume).toBe(0);
  });

  it('caps buckets so a huge range / tiny rowSize cannot blow the stack (gold @ ~4500, FX 0.0001)', () => {
    const candles = Array.from({ length: 50 }, (_, i) =>
      k(i * 60000, 4500 + i, 4600 + i, 4495 + i, 4550 + i, 100),
    );
    const r = buildVisibleRangeProfile(candles, 0.0001, 0.7);
    expect(r.levels.length).toBeGreaterThan(0);
    expect(r.levels.length).toBeLessThanOrEqual(600);
    expect(Number.isFinite(r.poc)).toBe(true);
  });

  it('puts the POC at the highest-volume price band', () => {
    const candles = [
      k(0, 100, 100.4, 99.6, 100, 10),
      k(60000, 100, 100.4, 99.6, 100, 1000),
      k(120000, 110, 110.4, 109.6, 110, 10),
    ];
    const r = buildVisibleRangeProfile(candles, 0.5, 0.7);
    expect(r.poc).toBeGreaterThan(99);
    expect(r.poc).toBeLessThan(101);
    expect(r.vah).toBeGreaterThanOrEqual(r.poc);
    expect(r.val).toBeLessThanOrEqual(r.poc);
  });
});
