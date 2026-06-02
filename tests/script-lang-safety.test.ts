import { describe, it, expect } from 'vitest';
import { runScript, RuntimeError } from '../packages/script-lang/src/interpreter';
import { series } from './_helpers';

describe('PulseScript safety (task 8)', () => {
  it('caps runaway loops with a line-numbered RuntimeError', () => {
    const src = 'persist acc = 0\nfor i = 1 to 100000 {\n  acc = acc + 1\n}\ndraw line(acc, title: "a")';
    let err: unknown;
    try {
      runScript(src, series([1, 2, 3]), { maxLoopSteps: 500 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as Error).message).toMatch(/loop step limit/);
    expect((err as Error).message).toMatch(/line \d+/); // line-numbered
  });

  it('aborts on the wall-clock timeout (line-numbered)', () => {
    // timeoutMs:-1 puts the deadline in the past, so the first per-bar check trips it.
    let err: unknown;
    try {
      runScript('draw line(close, title: "p")', series([1, 2, 3]), { timeoutMs: -1 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as Error).message).toMatch(/timed out/);
    expect((err as Error).message).toMatch(/line \d+/);
  });

  it('rejects an over-sized bar input', () => {
    const big = series(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(() => runScript('draw line(close, title: "p")', big, { maxBars: 5 })).toThrow(/bar safety limit/);
  });

  it('scripts cannot reach host globals / IO (no fetch / window / process)', () => {
    expect(() => runScript('draw line(fetch(close), title: "p")', series([1, 2]))).toThrow(/unknown function 'fetch'/);
    expect(() => runScript('draw line(window, title: "p")', series([1, 2]))).toThrow(/undefined name 'window'/);
    expect(() => runScript('draw line(process, title: "p")', series([1, 2]))).toThrow(/undefined name 'process'/);
  });

  it('clamps a ta period of 0 / negative to a 1-bar window (never an empty/garbage series)', () => {
    const closes = [5, 6, 7, 8];
    const zero = runScript('draw line(ta.sma(close, 0), title: "p")', series(closes));
    expect(zero.plots[0]!.values).toEqual(closes); // sma window 1 == the series itself
    const neg = runScript('draw line(ta.sma(close, 0 - 5), title: "p")', series(closes));
    expect(neg.plots[0]!.values).toEqual(closes);
  });

  it('a normal script still runs well within the default budget', () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 5) * 8);
    const res = runScript('draw line(ema(close, 20), title: "e")\nwhen crossOver(close, ema(close, 20)) {\n  mark buy\n}', series(closes));
    expect(res.plots[0]!.values.length).toBe(300);
    expect(res.marks.length).toBeGreaterThan(0);
  });
});
