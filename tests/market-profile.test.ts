import { describe, it, expect } from 'vitest';
import { buildMarketProfiles } from '../packages/chart-core/src/market-profile';
import { k } from './_helpers';

// Session day 0: three bars packed around 100, then two bars drifting up to ~108.
const day0 = [
  k(0, 100, 100.5, 99.5, 100, 100),
  k(60_000, 100, 100.5, 99.5, 100, 100),
  k(120_000, 100, 100.5, 99.5, 100, 100),
  k(180_000, 100, 105, 100, 104, 100),
  k(240_000, 104, 108, 103, 107, 100),
];

describe('buildMarketProfiles', () => {
  it('puts the POC where the most bars overlapped', () => {
    const [p] = buildMarketProfiles(day0);
    expect(p).toBeTruthy();
    expect(p!.poc).toBeGreaterThanOrEqual(99.5);
    expect(p!.poc).toBeLessThanOrEqual(101);
    expect(p!.maxCount).toBe(4); // the 99.5–100.5 band is touched by 4 of the 5 bars
    expect(p!.rows.length).toBeGreaterThan(0);
  });

  it('keeps the value area ordered and inside the session range', () => {
    const [p] = buildMarketProfiles(day0);
    expect(p!.vah).toBeGreaterThanOrEqual(p!.poc);
    expect(p!.val).toBeLessThanOrEqual(p!.poc);
    expect(p!.val).toBeGreaterThanOrEqual(99.5 - p!.rowSize);
    expect(p!.vah).toBeLessThanOrEqual(108 + p!.rowSize);
  });

  it('produces one profile per UTC session', () => {
    const two = [...day0, k(86_400_000, 200, 201, 199, 200, 100)];
    expect(buildMarketProfiles(two).length).toBe(2);
  });

  it('skips a flat (zero-range) session', () => {
    const flat = [k(0, 100, 100, 100, 100, 100), k(60_000, 100, 100, 100, 100, 100)];
    expect(buildMarketProfiles(flat).length).toBe(0);
  });
});
