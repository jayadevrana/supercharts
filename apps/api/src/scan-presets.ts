/**
 * Canned screener presets — pure data over the same `SignalCondition` union alerts use.
 * No new evaluator code: every preset is just conditions + the instance specs they reference.
 */

import type { IndicatorInstance, SignalCondition, SignalConditionLogic } from '@supercharts/types';
import type { ScanScreen } from './scanner';

export interface ScanPreset {
  id: string;
  name: string;
  description: string;
  logic: SignalConditionLogic;
  conditions: SignalCondition[];
  indicatorSpecs: IndicatorInstance[];
}

const inst = (id: string, type: string, inputs: Record<string, number | string | boolean>): IndicatorInstance => ({
  id,
  type,
  name: id,
  paneId: 'price',
  inputs,
  style: {},
  visible: true,
  locked: false,
});

export const SCAN_PRESETS: ScanPreset[] = [
  {
    id: 'oversold',
    name: 'Oversold',
    description: 'RSI(14) below 30 on the last closed bar',
    logic: 'all',
    conditions: [
      { type: 'indicator_compare', indicator: 'p_rsi', channel: 'value', operator: '<', right: { kind: 'constant', value: 30 } },
    ],
    indicatorSpecs: [inst('p_rsi', 'rsi', { length: 14 })],
  },
  {
    id: 'overbought',
    name: 'Overbought',
    description: 'RSI(14) above 70 on the last closed bar',
    logic: 'all',
    conditions: [
      { type: 'indicator_compare', indicator: 'p_rsi', channel: 'value', operator: '>', right: { kind: 'constant', value: 70 } },
    ],
    indicatorSpecs: [inst('p_rsi', 'rsi', { length: 14 })],
  },
  {
    id: 'ma_cross_bull',
    name: 'MA cross ↑',
    description: 'EMA(9) crossed above EMA(21) on the last closed bar',
    logic: 'all',
    conditions: [
      {
        type: 'indicator_compare',
        indicator: 'p_ema9',
        channel: 'value',
        operator: 'crosses_above',
        right: { kind: 'indicator', indicator: 'p_ema21', channel: 'value' },
      },
    ],
    indicatorSpecs: [inst('p_ema9', 'ema', { length: 9 }), inst('p_ema21', 'ema', { length: 21 })],
  },
  {
    id: 'ma_cross_bear',
    name: 'MA cross ↓',
    description: 'EMA(9) crossed below EMA(21) on the last closed bar',
    logic: 'all',
    conditions: [
      {
        type: 'indicator_compare',
        indicator: 'p_ema9',
        channel: 'value',
        operator: 'crosses_below',
        right: { kind: 'indicator', indicator: 'p_ema21', channel: 'value' },
      },
    ],
    indicatorSpecs: [inst('p_ema9', 'ema', { length: 9 }), inst('p_ema21', 'ema', { length: 21 })],
  },
  {
    id: 'volume_surge',
    name: 'Volume surge',
    description: 'Relative volume above 2× its average',
    logic: 'all',
    conditions: [
      { type: 'indicator_compare', indicator: 'p_rvol', channel: 'value', operator: '>', right: { kind: 'constant', value: 2 } },
    ],
    indicatorSpecs: [inst('p_rvol', 'rvol', {})],
  },
  {
    id: 'breakout',
    name: 'Breakout',
    description: 'Close crossed above the Donchian(20) upper band',
    logic: 'all',
    conditions: [
      {
        type: 'price_crosses',
        source: 'close',
        operator: 'crosses_above',
        target: { kind: 'indicator', indicator: 'p_dc', channel: 'upper' },
      },
    ],
    indicatorSpecs: [inst('p_dc', 'donchian', { length: 20 })],
  },
];

const BY_ID = new Map(SCAN_PRESETS.map((p) => [p.id, p] as const));

/** Resolve a preset id to a runnable screen. Throws on an unknown id (route maps to 400). */
export function presetScreen(id: string): ScanScreen {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`unknown scan preset '${id}'`);
  return { conditions: p.conditions, logic: p.logic, indicatorSpecs: p.indicatorSpecs };
}
