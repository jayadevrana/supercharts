import { describe, it, expect } from 'vitest';
import {
  formatPrice,
  groupThousands,
  formatFullTime,
  barCloseCountdown,
} from '../packages/chart-core/src/layers/axis';
import { priceTickTarget, niceTicks, chooseTimeStep } from '../packages/chart-core/src/layers/grid';

describe('groupThousands / formatPrice', () => {
  it('groups the integer part with commas', () => {
    expect(groupThousands('63796.48')).toBe('63,796.48');
    expect(groupThousands('1234567.00')).toBe('1,234,567.00');
    expect(groupThousands('-63796.48')).toBe('-63,796.48');
    expect(groupThousands('999.99')).toBe('999.99');
  });

  it('formatPrice applies separators only at >= 1000', () => {
    expect(formatPrice(63796.48)).toBe('63,796.48');
    expect(formatPrice(999.5)).toBe('999.5000');
    expect(formatPrice(0.02345)).toBe('0.02345');
    expect(formatPrice(NaN)).toBe('-');
  });

  it('keeps sub-fraction precision for micro-priced assets', () => {
    expect(formatPrice(0.00001234)).toBe('0.00001234');
  });
});

describe('formatFullTime', () => {
  // 2026-06-12 is a Friday; 10:30:45 UTC.
  const t = Date.UTC(2026, 5, 12, 10, 30, 45);

  it("renders the TV-style 'Fri 12 Jun '26 10:30' form", () => {
    expect(formatFullTime(t)).toBe("Fri 12 Jun '26 10:30");
  });

  it('appends seconds for sub-minute bars', () => {
    expect(formatFullTime(t, { includeSeconds: true })).toBe("Fri 12 Jun '26 10:30:45");
  });

  it('drops the clock for daily+ bars', () => {
    expect(formatFullTime(t, { includeTime: false })).toBe("Fri 12 Jun '26");
  });
});

describe('barCloseCountdown', () => {
  const now = Date.UTC(2026, 5, 12, 10, 30, 0);

  it('renders mm:ss within the hour', () => {
    expect(barCloseCountdown(now + 2 * 60_000 + 12_000, now)).toBe('02:12');
    expect(barCloseCountdown(now + 5_000, now)).toBe('00:05');
  });

  it('renders h:mm:ss for long bars', () => {
    expect(barCloseCountdown(now + 3 * 3600_000 + 60_000, now)).toBe('3:01:00');
  });

  it('is empty once the bar has closed (no frozen countdown on historical data)', () => {
    expect(barCloseCountdown(now - 1, now)).toBe('');
    expect(barCloseCountdown(now, now)).toBe('');
  });
});

describe('tick density', () => {
  it('priceTickTarget tracks pane height with clamps', () => {
    expect(priceTickTarget(835)).toBe(15);
    expect(priceTickTarget(200)).toBe(6); // floor
    expect(priceTickTarget(2000)).toBe(16); // ceiling
  });

  it('niceTicks honors a denser target', () => {
    // Targets quantize to the 1-2-5 ladder, so compare across a ladder boundary.
    const sparse = niceTicks(61500, 64000, 6); // step 500
    const dense = niceTicks(61500, 64000, 15); // step 200
    expect(dense.length).toBeGreaterThan(sparse.length);
  });

  it('chooseTimeStep returns a denser grid on wide panes', () => {
    const span = 6 * 3600_000; // 6h visible
    expect(chooseTimeStep(span, 1259)).toBeLessThanOrEqual(chooseTimeStep(span, 600));
  });
});
