import { describe, it, expect } from 'vitest';
import { nakedPOC } from '../packages/indicators/src/profile';
import { k } from './_helpers';

describe('nakedPOC', () => {
  it('finds a prior-session POC and marks it naked when price never returns', () => {
    const c = [
      k(0, 100, 101, 99, 100, 1000), // heavy volume concentrated around 100
      k(3_600_000, 100, 105, 100, 104, 10),
      // next UTC day — trades 110–115, never back to ~100
      k(86_400_000, 112, 115, 110, 113, 50),
    ];
    const levels = nakedPOC(c, { bins: 50 });
    expect(levels.length).toBe(1); // only the completed session 0; the current session is skipped
    const lv = levels[0]!;
    expect(lv.price).toBeGreaterThanOrEqual(99);
    expect(lv.price).toBeLessThanOrEqual(101);
    expect(lv.naked).toBe(true);
    expect(lv.fromIndex).toBe(1); // session 0 ends at index 1
    expect(lv.toIndex).toBe(2); // naked → extends to the last bar
  });

  it('marks a POC filled at the first later bar that trades through it', () => {
    const c = [
      k(0, 100, 101, 99, 100, 1000),
      k(3_600_000, 100, 105, 100, 104, 10),
      k(86_400_000, 102, 103, 98, 99, 50), // next day, range 98–103 straddles ~100 → fills it
      k(86_400_000 + 3_600_000, 99, 101, 98, 100, 50),
    ];
    const levels = nakedPOC(c, { bins: 50 });
    expect(levels.length).toBe(1);
    expect(levels[0]!.naked).toBe(false);
    expect(levels[0]!.toIndex).toBe(2); // touched at index 2
  });

  it('produces nothing when only the current (still-forming) session exists', () => {
    const c = [k(0, 100, 101, 99, 100, 100), k(3_600_000, 100, 102, 99, 101, 100)];
    expect(nakedPOC(c).length).toBe(0);
  });

  it('keeps only the most recent maxLevels', () => {
    const many = Array.from({ length: 6 }, (_, d) =>
      k(d * 86_400_000, 100 + d, 101 + d, 99 + d, 100 + d, 100),
    );
    // 6 sessions → 5 completed; cap at 2.
    expect(nakedPOC(many, { bins: 50, maxLevels: 2 }).length).toBe(2);
  });
});
