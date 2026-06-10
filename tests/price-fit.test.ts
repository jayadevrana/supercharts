import { describe, it, expect } from 'vitest';
import { fitTarget, smoothStep, isNearRange, rangesOverlap } from '../packages/chart-core/src/price-fit';

describe('fitTarget', () => {
  it('matches PriceScale.fit math (span padding)', () => {
    const r = fitTarget(100, 200, 0.08);
    // span 100, pad 8
    expect(r.min).toBeCloseTo(92);
    expect(r.max).toBeCloseTo(208);
  });

  it('guards a degenerate span', () => {
    const r = fitTarget(100, 100, 0.08);
    expect(r.max).toBeGreaterThan(r.min);
  });
});

describe('smoothStep', () => {
  it('converges to the target and reports done, landing exactly on it', () => {
    let cur = { min: 0, max: 100 };
    const target = { min: 50, max: 150 };
    let done = false;
    for (let i = 0; i < 200 && !done; i++) {
      const s = smoothStep(cur, target, 16.7, 100);
      cur = s.next;
      done = s.done;
    }
    expect(done).toBe(true);
    expect(cur.min).toBe(target.min);
    expect(cur.max).toBe(target.max);
  });

  it('never overshoots the target', () => {
    let cur = { min: 0, max: 100 };
    const target = { min: 50, max: 150 };
    for (let i = 0; i < 50; i++) {
      cur = smoothStep(cur, target, 16.7, 100).next;
      expect(cur.min).toBeLessThanOrEqual(target.min + 1e-9);
      expect(cur.max).toBeLessThanOrEqual(target.max + 1e-9);
    }
  });

  it('is frame-rate independent: two 8ms steps ≈ one 16ms step', () => {
    const cur = { min: 0, max: 100 };
    const target = { min: 50, max: 150 };
    const one = smoothStep(cur, target, 16, 100).next;
    const halfA = smoothStep(cur, target, 8, 100).next;
    const two = smoothStep(halfA, target, 8, 100).next;
    expect(two.min).toBeCloseTo(one.min, 6);
    expect(two.max).toBeCloseTo(one.max, 6);
  });

  it('dt<=0 is a no-op (not done)', () => {
    const cur = { min: 0, max: 100 };
    const s = smoothStep(cur, { min: 50, max: 150 }, 0, 100);
    expect(s.next).toEqual(cur);
    expect(s.done).toBe(false);
  });
});

describe('rangesOverlap', () => {
  it('detects overlap, touching, and disjoint', () => {
    expect(rangesOverlap({ min: 0, max: 10 }, { min: 5, max: 15 })).toBe(true);
    expect(rangesOverlap({ min: 0, max: 10 }, { min: 10, max: 20 })).toBe(true);
    expect(rangesOverlap({ min: 0, max: 10 }, { min: 11, max: 20 })).toBe(false);
  });
});

describe('isNearRange (animate vs snap guard)', () => {
  it('animates within the same market neighbourhood', () => {
    expect(isNearRange({ min: 100, max: 110 }, { min: 100, max: 110 })).toBe(true);
    expect(isNearRange({ min: 100, max: 110 }, { min: 104, max: 116 })).toBe(true); // pan drift
    expect(isNearRange({ min: 100, max: 110 }, { min: 120, max: 132 })).toBe(true); // gap < 2× span
  });

  it('snaps an order-of-magnitude jump (BTC → EURUSD)', () => {
    expect(isNearRange({ min: 60_000, max: 70_000 }, { min: 1.05, max: 1.1 })).toBe(false);
  });

  it('snaps a far disjoint range even with a similar span', () => {
    expect(isNearRange({ min: 100, max: 110 }, { min: 200, max: 210 })).toBe(false); // gap 90 > 2×10
  });

  it('snaps span blow-ups past 8×', () => {
    expect(isNearRange({ min: 100, max: 101 }, { min: 60, max: 150 })).toBe(false);
  });

  it('snaps degenerate or non-finite ranges', () => {
    expect(isNearRange({ min: 0, max: 100 }, { min: NaN, max: 100 })).toBe(false);
    expect(isNearRange({ min: 100, max: 100 }, { min: 90, max: 110 })).toBe(false);
    expect(isNearRange({ min: 0, max: 100 }, { min: Infinity, max: 100 })).toBe(false);
  });
});
