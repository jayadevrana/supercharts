import { describe, it, expect } from 'vitest';
import { collectIndicatorRefs, evaluateCondition, inSession, inTimeWindow } from '../apps/api/src/signal-eval';
import type { Candle, SignalCondition } from '@supercharts/types';

/**
 * The shared condition evaluator now backs BOTH the MT5 recipe runner and the M5
 * indicator-alert path. These lock the per-condition semantics (so an alert and a recipe
 * agree). `evaluateCondition` takes a pre-built channel map, so no indicator math is needed here.
 */

const bar = (close: number): Candle =>
  ({ openTime: 0, closeTime: 0, open: close, high: close + 1, low: close - 1, close, volume: 1 } as Candle);

describe('collectIndicatorRefs', () => {
  it('gathers indicator + plot-vs-plot + price-cross targets', () => {
    const conds: SignalCondition[] = [
      { type: 'indicator_compare', indicator: 'rsi1', channel: 'value', operator: '<', right: { kind: 'constant', value: 30 } },
      { type: 'indicator_compare', indicator: 'macd1', channel: 'macd', operator: 'crosses_above', right: { kind: 'indicator', indicator: 'macd1', channel: 'signal' } },
      { type: 'price_crosses', source: 'close', operator: 'crosses_above', target: { kind: 'indicator', indicator: 'ema1', channel: 'value' } },
    ];
    expect(collectIndicatorRefs(conds)).toEqual([
      { id: 'rsi1', channel: 'value' },
      { id: 'macd1', channel: 'macd' },
      { id: 'macd1', channel: 'signal' },
      { id: 'ema1', channel: 'value' },
    ]);
  });
});

describe('evaluateCondition (pre-built channels)', () => {
  const bars = [bar(10), bar(20)];
  const ind = new Map<string, number[]>([['rsi1.value', [50, 25]]]);

  it('indicator_compare < constant', () => {
    const c: SignalCondition = { type: 'indicator_compare', indicator: 'rsi1', channel: 'value', operator: '<', right: { kind: 'constant', value: 30 } };
    expect(evaluateCondition(c, bars, ind, 1, 0)).toBe(true);
  });
  it('indicator_compare crosses_below constant (prev≥level, cur<level)', () => {
    const c: SignalCondition = { type: 'indicator_compare', indicator: 'rsi1', channel: 'value', operator: 'crosses_below', right: { kind: 'constant', value: 30 } };
    expect(evaluateCondition(c, bars, ind, 1, 0)).toBe(true);
  });
  it('does not fire when the level was already below on the prior bar', () => {
    const ind2 = new Map<string, number[]>([['rsi1.value', [25, 20]]]);
    const c: SignalCondition = { type: 'indicator_compare', indicator: 'rsi1', channel: 'value', operator: 'crosses_below', right: { kind: 'constant', value: 30 } };
    expect(evaluateCondition(c, bars, ind2, 1, 0)).toBe(false);
  });
  it('price crosses_above a constant level', () => {
    const c: SignalCondition = { type: 'price_crosses', source: 'close', operator: 'crosses_above', target: { kind: 'constant', value: 15 } };
    expect(evaluateCondition(c, bars, ind, 1, 0)).toBe(true);
  });
  it('returns false on a missing channel rather than throwing', () => {
    const c: SignalCondition = { type: 'indicator_compare', indicator: 'nope', channel: 'value', operator: '<', right: { kind: 'constant', value: 30 } };
    expect(evaluateCondition(c, bars, ind, 1, 0)).toBe(false);
  });
});

describe('session / time-window helpers', () => {
  it('classifies the London session', () => {
    const tenUtc = Date.UTC(2024, 0, 1, 10, 0, 0);
    expect(inSession('london', tenUtc)).toBe(true);
    expect(inSession('tokyo', tenUtc)).toBe(false);
  });
  it('respects day-of-week + HH:MM window', () => {
    const monday10 = Date.UTC(2024, 0, 1, 10, 30, 0); // 2024-01-01 is a Monday
    expect(inTimeWindow('09:00:00', '17:00:00', [1], monday10)).toBe(true);
    expect(inTimeWindow('09:00:00', '17:00:00', [2], monday10)).toBe(false);
  });
});
