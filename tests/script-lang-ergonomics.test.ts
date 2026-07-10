import { describe, expect, it } from 'vitest';
import { parse } from '../packages/script-lang/src/parser';
import { runScript, RuntimeError } from '../packages/script-lang/src/interpreter';
import { series } from './_helpers';

const CLOSES = [10, 11, 12, 13, 14, 15];

describe('pulse version header', () => {
  it('accepts `pulse 1` as the first line and records the version', () => {
    const prog = parse('pulse 1\nlet x = close\ndraw line(x, title: "x")');
    expect(prog.version).toBe(1);
  });

  it('a script without the header still parses (version null)', () => {
    expect(parse('let x = close').version).toBeNull();
  });

  it('rejects an unknown version with a clear error', () => {
    expect(() => runScript('pulse 7\ndraw line(close, title: "c")', series(CLOSES))).toThrow(/pulse 1/);
  });
});

describe('colon single-line bodies (low-indent form)', () => {
  it('when cond: mark — no braces needed', () => {
    const res = runScript('pulse 1\nwhen close > 12: mark buy at low "go"', series(CLOSES));
    expect(res.marks.length).toBe(3); // closes 13,14,15
    expect(res.marks[0]!.kind).toBe('buy');
  });

  it('if/else colon form', () => {
    const src = 'pulse 1\nmut v = 0\nif close > 12: v = 1\nelse: v = 2\ndraw line(v, title: "v")';
    const res = runScript(src, series(CLOSES));
    expect(res.plots[0]!.values).toEqual([2, 2, 2, 1, 1, 1]);
  });

  it('brace blocks still work unchanged', () => {
    const res = runScript('when close > 12 {\n  mark sell at high "s"\n}', series(CLOSES));
    expect(res.marks.length).toBe(3);
  });
});

describe('bare assignment declares (no let needed)', () => {
  it('x = expr declares a per-bar series like mut', () => {
    const res = runScript('pulse 1\nfast = (close + close) / 2\ndraw line(fast, title: "f")', series(CLOSES));
    expect(res.plots[0]!.values).toEqual(CLOSES);
  });

  it('let stays immutable — reassigning a let still errors', () => {
    expect(() => runScript('let a = 1\na = 2', series(CLOSES))).toThrow(RuntimeError);
  });

  it('assigning to a built-in name errors with guidance', () => {
    expect(() => runScript('close = 5', series(CLOSES))).toThrow(/built-in/);
    expect(() => runScript('ema = 5', series(CLOSES))).toThrow(/built-in/);
  });

  it('implicit declaration works inside fn bodies (function-local)', () => {
    const src = 'pulse 1\nfn double(x) {\n  y = x * 2\n  y\n}\ndraw line(double(close), title: "d")';
    const res = runScript(src, series(CLOSES));
    expect(res.plots[0]!.values).toEqual(CLOSES.map((c) => c * 2));
  });
});
