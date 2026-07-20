import { describe, it, expect } from 'vitest';
import { runScriptScan } from '../apps/api/src/scanner';
import {
  SCREENER_SCRIPTS,
  SCAN_STEPS,
  MATCH_RULES,
  STATUS_ROWS,
  SCREENER_LIMITS,
} from '../apps/web/features/docs/screener-guide';
import { k } from './_helpers';

/**
 * Screener guide (/docs/screener) drift guards. The page renders one source of truth —
 * `screener-guide.ts` — and these tests pin every claim to the REAL scan engine
 * (`runScriptScan`, apps/api/src/scanner.ts):
 *  1. every displayed example script parses + runs clean across a multi-symbol scan;
 *  2. the documented match rule holds behaviorally — a signal on the newest CLOSED bar
 *     matches, a historical-only signal doesn't, and a still-forming bar is trimmed;
 *  3. the documented bar minimum and honest failure statuses are what the engine produces;
 *  4. the per-symbol sandbox actually cuts off a runaway script.
 */

const MIN = 60_000; // 1m bars — k() sets closeTime = openTime + 60_000

/** N varied bars (sine closes, cycling volume) — enough motion for RSI/MACD/donchian/EMA. */
function variedBars(n: number) {
  return Array.from({ length: n }, (_, i) =>
    k(i * MIN, 100 + 10 * Math.sin(i / 5), 100 + 10 * Math.sin(i / 5) + 1, 100 + 10 * Math.sin(i / 5) - 1, 100 + 10 * Math.sin(i / 5), 100 + (i % 7) * 10),
  );
}

/** N flat bars at 100 (high 100.5) — a base that can't break out or cross anything. */
function flatBars(n: number) {
  return Array.from({ length: n }, (_, i) => k(i * MIN, 100, 100.5, 99.5, 100));
}

const afterAll = (bars: ReturnType<typeof k>[]) => bars[bars.length - 1]!.closeTime;

describe('screener guide — every displayed example runs clean through the real scan engine', () => {
  for (const script of SCREENER_SCRIPTS) {
    it(`"${script.title}" scans a 3-symbol universe with zero script errors`, () => {
      const universe = new Map([
        ['AAA', variedBars(120)],
        ['BBB', variedBars(150)],
        ['CCC', flatBars(120)],
      ]);
      const res = runScriptScan(universe, script.code, { interval: '1m', now: 150 * MIN });
      expect(res.total).toBe(3);
      for (const row of res.rows) {
        expect(row.status, `${script.id} on ${row.symbol}: ${row.error ?? ''}`).toBe('ok');
      }
    });
  }
});

describe('screener guide — the documented match rule (newest closed bar, no repaint)', () => {
  const breakout = SCREENER_SCRIPTS.find((s) => s.id === 'fresh-breakout')!.code;

  it('a breakout ON the newest closed bar matches', () => {
    const bars = [...flatBars(80), k(80 * MIN, 100, 105.5, 100, 105)];
    const res = runScriptScan(new Map([['BRK', bars]]), breakout, { interval: '1m', now: afterAll(bars) });
    expect(res.rows[0]!.status).toBe('ok');
    expect(res.rows[0]!.matched).toBe(true);
    expect(res.matchedCount).toBe(1);
  });

  it('a HISTORICAL-only breakout does not match (signals in the past never count)', () => {
    const bars = flatBars(120);
    bars[60] = k(60 * MIN, 100, 105.5, 100, 105); // broke out 60 bars ago, flat since
    const res = runScriptScan(new Map([['OLD', bars]]), breakout, { interval: '1m', now: afterAll(bars) });
    expect(res.rows[0]!.status).toBe('ok');
    expect(res.rows[0]!.matched).toBe(false);
  });

  it('a breakout on the still-FORMING bar is trimmed and does not match', () => {
    const bars = [...flatBars(80), k(80 * MIN, 100, 105.5, 100, 105)];
    // now is mid-bar: the breakout candle's closeTime is in the future → trimmed pre-run.
    const res = runScriptScan(new Map([['FRM', bars]]), breakout, { interval: '1m', now: 80 * MIN + 30_000 });
    expect(res.rows[0]!.status).toBe('ok');
    expect(res.rows[0]!.bars).toBe(80);
    expect(res.rows[0]!.matched).toBe(false);
  });

  it('a bare alert() on the newest closed bar matches too (no chart output required)', () => {
    const surge = SCREENER_SCRIPTS.find((s) => s.id === 'uptrend-volume-surge')!.code;
    // Gentle uptrend (close stays above EMA50) with flat volume, then a 10× volume last bar.
    const bars = Array.from({ length: 100 }, (_, i) => k(i * MIN, 100 + i * 0.2, 100 + i * 0.2 + 0.5, 100 + i * 0.2 - 0.5, 100 + i * 0.2, i === 99 ? 1000 : 100));
    const res = runScriptScan(new Map([['VOL', bars]]), surge, { interval: '1m', now: afterAll(bars) });
    expect(res.rows[0]!.status).toBe('ok');
    expect(res.rows[0]!.matched).toBe(true);
  });
});

describe('screener guide — documented limits and honest statuses are real', () => {
  const rsi = SCREENER_SCRIPTS.find((s) => s.id === 'rsi-snap-back')!.code;

  it(`${SCREENER_LIMITS.minBars - 1} closed bars → insufficient_data; ${SCREENER_LIMITS.minBars} → evaluated`, () => {
    const short = flatBars(SCREENER_LIMITS.minBars - 1);
    const enough = flatBars(SCREENER_LIMITS.minBars);
    const res = runScriptScan(new Map([['SHORT', short], ['ENOUGH', enough]]), rsi, {
      interval: '1m',
      now: afterAll(enough),
    });
    const byId = Object.fromEntries(res.rows.map((r) => [r.symbol, r]));
    expect(byId.SHORT!.status).toBe('insufficient_data');
    expect(byId.ENOUGH!.status).toBe('ok');
  });

  it('a symbol with no candles reports unavailable, never fabricated', () => {
    const res = runScriptScan(new Map([['EMPTY', []]]), rsi, { interval: '1m', now: 100 * MIN });
    expect(res.rows[0]!.status).toBe('unavailable');
    expect(res.rows[0]!.matched).toBe(false);
  });

  it('a runtime error is isolated to its symbol — the rest of the scan still runs', () => {
    // The bad branch only executes where close > 1000, so only HIGH trips the unknown ident.
    const probe = `pulse 1
meta(name: "Err Probe", overlay: true)
when close > 1000 { x = mysteryValue }
`;
    const low = flatBars(80);
    const high = Array.from({ length: 80 }, (_, i) => k(i * MIN, 2000, 2001, 1999, 2000));
    const res = runScriptScan(new Map([['LOW', low], ['HIGH', high]]), probe, { interval: '1m', now: afterAll(low) });
    const byId = Object.fromEntries(res.rows.map((r) => [r.symbol, r]));
    expect(byId.LOW!.status).toBe('ok');
    expect(byId.HIGH!.status).toBe('script_error');
    expect(byId.HIGH!.error).toBeTruthy();
    expect(byId.HIGH!.matched).toBe(false);
  });

  it('the per-symbol sandbox aborts a runaway script instead of hanging the scan', () => {
    const runaway = `pulse 1
meta(name: "Runaway", overlay: true)
i = 0
while i < 100000000 { i = i + 1 }
`;
    const started = Date.now();
    const res = runScriptScan(new Map([['SPIN', flatBars(80)]]), runaway, { interval: '1m', now: 80 * MIN });
    expect(res.rows[0]!.status).toBe('script_error');
    expect(res.rows[0]!.error).toBeTruthy();
    expect(Date.now() - started).toBeLessThan(5000); // the default budget cut it off
  });
});

describe('screener guide — content completeness (the page can render every section)', () => {
  it('ships ≥4 runnable examples, each a versioned named script', () => {
    expect(SCREENER_SCRIPTS.length).toBeGreaterThanOrEqual(4);
    for (const s of SCREENER_SCRIPTS) {
      expect(s.code.startsWith('pulse 1'), `${s.id} missing version header`).toBe(true);
      expect(s.code).toContain('meta(name:');
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(0);
    }
  });

  it('documents the full ScanRowStatus union, ≥4 steps, and ≥3 match rules', () => {
    expect(STATUS_ROWS.map((r) => r.status).sort()).toEqual(
      ['insufficient_data', 'ok', 'script_error', 'unavailable'],
    );
    expect(SCAN_STEPS.length).toBeGreaterThanOrEqual(4);
    expect(MATCH_RULES.length).toBeGreaterThanOrEqual(3);
  });
});
