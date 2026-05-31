import { describe, it, expect } from 'vitest';
import { createDrawdownBreaker } from '../apps/api/src/dd-breaker';

describe('createDrawdownBreaker', () => {
  it('trips at the limit exactly once, holds on manual resume, re-arms next UTC day', () => {
    let pnl = -1;
    let t = 100 * 86_400_000 + 3_600_000; // day 100, 1h in
    const trips: number[] = [];
    const b = createDrawdownBreaker({
      computeDailyPnlPct: () => pnl,
      limitPct: 3,
      now: () => t,
      onTrip: (s) => trips.push(s.dailyPnlPct),
    });

    expect(b.check().halted).toBe(false); // -1% > -3%
    pnl = -4;
    expect(b.check().halted).toBe(true); // breach
    expect(trips.length).toBe(1);
    pnl = -6;
    b.check();
    expect(trips.length).toBe(1); // no double-trip while already halted

    b.resume();
    expect(b.check().halted).toBe(false); // manual resume holds for the rest of the day
    t += 86_400_000; // next UTC day
    expect(b.check().halted).toBe(true); // re-arms
    expect(trips.length).toBe(2);
  });

  it('never halts when disabled', () => {
    const b = createDrawdownBreaker({ computeDailyPnlPct: () => -50, limitPct: 3, enabled: false, now: () => 0 });
    expect(b.check().halted).toBe(false);
    expect(b.isHalted()).toBe(false);
  });

  it('configure updates the limit and re-evaluates', () => {
    const b = createDrawdownBreaker({ computeDailyPnlPct: () => -4, limitPct: 10, now: () => 0 });
    expect(b.check().halted).toBe(false); // -4% > -10%
    const s = b.configure({ limitPct: 3 });
    expect(s.limitPct).toBe(3);
    expect(s.halted).toBe(true); // now breached
  });
});
