import { describe, it, expect } from 'vitest';
import {
  indicatorInputSummary,
  legendColor,
  formatIndicatorValue,
  buildLegendRows,
} from '../apps/web/features/terminal/indicator-legend-util';
import type { IndicatorSpec } from '@supercharts/indicators';
import type { IndicatorInstance } from '@supercharts/types';

const emaSpec = {
  type: 'ema',
  label: 'Exponential MA',
  pane: 'overlay',
  channels: ['value'],
  inputs: [
    { key: 'length', label: 'Length', type: 'int', default: 21 },
    { key: 'source', label: 'Source', type: 'enum', default: 'close', options: [] },
  ],
  style: { color: '#2196f3', lineWidth: 1.5 },
} as unknown as IndicatorSpec;

const emaInst = (over: Partial<IndicatorInstance> = {}): IndicatorInstance => ({
  id: 'ema_1',
  type: 'ema',
  name: 'Exponential MA',
  paneId: 'price',
  inputs: { length: 21, source: 'close' },
  style: {},
  visible: true,
  locked: false,
  ...over,
});

describe('indicatorInputSummary', () => {
  it('joins tuned inputs and omits booleans', () => {
    expect(indicatorInputSummary(emaSpec, emaInst())).toBe('21 · close');
    expect(indicatorInputSummary(emaSpec, emaInst({ inputs: { length: 9, source: 'hlc3' } }))).toBe('9 · hlc3');
  });
});

describe('legendColor', () => {
  it('prefers the instance override, then the spec color', () => {
    expect(legendColor(emaSpec, emaInst())).toBe('#2196f3');
    expect(legendColor(emaSpec, emaInst({ style: { color: '#ff0000' } }))).toBe('#ff0000');
  });
  it('falls back to a neutral colour when nothing is set', () => {
    const bare = { ...emaSpec, style: {} } as IndicatorSpec;
    expect(legendColor(bare, emaInst())).toBe('#9aa4b2');
  });
});

describe('formatIndicatorValue', () => {
  it('renders an em dash for non-finite values', () => {
    expect(formatIndicatorValue(undefined)).toBe('—');
    expect(formatIndicatorValue(NaN)).toBe('—');
    expect(formatIndicatorValue(null)).toBe('—');
  });
  it('adapts precision to magnitude', () => {
    expect(formatIndicatorValue(67_000.123)).toBe('67,000.12');
    expect(formatIndicatorValue(1.08321)).toBe('1.083');
    expect(formatIndicatorValue(0.0004321)).toBe('0.0004321');
  });
});

describe('buildLegendRows', () => {
  const specOf = (t: string) => (t === 'ema' ? emaSpec : undefined);

  it('reads the primary channel value at the given index', () => {
    const ch = new Map<string, Record<string, number[]>>([['ema_1', { value: [10, 11, 12.5] }]]);
    const rows = buildLegendRows([emaInst()], specOf, ch, 2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'ema_1', name: 'Exponential MA', summary: '21 · close', value: '12.5', visible: true });
  });

  it('shows an em dash for hidden instances and out-of-range indices', () => {
    const ch = new Map<string, Record<string, number[]>>([['ema_1', { value: [10, 11] }]]);
    expect(buildLegendRows([emaInst({ visible: false })], specOf, ch, 1)[0].value).toBe('—');
    expect(buildLegendRows([emaInst()], specOf, ch, 9)[0].value).toBe('—'); // index past series
    expect(buildLegendRows([emaInst()], specOf, new Map(), 0)[0].value).toBe('—'); // no channels
  });

  it('skips instances whose spec is missing', () => {
    expect(buildLegendRows([emaInst({ type: 'unknown' })], specOf, new Map(), 0)).toEqual([]);
  });
});
