import { describe, it, expect } from 'vitest';
import { nextIndicatorName, reorderInstances } from '../apps/web/features/terminal/indicator-manager-util';
import type { IndicatorInstance } from '@supercharts/types';
import type { IndicatorSpec } from '@supercharts/indicators';

const spec = (type: string, label: string) => ({ type, label } as unknown as IndicatorSpec);
const inst = (id: string, type: string): IndicatorInstance =>
  ({ id, type, name: type, paneId: 'price', inputs: {}, style: {}, visible: true, locked: false });

describe('nextIndicatorName', () => {
  const ema = spec('ema', 'Exponential Moving Average');
  it('is the plain label for the first of its type', () => {
    expect(nextIndicatorName([], ema)).toBe('Exponential Moving Average');
    expect(nextIndicatorName([inst('r', 'rsi')], ema)).toBe('Exponential Moving Average');
  });
  it('numbers repeats from 2', () => {
    expect(nextIndicatorName([inst('e1', 'ema')], ema)).toBe('Exponential Moving Average 2');
    expect(nextIndicatorName([inst('e1', 'ema'), inst('e2', 'ema')], ema)).toBe('Exponential Moving Average 3');
  });
});

describe('reorderInstances', () => {
  const list = [inst('a', 'ema'), inst('b', 'rsi'), inst('c', 'macd')];
  it('moves an item up and down by one slot', () => {
    expect(reorderInstances(list, 'b', 'up').map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(reorderInstances(list, 'b', 'down').map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });
  it('is a no-op at the edges or for an unknown id', () => {
    expect(reorderInstances(list, 'a', 'up')).toBe(list);
    expect(reorderInstances(list, 'c', 'down')).toBe(list);
    expect(reorderInstances(list, 'zzz', 'up')).toBe(list);
  });
  it('does not mutate the input', () => {
    const copy = [...list];
    reorderInstances(list, 'b', 'up');
    expect(list).toEqual(copy);
  });
});
