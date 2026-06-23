import { describe, it, expect } from 'vitest';
import { buildDataWindow, formatVolume } from '../apps/web/features/terminal/data-window-util';
import { channelColor } from '../apps/web/features/terminal/indicator-legend-util';
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
  style: { macdColor: '#42a5f5', signalColor: '#ef5350', histogramPositive: '#26a69a', histogramNegative: '#ef5350' },
  channelLabels: { macd: 'MACD', signal: 'Signal', histogram: 'Histogram' },
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
    expect(snap.ohlcv).toMatchObject({
      open: '100',
      high: '120',
      low: '99',
      close: '110',
      volume: '2.50M',
      range: '21',
      rangePct: '21.00%',
      body: '+10',
      bodyPct: '+10.00%',
      up: true,
      bodyUp: true,
    });
    expect(snap.ohlcv?.change).toBe('+10'); // 110 - prev close 100
    expect(snap.ohlcv?.changePct).toBe('+10.00%');
    expect(snap.indicators[0].channels).toEqual([
      { label: 'MACD', value: '0.42', color: '#42a5f5' },
      { label: 'Signal', value: '0.3', color: '#ef5350' },
      { label: 'Histogram', value: '0.12', color: '#26a69a' },
    ]);
    expect(snap.indicators[0].visible).toBe(true);
  });

  it('marks a down bar bearish with a negative change + percent', () => {
    const down = [candle({ openTime: 1, close: 110 }), candle({ openTime: 2, open: 110, close: 102 })];
    const snap = buildDataWindow('p0', down, 1, true, [], specOf, new Map());
    expect(snap.ohlcv).toMatchObject({
      close: '102',
      change: '-8',
      changePct: '-7.27%',
      body: '-8',
      bodyPct: '-7.27%',
      up: false,
      bodyUp: false,
    });
  });

  it('falls back to open when there is no previous bar', () => {
    const snap = buildDataWindow('p0', bars, 0, false, [], specOf, new Map());
    expect(snap.ohlcv?.change).toBe('+0'); // close 100 vs open 100
    expect(snap.atCrosshair).toBe(false);
  });

  it('renders em dashes for hidden indicators and yields null ohlcv for a bad index', () => {
    const hidden = buildDataWindow('p0', bars, 1, true, [{ ...macdInst, visible: false }], specOf, channels);
    expect(hidden.indicators[0].channels.every((c) => c.value === '—')).toBe(true);
    expect(hidden.indicators[0].visible).toBe(false);
    const empty = buildDataWindow('p0', bars, 99, false, [], specOf, new Map());
    expect(empty.ohlcv).toBeNull();
    expect(empty.time).toBeNull();
  });
});

describe('channelColor', () => {
  it('resolves multi-plot style aliases and lets instance style override defaults', () => {
    const bollinger = {
      type: 'bollinger',
      label: 'Bollinger Bands',
      pane: 'overlay',
      channels: ['middle', 'upper', 'lower', 'percentB'],
      inputs: [],
      style: { middleColor: '#cfd8dc', bandColor: '#90a4ae' },
    } as unknown as IndicatorSpec;
    const adx = {
      type: 'adx',
      label: 'ADX / DMI',
      pane: 'sub',
      channels: ['adx', 'plusDI', 'minusDI'],
      inputs: [],
      style: { adxColor: '#ffffff', plusColor: '#26a69a', minusColor: '#ef5350' },
    } as unknown as IndicatorSpec;

    expect(channelColor(bollinger, { ...macdInst, type: 'bollinger', style: { bandColor: '#123456' } }, 'upper')).toBe('#123456');
    expect(channelColor(bollinger, { ...macdInst, type: 'bollinger', style: {} }, 'middle')).toBe('#cfd8dc');
    expect(channelColor(adx, { ...macdInst, type: 'adx', style: {} }, 'plusDI')).toBe('#26a69a');
    expect(channelColor(adx, { ...macdInst, type: 'adx', style: {} }, 'minusDI')).toBe('#ef5350');
  });
});
