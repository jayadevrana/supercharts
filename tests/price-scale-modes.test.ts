import { describe, it, expect } from 'vitest';
import { PriceScale } from '../packages/chart-core/src/scale';
import { logTicks, priceTickValues } from '../packages/chart-core/src/layers/grid';
import { priceAxisLabel } from '../packages/chart-core/src/layers/axis';

describe('logTicks', () => {
  it('lays round prices per decade across a wide range', () => {
    const ticks = logTicks(100, 100_000, 12);
    // 3 decades → 1-2-5 mantissas: 100,200,500,1k,2k,5k,10k,20k,50k,100k
    expect(ticks).toEqual([100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]);
  });

  it('falls back to linear nice ticks on narrow (intraday) ranges', () => {
    const ticks = logTicks(61500, 64000, 10);
    // < one octave: uniform linear steps (200 here), not 1-2-5 decade jumps
    expect(ticks).toContain(62000);
    expect(ticks.length).toBeGreaterThan(5);
    for (const t of ticks) expect(Math.abs(t % 200)).toBeLessThan(1e-6);
  });

  it('respects the density target', () => {
    const sparse = logTicks(1, 1_000_000, 7);
    const dense = logTicks(1, 1_000_000, 20);
    expect(dense.length).toBeGreaterThan(sparse.length);
  });
});

describe('priceTickValues — percent mode', () => {
  it('produces round percent steps mapped back to prices', () => {
    const ticks = priceTickValues(
      { priceMin: 95, priceMax: 110, mode: 'percent', baseline: 100 },
      6,
    );
    // -5%..+10% with ~6 targets → steps of 2% (1-2-5 ladder): -4,-2,0,+2,...
    for (const t of ticks) {
      const pct = (t / 100 - 1) * 100;
      expect(Math.abs(pct % 2)).toBeLessThan(1e-9);
    }
    expect(ticks).toContain(100); // 0% line present
  });

  it('falls back to linear ticks without a baseline', () => {
    const withBase = priceTickValues({ priceMin: 95, priceMax: 110, mode: 'percent', baseline: 100 }, 6);
    const noBase = priceTickValues({ priceMin: 95, priceMax: 110, mode: 'percent' }, 6);
    expect(noBase).not.toEqual(withBase);
    expect(noBase.length).toBeGreaterThan(0);
  });
});

describe('priceAxisLabel', () => {
  it('formats percent labels with sign vs the baseline', () => {
    const st = { mode: 'percent' as const, baseline: 100 };
    expect(priceAxisLabel(102.5, st)).toBe('+2.50%');
    expect(priceAxisLabel(97.5, st)).toBe('-2.50%');
    expect(priceAxisLabel(100, st)).toBe('0.00%');
  });

  it('formats prices in other modes', () => {
    expect(priceAxisLabel(63796.48, { mode: 'linear' })).toBe('63,796.48');
    expect(priceAxisLabel(63796.48, { mode: 'log' })).toBe('63,796.48');
  });
});

describe('PriceScale log-space pan/zoom', () => {
  it('pan preserves the price RATIO span in log mode', () => {
    const s = new PriceScale({ height: 800, priceMin: 100, priceMax: 1000, mode: 'log', inverted: false });
    const ratioBefore = s.state.priceMax / s.state.priceMin;
    s.pan(120);
    expect(s.state.priceMax / s.state.priceMin).toBeCloseTo(ratioBefore, 9);
    // Positive dy (drag down) shifts the window to higher prices — same direction as linear.
    expect(s.state.priceMax).toBeGreaterThan(1000);
  });

  it('zoomAroundY keeps the focal price pinned in log mode', () => {
    const s = new PriceScale({ height: 800, priceMin: 100, priceMax: 1000, mode: 'log', inverted: false });
    const focalY = 300;
    const before = s.yToPrice(focalY);
    s.zoomAroundY(focalY, 1.5);
    expect(s.yToPrice(focalY)).toBeCloseTo(before, 6);
  });

  it('linear pan unchanged (regression)', () => {
    const s = new PriceScale({ height: 800, priceMin: 100, priceMax: 200, mode: 'linear', inverted: false });
    s.pan(80); // 10% of height → 10 price units
    expect(s.state.priceMin).toBeCloseTo(110);
    expect(s.state.priceMax).toBeCloseTo(210);
  });
});
