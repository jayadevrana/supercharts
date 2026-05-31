import { describe, it, expect } from 'vitest';
import { rvol, vwapBands } from '../packages/indicators/src/volume';
import { k } from './_helpers';

describe('rvol (relative volume)', () => {
  it('equals 1 when every bar has identical volume', () => {
    const candles = Array.from({ length: 25 }, (_, i) => k(i * 60_000, 100, 101, 99, 100, 100));
    const r = rvol(candles, { length: 20 });
    expect(Number.isNaN(r[19]!)).toBe(true); // not enough prior bars yet
    expect(r[20]!).toBeCloseTo(1);
    expect(r[24]!).toBeCloseTo(1);
  });

  it('reports the ratio against the prior-N average (a 3× spike ⇒ 3)', () => {
    const candles = Array.from({ length: 22 }, (_, i) =>
      k(i * 60_000, 100, 101, 99, 100, i === 21 ? 300 : 100),
    );
    const r = rvol(candles, { length: 20 });
    // bar 21's denominator is bars 1..20 (all 100) — the spike is excluded from its own average.
    expect(r[21]!).toBeCloseTo(3);
  });

  it('is all-NaN when the series is shorter than the lookback', () => {
    const candles = Array.from({ length: 10 }, (_, i) => k(i * 60_000, 100, 101, 99, 100, 100));
    expect(rvol(candles, { length: 20 }).every((x) => Number.isNaN(x))).toBe(true);
  });
});

describe('vwapBands', () => {
  it('collapses all bands onto VWAP when typical price never varies (σ=0)', () => {
    const flat = Array.from({ length: 10 }, (_, i) => k(i * 60_000, 100, 100, 100, 100, 100));
    const b = vwapBands(flat, { mode: 'cumulative' });
    expect(b.vwap[9]!).toBeCloseTo(100);
    expect(b.upper2[9]!).toBeCloseTo(100);
    expect(b.lower2[9]!).toBeCloseTo(100);
  });

  it('keeps bands ordered: lower2 ≤ lower1 ≤ vwap ≤ upper1 ≤ upper2', () => {
    const varied = [
      k(0, 100, 102, 98, 100, 100),
      k(60_000, 101, 104, 100, 103, 200),
      k(120_000, 99, 101, 97, 98, 150),
    ];
    const b = vwapBands(varied, { mode: 'cumulative', multiplier1: 1, multiplier2: 2 });
    const i = 2;
    expect(b.upper2[i]!).toBeGreaterThanOrEqual(b.upper1[i]!);
    expect(b.upper1[i]!).toBeGreaterThanOrEqual(b.vwap[i]!);
    expect(b.vwap[i]!).toBeGreaterThanOrEqual(b.lower1[i]!);
    expect(b.lower1[i]!).toBeGreaterThanOrEqual(b.lower2[i]!);
  });

  it('VWAP equals the volume-weighted mean of typical price', () => {
    const varied = [
      k(0, 100, 102, 98, 100, 100),
      k(60_000, 101, 104, 100, 103, 200),
    ];
    const b = vwapBands(varied, { mode: 'cumulative' });
    const tp0 = (102 + 98 + 100) / 3;
    const tp1 = (104 + 100 + 103) / 3;
    expect(b.vwap[1]!).toBeCloseTo((tp0 * 100 + tp1 * 200) / 300, 6);
  });

  it('resets at the UTC day boundary in session mode', () => {
    const sess = [
      k(0, 100, 102, 98, 100, 100),
      k(60_000, 101, 104, 100, 103, 200),
      k(86_400_000, 200, 201, 199, 200, 50), // next UTC day
    ];
    const b = vwapBands(sess, { mode: 'session' });
    // First bar of the new day → VWAP is just that bar's typical price.
    expect(b.vwap[2]!).toBeCloseTo((201 + 199 + 200) / 3, 6);
  });
});
