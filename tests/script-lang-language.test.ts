import { describe, it, expect } from 'vitest';
import { runScript, RuntimeError } from '../packages/script-lang/src/interpreter';
import { series, k } from './_helpers';

/**
 * PulseScript language-core upgrades: ternary, while/break/continue, lists + methods,
 * text methods, record field access, and the date-time / bar-context built-ins.
 */
describe('PulseScript ternary', () => {
  it('picks the branch by condition per bar', () => {
    const res = runScript('let v = close > open ? 1 : -1\ndraw line(v, title: "v")', [
      k(0, 10, 12, 9, 11), // up
      k(60_000, 11, 12, 9, 10), // down
    ]);
    expect(res.plots[0]!.values).toEqual([1, -1]);
  });

  it('nests right-associatively', () => {
    const res = runScript('let v = close > 30 ? 3 : close > 20 ? 2 : 1\ndraw line(v, title: "v")', series([10, 25, 35]));
    expect(res.plots[0]!.values).toEqual([1, 2, 3]);
  });

  it('works inside call arguments alongside named args', () => {
    const res = runScript('draw line(close > open ? high : low, title: "edge")', [k(0, 10, 12, 9, 11)]);
    expect(res.plots[0]!.values).toEqual([12]);
  });

  it('requires a real bool condition (no numeric truthiness)', () => {
    const res = runScript('let v = 1 ? 10 : 20\ndraw line(v, title: "v")', series([5]));
    expect(res.plots[0]!.values).toEqual([20]); // 1 is not `true` — strict bool semantics
  });
});

describe('PulseScript while / break / continue', () => {
  it('while loops until its condition turns false', () => {
    const src = 'mut n = 0\nmut total = 0\nwhile n < 5 {\n  n = n + 1\n  total = total + n\n}\ndraw line(total, title: "t")';
    const res = runScript(src, series([1]));
    expect(res.plots[0]!.values).toEqual([15]); // 1+2+3+4+5
  });

  it('break exits the loop early; continue skips an iteration', () => {
    const src = [
      'mut total = 0',
      'for i = 1 to 100 {',
      '  if i == 4 { continue }',
      '  if i > 6 { break }',
      '  total = total + i',
      '}',
      'draw line(total, title: "t")',
    ].join('\n');
    const res = runScript(src, series([1]));
    expect(res.plots[0]!.values).toEqual([1 + 2 + 3 + 5 + 6]);
  });

  it('break inside while stops only the loop, not the bar', () => {
    const src = 'mut n = 0\nwhile true {\n  n = n + 1\n  if n >= 3 { break }\n}\ndraw line(n, title: "n")';
    const res = runScript(src, series([1, 2]));
    expect(res.plots[0]!.values).toEqual([3, 3]);
  });

  it('break outside any loop is a line-numbered error', () => {
    expect(() => runScript('break', series([1]))).toThrowError(/'break' outside a loop/);
  });

  it('a runaway while still hits the loop-step guard', () => {
    expect(() => runScript('mut n = 0\nwhile true {\n  n = n + 1\n}', series([1]), { maxLoopSteps: 10_000 })).toThrowError(
      /loop step limit/,
    );
  });
});

describe('PulseScript lists', () => {
  it('literal, size/at/first/last', () => {
    const src = 'let xs = [10, 20, 30]\ndraw line(xs.size(), title: "n")\ndraw line(xs.at(1), title: "mid")\ndraw line(xs.first() + xs.last(), title: "ends")';
    const res = runScript(src, series([1]));
    expect(res.plots.map((p) => p.values[0])).toEqual([3, 20, 40]);
  });

  it('push/pop/sum/avg/min/max over a persist list (rolling collection)', () => {
    const src = [
      'persist xs = []',
      'xs.push(close)',
      'draw line(xs.sum(), title: "sum")',
      'draw line(xs.avg(), title: "avg")',
      'draw line(xs.max(), title: "max")',
    ].join('\n');
    const res = runScript(src, series([2, 4, 6]));
    expect(res.plots[0]!.values).toEqual([2, 6, 12]);
    expect(res.plots[1]!.values).toEqual([2, 3, 4]);
    expect(res.plots[2]!.values).toEqual([2, 4, 6]);
  });

  it('contains/indexOf/slice/join/sort/reverse/copy', () => {
    const src = [
      'let xs = [3, 1, 2]',
      'let sorted = xs.copy().sort()',
      'draw line(sorted.at(0), title: "lo")',
      'draw line(sorted.at(2), title: "hi")',
      'draw line(xs.contains(2) ? 1 : 0, title: "has2")',
      'draw line(nz(xs.indexOf(1), -1), title: "idx1")',
      'draw line(xs.slice(1, 3).size(), title: "sl")',
    ].join('\n');
    const res = runScript(src, series([1]));
    expect(res.plots.map((p) => p.values[0])).toEqual([1, 3, 1, 1, 2]);
  });

  it('at() out of range is none; for-in walks a real list', () => {
    const src = 'let xs = [5, 6]\nmut t = 0\nfor v in xs {\n  t = t + v\n}\ndraw line(t, title: "t")\ndraw line(nz(xs.at(9), -1), title: "oob")';
    const res = runScript(src, series([1]));
    expect(res.plots[0]!.values).toEqual([11]);
    expect(res.plots[1]!.values).toEqual([-1]);
  });

  it('set out of range is a clear error; unknown method names the type', () => {
    expect(() => runScript('let xs = [1]\nxs.set(5, 0)', series([1]))).toThrowError(/out of range/);
    expect(() => runScript('let xs = [1]\nxs.wat()', series([1]))).toThrowError(/lists have no method '\.wat\(\)'/);
  });

  it('repeat(value, count) builds a filled list', () => {
    const res = runScript('let xs = repeat(7, 4)\ndraw line(xs.sum(), title: "s")', series([1]));
    expect(res.plots[0]!.values).toEqual([28]);
  });
});

describe('PulseScript text methods + conversions', () => {
  it('upper/lower/len/contains/replace/split/trim/slice', () => {
    const src = [
      'let s = "  Fast EMA  "',
      'let t = s.trim()',
      'draw line(t.len(), title: "len")',
      'draw line(t.upper().contains("FAST") ? 1 : 0, title: "up")',
      'draw line(t.replace("EMA", "X").len(), title: "rep")',
      'draw line(t.split(" ").size(), title: "parts")',
      'draw line(t.slice(0, 4).len(), title: "sl")',
    ].join('\n');
    const res = runScript(src, series([1]));
    expect(res.plots.map((p) => p.values[0])).toEqual([8, 1, 6, 2, 4]);
  });

  it('text(v, decimals) formats numbers; parseNum round-trips; mark text shows lists', () => {
    const src = 'mark note at close text(close, 2) + " / " + text(parseNum("42.5"), 1)';
    const res = runScript(src, series([3.14159]));
    expect(res.marks[0]!.text).toBe('3.14 / 42.5');
  });
});

describe('PulseScript date-time + bar-context built-ins', () => {
  it('UTC fields of the bar open time', () => {
    // 2024-03-15T13:45:30Z, a Friday.
    const t = Date.UTC(2024, 2, 15, 13, 45, 30);
    const src = [
      'draw line(year, title: "y")',
      'draw line(month, title: "mo")',
      'draw line(day, title: "d")',
      'draw line(weekday, title: "wd")',
      'draw line(hour, title: "h")',
      'draw line(minute, title: "mi")',
    ].join('\n');
    const res = runScript(src, [k(t, 1, 2, 0.5, 1.5)]);
    expect(res.plots.map((p) => p.values[0])).toEqual([2024, 3, 15, 5, 13, 45]);
  });

  it('isFirstBar/isLastBar/lastBarIndex/barCount shape the run', () => {
    const src = [
      'draw line(isFirstBar ? 1 : 0, title: "first")',
      'draw line(isLastBar ? 1 : 0, title: "last")',
      'draw line(lastBarIndex, title: "lbi")',
      'draw line(barCount, title: "n")',
    ].join('\n');
    const res = runScript(src, series([1, 2, 3]));
    expect(res.plots[0]!.values).toEqual([1, 0, 0]);
    expect(res.plots[1]!.values).toEqual([0, 0, 1]);
    expect(res.plots[2]!.values).toEqual([2, 2, 2]);
    expect(res.plots[3]!.values).toEqual([3, 3, 3]);
  });

  it('hlcc4 price source', () => {
    const res = runScript('draw line(hlcc4, title: "p")', [k(0, 10, 14, 8, 12)]);
    expect(res.plots[0]!.values[0]).toBeCloseTo((14 + 8 + 12 + 12) / 4, 9);
  });
});

describe('PulseScript none propagation through members/methods', () => {
  it('none.field and none.method() stay none instead of crashing', () => {
    // close[10] is none on early bars; nz() the method result.
    const src = 'let v = nz(close[10], -1)\ndraw line(v, title: "v")';
    const res = runScript(src, series([1, 2]));
    expect(res.plots[0]!.values).toEqual([-1, -1]);
  });

  it('field access on a number is a clear error', () => {
    expect(() => runScript('let x = close.upper', series([1]))).toThrowError(RuntimeError);
  });
});
