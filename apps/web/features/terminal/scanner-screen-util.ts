/**
 * Custom-screen builder model (SCAN-3) — pure mapping from simple UI rows to the same
 * `SignalCondition` union the alert engine evaluates. No new evaluator: the server's
 * POST /api/scanner/scan already accepts `screen: {conditions, logic, indicatorSpecs}`.
 */

import type { IndicatorInstance, SignalCondition, SignalConditionLogic } from '@supercharts/types';

export type ScreenRow =
  | { kind: 'rsi'; length: number; op: '>' | '<'; value: number }
  | { kind: 'price_vs_ema'; length: number; op: '>' | '<' | 'crosses_above' | 'crosses_below' }
  | { kind: 'rvol'; op: '>' | '<'; value: number };

export interface CustomScreen {
  conditions: SignalCondition[];
  logic: SignalConditionLogic;
  indicatorSpecs: IndicatorInstance[];
}

const inst = (id: string, type: string, inputs: Record<string, number>): IndicatorInstance => ({
  id,
  type,
  name: id,
  paneId: 'price',
  inputs,
  style: {},
  visible: true,
  locked: false,
});

/** Map builder rows → conditions + specs. Row `i` owns ids `r<i>_<type>` so lengths never clash. */
export function buildCustomScreen(rows: readonly ScreenRow[], logic: SignalConditionLogic): CustomScreen {
  const conditions: SignalCondition[] = [];
  const indicatorSpecs: IndicatorInstance[] = [];
  rows.forEach((row, i) => {
    if (row.kind === 'rsi') {
      const id = `r${i}_rsi`;
      indicatorSpecs.push(inst(id, 'rsi', { length: row.length }));
      conditions.push({
        type: 'indicator_compare',
        indicator: id,
        channel: 'value',
        operator: row.op,
        right: { kind: 'constant', value: row.value },
      });
    } else if (row.kind === 'price_vs_ema') {
      const id = `r${i}_ema`;
      indicatorSpecs.push(inst(id, 'ema', { length: row.length }));
      if (row.op === 'crosses_above' || row.op === 'crosses_below') {
        conditions.push({
          type: 'price_crosses',
          source: 'close',
          operator: row.op,
          target: { kind: 'indicator', indicator: id, channel: 'value' },
        });
      } else {
        // "close > ema" ⇔ "ema < close" — indicator_compare's left side must be an indicator.
        conditions.push({
          type: 'indicator_compare',
          indicator: id,
          channel: 'value',
          operator: row.op === '>' ? '<' : '>',
          right: { kind: 'price', field: 'close' },
        });
      }
    } else {
      const id = `r${i}_rvol`;
      indicatorSpecs.push(inst(id, 'rvol', {}));
      conditions.push({
        type: 'indicator_compare',
        indicator: id,
        channel: 'value',
        operator: row.op,
        right: { kind: 'constant', value: row.value },
      });
    }
  });
  return { conditions, logic, indicatorSpecs };
}

/** Plain-English row label for chips/summaries. */
export function describeRow(row: ScreenRow): string {
  if (row.kind === 'rsi') return `RSI(${row.length}) ${row.op} ${row.value}`;
  if (row.kind === 'price_vs_ema') {
    const op = row.op === 'crosses_above' ? 'crosses above' : row.op === 'crosses_below' ? 'crosses below' : row.op;
    return `Close ${op} EMA(${row.length})`;
  }
  return `RVOL ${row.op} ${row.value}`;
}
