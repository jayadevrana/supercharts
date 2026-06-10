import { describe, it, expect } from 'vitest';
import { optimizeScript, SCRIPT_SWEEP_MAX_COMBOS } from '../apps/api/src/script-optimizer';
import type { Candle } from '@supercharts/types';

/**
 * Script input optimizer — sweeps a PulseScript's own input.num parameters, re-running
 * the script per combination and backtesting its marks. Determinism + caps + honest
 * ranking are the contract; the heavy lifting (runScript, runSignalBacktest, metric
 * helpers) is covered by its own suites.
 */

const candles: Candle[] = Array.from({ length: 400 }, (_, i) => {
  const p = 100 + Math.sin(i / 11) * 7 + i * 0.015;
  return { openTime: i * 3_600_000, closeTime: i * 3_600_000 + 1, open: p, high: p + 1, low: p - 1, close: p, volume: 10 } as Candle;
});

const SRC = `
let fastLen = input.num(7, "Fast", min: 2)
let slowLen = input.num(19, "Slow", min: 3)
let fast = ema(close, fastLen)
let slow = ema(close, slowLen)
when crossOver(fast, slow) { mark buy "L" }
when crossUnder(fast, slow) { mark sell "S" }
`;

describe('optimizeScript', () => {
  it('sweeps the grid, ranks by objective, attaches metrics + ranks 1..n', () => {
    const r = optimizeScript(
      candles,
      SRC,
      {},
      { fastLen: { from: 4, step: 2, to: 10 }, slowLen: { from: 15, step: 4, to: 27 } },
      '1h',
      { objective: 'profit', minWinRate: 0 },
    );
    expect(r.planned).toBe(4 * 4);
    expect(r.evaluated).toBe(16);
    expect(r.truncated).toBe(false);
    expect(r.scriptErrors).toBe(0);
    const rows = r.combos.length > 0 ? r.combos : r.fallbackCombos!;
    expect(rows.length).toBeGreaterThan(0);
    // profit objective ⇒ descending return; ranks sequential
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.summary.totalReturnPct).toBeLessThanOrEqual(rows[i - 1]!.summary.totalReturnPct);
    }
    rows.forEach((c, i) => expect(c.metrics!.rank).toBe(i + 1));
    // swept values stay inside their ranges
    for (const c of rows) {
      expect(c.inputs.fastLen).toBeGreaterThanOrEqual(4);
      expect(c.inputs.fastLen).toBeLessThanOrEqual(10);
      expect(c.inputs.slowLen).toBeGreaterThanOrEqual(15);
      expect(c.inputs.slowLen).toBeLessThanOrEqual(27);
    }
  });

  it('is deterministic — identical requests produce identical results', () => {
    const req = {
      ranges: { fastLen: { from: 4, step: 2, to: 10 }, slowLen: { from: 15, step: 6, to: 27 } },
    };
    const a = optimizeScript(candles, SRC, {}, req.ranges, '1h', { objective: 'balanced' });
    const b = optimizeScript(candles, SRC, {}, req.ranges, '1h', { objective: 'balanced' });
    expect(a).toEqual(b);
  });

  it('rejects an oversized grid with a clear error', () => {
    expect(() =>
      optimizeScript(candles, SRC, {}, { fastLen: { from: 2, step: 1, to: 60 }, slowLen: { from: 3, step: 1, to: 60 } }, '1h'),
    ).toThrow(new RegExp(`${SCRIPT_SWEEP_MAX_COMBOS} cap`));
  });

  it('rejects empty/invalid ranges', () => {
    expect(() => optimizeScript(candles, SRC, {}, { fastLen: { from: 10, step: 1, to: 4 } }, '1h')).toThrow(/valid from\/step\/to/);
    expect(() => optimizeScript(candles, SRC, {}, {}, '1h')).toThrow(/valid from\/step\/to/);
  });

  it('honours the time budget and reports truncation honestly', () => {
    const r = optimizeScript(
      candles,
      SRC,
      {},
      { fastLen: { from: 2, step: 1, to: 21 }, slowLen: { from: 5, step: 1, to: 34 } }, // 600 combos
      '1h',
      { objective: 'profit', timeBudgetMs: 1_000 },
    );
    expect(r.planned).toBe(600);
    expect(r.evaluated).toBeLessThan(600);
    expect(r.truncated).toBe(true);
    expect(r.note).toMatch(/Time budget hit/);
  });

  it('base inputs are merged but swept values win', () => {
    // Fix slowLen via baseInputs; sweep only fastLen — every combo keys on fastLen only.
    const r = optimizeScript(
      candles,
      SRC,
      { slowLen: 25 },
      { fastLen: { from: 4, step: 3, to: 13 } },
      '1h',
      { objective: 'profit' },
    );
    expect(r.planned).toBe(4);
    const rows = r.combos.length > 0 ? r.combos : r.fallbackCombos!;
    for (const c of rows) {
      expect(Object.keys(c.inputs)).toEqual(['fastLen']);
    }
  });
});
