/**
 * Indicator registry — names, default params, and output channel names.
 * The terminal UI uses this to drive the "Add indicator" picker and to
 * render parameter editors without hardcoding per-indicator forms.
 */

export type IndicatorInputType = 'int' | 'float' | 'enum' | 'bool';

export interface IndicatorInputSpec {
  key: string;
  label: string;
  type: IndicatorInputType;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string }>;
}

export type IndicatorPaneHint = 'overlay' | 'sub';

export interface IndicatorSpec {
  /** Stable identifier used everywhere; pass to the runner / UI. */
  type: string;
  label: string;
  /** Where the indicator naturally renders. */
  pane: IndicatorPaneHint;
  /** Output channels exposed to the signal language. */
  channels: string[];
  /** Inputs the user can tune. */
  inputs: IndicatorInputSpec[];
  /** Default style fields the UI lets the user override. */
  style: Record<string, string | number>;
  /** Optional short description used as a tooltip in the picker. */
  description?: string;
}

export const INDICATOR_REGISTRY: IndicatorSpec[] = [
  {
    type: 'sma',
    label: 'Simple Moving Average',
    pane: 'overlay',
    channels: ['value'],
    inputs: [
      { key: 'length', label: 'Length', type: 'int', default: 20, min: 1, max: 500 },
      sourceInput(),
    ],
    style: { color: '#4caf50', lineWidth: 1.5 },
    description: 'Average of price over the lookback window.',
  },
  {
    type: 'ema',
    label: 'Exponential Moving Average',
    pane: 'overlay',
    channels: ['value'],
    inputs: [
      { key: 'length', label: 'Length', type: 'int', default: 21, min: 1, max: 500 },
      sourceInput(),
    ],
    style: { color: '#2196f3', lineWidth: 1.5 },
  },
  {
    type: 'wma',
    label: 'Weighted Moving Average',
    pane: 'overlay',
    channels: ['value'],
    inputs: [{ key: 'length', label: 'Length', type: 'int', default: 20 }, sourceInput()],
    style: { color: '#9c27b0', lineWidth: 1.5 },
  },
  {
    type: 'hma',
    label: 'Hull Moving Average',
    pane: 'overlay',
    channels: ['value'],
    inputs: [{ key: 'length', label: 'Length', type: 'int', default: 21 }, sourceInput()],
    style: { color: '#ff9800', lineWidth: 1.5 },
  },
  {
    type: 'rsi',
    label: 'Relative Strength Index',
    pane: 'sub',
    channels: ['value'],
    inputs: [
      { key: 'length', label: 'Length', type: 'int', default: 14, min: 2 },
      sourceInput(),
    ],
    style: { color: '#ffb300', lineWidth: 1.5, upperBand: 70, lowerBand: 30 },
  },
  {
    type: 'macd',
    label: 'MACD',
    pane: 'sub',
    channels: ['macd', 'signal', 'histogram'],
    inputs: [
      { key: 'fast', label: 'Fast', type: 'int', default: 12 },
      { key: 'slow', label: 'Slow', type: 'int', default: 26 },
      { key: 'signal', label: 'Signal', type: 'int', default: 9 },
      sourceInput(),
    ],
    style: { macdColor: '#42a5f5', signalColor: '#ef5350', histogramPositive: '#26a69a', histogramNegative: '#ef5350' },
  },
  {
    type: 'stochastic',
    label: 'Stochastic',
    pane: 'sub',
    channels: ['k', 'd'],
    inputs: [
      { key: 'kLength', label: '%K Length', type: 'int', default: 14 },
      { key: 'kSmooth', label: '%K Smooth', type: 'int', default: 3 },
      { key: 'dSmooth', label: '%D Smooth', type: 'int', default: 3 },
    ],
    style: { kColor: '#42a5f5', dColor: '#ef5350', upperBand: 80, lowerBand: 20 },
  },
  {
    type: 'williams_r',
    label: 'Williams %R',
    pane: 'sub',
    channels: ['value'],
    inputs: [{ key: 'length', label: 'Length', type: 'int', default: 14 }],
    style: { color: '#ab47bc', upperBand: -20, lowerBand: -80 },
  },
  {
    type: 'cci',
    label: 'CCI',
    pane: 'sub',
    channels: ['value'],
    inputs: [{ key: 'length', label: 'Length', type: 'int', default: 20 }],
    style: { color: '#26a69a', upperBand: 100, lowerBand: -100 },
  },
  {
    type: 'mfi',
    label: 'Money Flow Index',
    pane: 'sub',
    channels: ['value'],
    inputs: [{ key: 'length', label: 'Length', type: 'int', default: 14 }],
    style: { color: '#ffa726', upperBand: 80, lowerBand: 20 },
  },
  {
    type: 'roc',
    label: 'Rate of Change',
    pane: 'sub',
    channels: ['value'],
    inputs: [{ key: 'length', label: 'Length', type: 'int', default: 9 }, sourceInput()],
    style: { color: '#7e57c2' },
  },
  {
    type: 'atr',
    label: 'Average True Range',
    pane: 'sub',
    channels: ['value'],
    inputs: [
      { key: 'length', label: 'Length', type: 'int', default: 14 },
      {
        key: 'smoothing',
        label: 'Smoothing',
        type: 'enum',
        default: 'rma',
        options: [
          { label: 'Wilder (RMA)', value: 'rma' },
          { label: 'EMA', value: 'ema' },
          { label: 'SMA', value: 'sma' },
        ],
      },
    ],
    style: { color: '#90a4ae' },
  },
  {
    type: 'bollinger',
    label: 'Bollinger Bands',
    pane: 'overlay',
    channels: ['middle', 'upper', 'lower', 'bandwidth', 'percentB'],
    inputs: [
      { key: 'length', label: 'Length', type: 'int', default: 20 },
      { key: 'multiplier', label: 'Multiplier', type: 'float', default: 2, step: 0.1 },
    ],
    style: { middleColor: '#cfd8dc', bandColor: '#90a4ae', fillOpacity: 0.08 },
  },
  {
    type: 'keltner',
    label: 'Keltner Channels',
    pane: 'overlay',
    channels: ['middle', 'upper', 'lower'],
    inputs: [
      { key: 'emaLength', label: 'EMA Length', type: 'int', default: 20 },
      { key: 'atrLength', label: 'ATR Length', type: 'int', default: 10 },
      { key: 'multiplier', label: 'Multiplier', type: 'float', default: 2, step: 0.1 },
    ],
    style: { middleColor: '#fff59d', bandColor: '#ffee58' },
  },
  {
    type: 'donchian',
    label: 'Donchian Channels',
    pane: 'overlay',
    channels: ['upper', 'lower', 'middle'],
    inputs: [{ key: 'length', label: 'Length', type: 'int', default: 20 }],
    style: { bandColor: '#80cbc4' },
  },
  {
    type: 'adx',
    label: 'ADX / DMI',
    pane: 'sub',
    channels: ['adx', 'plusDI', 'minusDI'],
    inputs: [{ key: 'length', label: 'Length', type: 'int', default: 14 }],
    style: { adxColor: '#ffffff', plusColor: '#26a69a', minusColor: '#ef5350' },
  },
  {
    type: 'supertrend',
    label: 'Supertrend',
    pane: 'overlay',
    channels: ['line', 'direction'],
    inputs: [
      { key: 'atrLength', label: 'ATR Length', type: 'int', default: 10 },
      { key: 'multiplier', label: 'Multiplier', type: 'float', default: 3, step: 0.1 },
    ],
    style: { upColor: '#26a69a', downColor: '#ef5350' },
  },
  {
    type: 'psar',
    label: 'Parabolic SAR',
    pane: 'overlay',
    channels: ['value'],
    inputs: [
      { key: 'start', label: 'Start', type: 'float', default: 0.02, step: 0.01 },
      { key: 'step', label: 'Step', type: 'float', default: 0.02, step: 0.01 },
      { key: 'max', label: 'Max', type: 'float', default: 0.2, step: 0.05 },
    ],
    style: { color: '#ec407a', dotSize: 3 },
  },
  {
    type: 'ichimoku',
    label: 'Ichimoku Cloud',
    pane: 'overlay',
    channels: ['conversion', 'base', 'spanA', 'spanB', 'lagging'],
    inputs: [
      { key: 'conversion', label: 'Conversion', type: 'int', default: 9 },
      { key: 'base', label: 'Base', type: 'int', default: 26 },
      { key: 'spanB', label: 'Span B', type: 'int', default: 52 },
      { key: 'displacement', label: 'Displacement', type: 'int', default: 26 },
    ],
    style: { conversionColor: '#42a5f5', baseColor: '#ef5350', cloudUp: '#26a69a40', cloudDown: '#ef535040' },
  },
  {
    type: 'aroon',
    label: 'Aroon',
    pane: 'sub',
    channels: ['up', 'down', 'oscillator'],
    inputs: [{ key: 'length', label: 'Length', type: 'int', default: 14 }],
    style: { upColor: '#26a69a', downColor: '#ef5350' },
  },
  {
    type: 'vwap',
    label: 'VWAP',
    pane: 'overlay',
    channels: ['value'],
    inputs: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'enum',
        default: 'session',
        options: [
          { label: 'Session', value: 'session' },
          { label: 'Cumulative', value: 'cumulative' },
        ],
      },
    ],
    style: { color: '#ffa726', lineWidth: 1.5 },
  },
  {
    type: 'obv',
    label: 'On Balance Volume',
    pane: 'sub',
    channels: ['value'],
    inputs: [],
    style: { color: '#42a5f5' },
  },
  {
    type: 'cmf',
    label: 'Chaikin Money Flow',
    pane: 'sub',
    channels: ['value'],
    inputs: [{ key: 'length', label: 'Length', type: 'int', default: 20 }],
    style: { color: '#ab47bc' },
  },
  {
    type: 'volume_oscillator',
    label: 'Volume Oscillator',
    pane: 'sub',
    channels: ['value'],
    inputs: [
      { key: 'shortLength', label: 'Short', type: 'int', default: 5 },
      { key: 'longLength', label: 'Long', type: 'int', default: 20 },
    ],
    style: { color: '#26a69a' },
  },
  {
    type: 'rvol',
    label: 'Relative Volume (RVOL)',
    pane: 'sub',
    channels: ['value'],
    inputs: [{ key: 'length', label: 'Lookback', type: 'int', default: 20, min: 2 }],
    style: { color: '#ffa726' },
    description:
      'Current bar volume ÷ average of the prior N bars. >1 = above-average participation. Works on every symbol (tick volume on FX).',
  },
  {
    type: 'vwap_bands',
    label: 'VWAP Bands (σ)',
    pane: 'overlay',
    channels: ['vwap', 'upper1', 'lower1', 'upper2', 'lower2'],
    inputs: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'enum',
        default: 'session',
        options: [
          { label: 'Session', value: 'session' },
          { label: 'Cumulative', value: 'cumulative' },
        ],
      },
      { key: 'multiplier1', label: 'Inner σ', type: 'float', default: 1, step: 0.5, min: 0.5 },
      { key: 'multiplier2', label: 'Outer σ', type: 'float', default: 2, step: 0.5, min: 0.5 },
    ],
    style: { color: '#26c6da', bandColor: 'rgba(38,198,218,0.10)' },
    description:
      'Volume-weighted average price with ±σ standard-deviation bands. Session mode resets at the UTC day. Candle-derived — real on all symbols/timeframes.',
  },
  {
    type: 'initial_balance',
    label: 'Initial Balance',
    pane: 'overlay',
    channels: ['ibHigh', 'ibLow', 'ibMid'],
    inputs: [{ key: 'ibMinutes', label: 'IB minutes', type: 'int', default: 60, min: 5 }],
    style: { color: '#f06292', midColor: 'rgba(240,98,146,0.5)' },
    description:
      'High/low established in the first hour of each UTC session, drawn as flat reference levels. Intraday market-profile staple — real on all symbols.',
  },
];

export const INDICATOR_LOOKUP: Record<string, IndicatorSpec> = Object.fromEntries(
  INDICATOR_REGISTRY.map((s) => [s.type, s]),
);

function sourceInput(): IndicatorInputSpec {
  return {
    key: 'source',
    label: 'Source',
    type: 'enum',
    default: 'close',
    options: [
      { label: 'Open', value: 'open' },
      { label: 'High', value: 'high' },
      { label: 'Low', value: 'low' },
      { label: 'Close', value: 'close' },
      { label: 'HL2', value: 'hl2' },
      { label: 'HLC3', value: 'hlc3' },
      { label: 'OHLC4', value: 'ohlc4' },
    ],
  };
}
