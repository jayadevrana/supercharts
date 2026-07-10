import { describe, expect, it } from 'vitest';
import { runScriptScan } from '../apps/api/src/scanner';
import { series } from './_helpers';
import type { Candle } from '@supercharts/types';

const NOW = 200 * 60_000 + 1;
const RISING = series(Array.from({ length: 120 }, (_, i) => 100 + i)) as unknown as Candle[];
const FALLING = series(Array.from({ length: 120 }, (_, i) => 300 - i)) as unknown as Candle[];

describe('runScriptScan', () => {
  it('matches symbols where the script marks on the LAST closed bar', () => {
    // Marks every bar where close > close[1] — rising matches on the final bar, falling never.
    const src = 'pulse 1\nwhen close > close[1]: mark buy at low "up"';
    const res = runScriptScan(new Map([['UP', RISING], ['DOWN', FALLING]]), src, { interval: '1m', now: NOW });
    const by = Object.fromEntries(res.rows.map((r) => [r.symbol, r]));
    expect(by.UP!.matched).toBe(true);
    expect(by.DOWN!.matched).toBe(false);
    expect(by.UP!.status).toBe('ok');
    expect(res.matchedCount).toBe(1);
  });

  it('a mark on an EARLIER bar only does not match (last-closed-bar semantics)', () => {
    // Rise for 100 bars then fall for 19 — buy marks exist historically, none on the last bar.
    const closes = [...Array.from({ length: 100 }, (_, i) => 100 + i), ...Array.from({ length: 19 }, (_, i) => 198 - i)];
    const bars = series(closes) as unknown as Candle[];
    const src = 'pulse 1\nwhen close > close[1]: mark buy at low "up"';
    const res = runScriptScan(new Map([['S', bars]]), src, { interval: '1m', now: NOW });
    expect(res.rows[0]!.matched).toBe(false);
  });

  it('alert() on the last closed bar also counts as a match', () => {
    const src = 'pulse 1\nwhen close > close[1]: alert("fired")';
    const res = runScriptScan(new Map([['UP', RISING]]), src, { interval: '1m', now: NOW });
    expect(res.rows[0]!.matched).toBe(true);
  });

  it('per-symbol runtime errors are isolated and reported honestly', () => {
    // volume is 100 in fixtures; force a runtime error only where close > 250 exists (FALLING head).
    const src = 'pulse 1\nwhen close > 250: x = badFn(1)\nwhen close > close[1]: mark buy "up"';
    const res = runScriptScan(new Map([['UP', RISING], ['BAD', FALLING]]), src, { interval: '1m', now: NOW });
    const by = Object.fromEntries(res.rows.map((r) => [r.symbol, r]));
    expect(by.UP!.matched).toBe(true); // unaffected by BAD's failure
    expect(by.BAD!.status).toBe('script_error');
    expect(by.BAD!.error).toMatch(/badFn|unknown/i);
    expect(by.BAD!.matched).toBe(false);
  });

  it('a script that fails to PARSE fails the whole scan loudly (bad input, not per-symbol)', () => {
    expect(() => runScriptScan(new Map([['S', RISING]]), 'when {', { interval: '1m', now: NOW })).toThrow();
  });

  it('short/empty histories keep their honest statuses', () => {
    const res = runScriptScan(new Map([['EMPTY', [] as unknown as Candle[]], ['S', RISING]]), 'pulse 1\nmark note "x"', {
      interval: '1m',
      now: NOW,
    });
    const by = Object.fromEntries(res.rows.map((r) => [r.symbol, r.status]));
    expect(by.EMPTY).toBe('unavailable');
    expect(by.S).toBe('ok');
  });
});
