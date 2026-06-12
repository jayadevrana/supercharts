import { describe, it, expect } from 'vitest';
import { runScript } from '../packages/script-lang/src/interpreter';
import { series, k } from './_helpers';

/** Output expansion: plot styles, levels, markers, paint bg/candles, alerts, rgb/rgba. */
describe('PulseScript draw kinds & styles', () => {
  it('area/steps/dots kinds + width/style args land on the plot', () => {
    const src = [
      'draw area(close, title: "a", color: "#123456")',
      'draw steps(close, title: "s", width: 3)',
      'draw dots(close, title: "d", style: "dotted")',
      'draw line(close, title: "l", style: "dashed", width: 2)',
      'draw hist(close - open, title: "h")',
    ].join('\n');
    const res = runScript(src, series([1, 2, 3]));
    const byTitle = Object.fromEntries(res.plots.map((p) => [p.title, p]));
    expect(byTitle['a']!.kind).toBe('area');
    expect(byTitle['s']!.kind).toBe('steps');
    expect(byTitle['s']!.width).toBe(3);
    expect(byTitle['d']!.kind).toBe('dots');
    expect(byTitle['d']!.dash).toBe('dotted');
    expect(byTitle['l']!.dash).toBe('dashed');
    expect(byTitle['l']!.width).toBe(2);
    expect(byTitle['h']!.kind).toBe('hist');
  });

  it('a bad style names the allowed values; a bad kind lists the outputs', () => {
    expect(() => runScript('draw line(close, style: "wavy")', series([1]))).toThrowError(/solid.*dashed.*dotted/);
    expect(() => runScript('draw blob(close)', series([1]))).toThrowError(/unknown draw output 'blob'/);
  });
});

describe('PulseScript levels', () => {
  it('level captures y/color/style once per call site (last value wins)', () => {
    const src = 'draw level(70, title: "OB", color: "#ef4444", style: "dotted")\ndraw level(30, title: "OS")';
    const res = runScript(src, series([1, 2, 3]));
    expect(res.levels).toHaveLength(2);
    expect(res.levels[0]).toEqual({ y: 70, title: 'OB', color: '#ef4444', dash: 'dotted' });
    expect(res.levels[1]!.dash).toBe('dashed'); // default
  });

  it('a level driven by a series keeps its LAST value (e.g. final close)', () => {
    const res = runScript('draw level(close, title: "last")', series([10, 20, 30]));
    expect(res.levels[0]!.y).toBe(30);
  });
});

describe('PulseScript markers', () => {
  it('marker fires only when the condition is true; above/below/price placements', () => {
    const src = [
      'draw marker(close > open, shape: "triangleUp", at: "below", color: "#22c55e", text: "up", size: 6)',
      'draw marker(close < open, shape: "arrowDown", at: high + 1)',
    ].join('\n');
    const res = runScript(src, [
      k(0, 10, 12, 9, 11), // up
      k(60_000, 11, 13, 10, 10), // down
      k(120_000, 10, 12, 9, 11), // up
    ]);
    expect(res.shapes).toHaveLength(3);
    const ups = res.shapes.filter((s) => s.shape === 'triangleUp');
    expect(ups.map((s) => s.bar)).toEqual([0, 2]);
    expect(ups[0]).toMatchObject({ place: 'below', color: '#22c55e', text: 'up', size: 6, price: null });
    const dn = res.shapes.find((s) => s.shape === 'arrowDown')!;
    expect(dn.bar).toBe(1);
    expect(dn.price).toBe(14); // high 13 + 1
  });

  it('unknown shapes are rejected with the full list', () => {
    expect(() => runScript('draw marker(true, shape: "star")', series([1]))).toThrowError(/unknown marker shape/);
  });
});

describe('PulseScript paint', () => {
  it('bg and candles capture per-bar colors; none leaves a bar unpainted', () => {
    const src = [
      'paint bg(close > open ? "rgba(34,197,94,0.1)" : none)',
      'paint candles(close < open ? "#94a3b8" : none)',
    ].join('\n');
    const res = runScript(src, [
      k(0, 10, 12, 9, 11), // up
      k(60_000, 11, 13, 10, 10), // down
      k(120_000, 10, 12, 9, 11), // up
    ]);
    expect(res.bgFills[0]).toBe('rgba(34,197,94,0.1)');
    expect(res.bgFills[1] ?? null).toBeNull();
    expect(res.bgFills[2]).toBe('rgba(34,197,94,0.1)');
    expect(res.barTints[1]).toBe('#94a3b8');
    expect(res.barTints[0] ?? null).toBeNull();
  });

  it('paint of a non-bg/candles target errors clearly', () => {
    expect(() => runScript('paint sky("#fff")', series([1]))).toThrowError(/bg\(color\)|candles\(color\)/);
  });
});

describe('PulseScript alerts + color helpers', () => {
  it('alert collects bar + message when its statement runs', () => {
    const src = 'when crossOver(close, ta.sma(close, 2)) {\n  alert("cross at " + text(close, 1))\n}';
    const res = runScript(src, series([10, 8, 12, 13]));
    expect(res.alerts.length).toBeGreaterThan(0);
    expect(res.alerts[0]!.text).toMatch(/^cross at \d/);
  });

  it('rgb()/rgba() build clamped css colors', () => {
    const res = runScript('paint bg(rgba(300, -5, 99, 0.5))\nmark note rgb(1, 2, 3)', series([1]));
    expect(res.bgFills[0]).toBe('rgba(255,0,99,0.5)');
    expect(res.marks[0]!.text).toBe('rgb(1,2,3)');
  });
});
