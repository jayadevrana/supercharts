import { describe, it, expect } from 'vitest';
import { buildDataWindow, formatVolume } from '../apps/web/features/terminal/data-window-util';
import type { Candle, IndicatorInstance } from '@supercharts/types';
import type { IndicatorSpec } from '@supercharts/indicators';

const candle = (over: Partial<Candle>): Candle =>
  ({ openTime: 1, closeTime: 2, open: 100, high: 110, low: 95, close: 105, volume: 1500, symbol: 'X', interval: '1m', ...over } as Candle);

const bars: Candle[] = [
  candle({ openTime: 1, open: 100, high: 110, low: 95, close: 100, volume: 1000 }),
  candle({ openTime: 2, open: 100, high: 120, low: 99, close: 110, volume: 2_500_000 }),
];

const macdSpec = {
  type: 'macd',
  label: 'MACD',
  pane: 'sub',
  channels: ['macd', 'signal', 'histogram'],
  inputs: [],
  style: { macdColor: '#42a5f5' },
} as unknown as IndicatorSpec;

const macdInst: IndicatorInstance = {
  id: 'macd_1', type: 'macd', name: 'MACD', paneId: 'macd', inputs: {}, style: {}, visible: true, locked: false,
};

const specOf = (t: string) => (t === 'macd' ? macdSpec : undefined);

describe('formatVolume', () => {
  it('uses K/M/B suffixes', () => {
    expect(formatVolume(530)).toBe('530');
    expect(formatVolume(1_500)).toBe('1.50K');
    expect(formatVolume(2_500_000)).toBe('2.50M');
    expect(formatVolume(4_100_000_000)).toBe('4.10B');
    expect(formatVolume(NaN)).toBe('—');
  });
});

describe('buildDataWindow', () => {
  const channels = new Map<string, Record<string, number[]>>([
    ['macd_1', { macd: [0.1, 0.42], signal: [0.05, 0.3], histogram: [0.05, 0.12] }],
  ]);

  it('builds OHLCV with change vs the previous close + all indicator channels', () => {
    const snap = buildDataWindow('p0', bars, 1, true, [macdInst], specOf, channels);
    expect(snap.paneId).toBe('p0');
    expect(snap.atCrosshair).toBe(true);
    expect(snap.ohlcv).toMatchObject({ open: '100', high: '120', low: '99', close: '110', volume: '2.50M', up: true });
    expect(snap.ohlcv?.change).toBe('+10'); // 110 - prev close 100
    expect(snap.ohlcv?.changePct).toBe('+10.00%');
    expect(snap.indicators[0].channels).toEqual([
      { label: 'macd', value: '0.42' },
      { label: 'signal', value: '0.3' },
      { label: 'histogram', value: '0.12' },
    ]);
  });

  it('marks a down bar bearish with a negative change + percent', () => {
    const down = [candle({ openTime: 1, close: 110 }), candle({ openTime: 2, open: 110, close: 102 })];
    const snap = buildDataWindow('p0', down, 1, true, [], specOf, new Map());
    expect(snap.ohlcv).toMatchObject({ close: '102', change: '-8', changePct: '-7.27%', up: false });
  });

  it('falls back to open when there is no previous bar', () => {
    const snap = buildDataWindow('p0', bars, 0, false, [], specOf, new Map());
    expect(snap.ohlcv?.change).toBe('+0'); // close 100 vs open 100
    expect(snap.atCrosshair).toBe(false);
  });

  it('renders em dashes for hidden indicators and yields null ohlcv for a bad index', () => {
    const hidden = buildDataWindow('p0', bars, 1, true, [{ ...macdInst, visible: false }], specOf, channels);
    expect(hidden.indicators[0].channels.every((c) => c.value === '—')).toBe(true);
    const empty = buildDataWindow('p0', bars, 99, false, [], specOf, new Map());
    expect(empty.ohlcv).toBeNull();
    expect(empty.time).toBeNull();
  });
});
