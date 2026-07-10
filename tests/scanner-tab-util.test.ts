import { describe, expect, it } from 'vitest';
import { sortScanRows, summarizeScan, type UiScanRow } from '../apps/web/features/terminal/scanner-tab-util';

const row = (symbol: string, status: UiScanRow['status'], metrics: Record<string, number | null> = {}, matched = false): UiScanRow => ({
  symbol,
  status,
  bars: status === 'ok' ? 200 : 0,
  metrics,
  matched,
});

const ROWS: UiScanRow[] = [
  row('A', 'ok', { rsi: 70, changePct: -1 }, true),
  row('B', 'ok', { rsi: 30, changePct: 5 }, true),
  row('C', 'ok', { rsi: null, changePct: 2 }, true), // null metric
  row('D', 'insufficient_data'),
  row('E', 'unavailable'),
];

describe('sortScanRows', () => {
  it('sorts ok rows by a metric desc, nulls always last', () => {
    const s = sortScanRows(ROWS.slice(0, 3), 'rsi', 'desc');
    expect(s.map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
  });

  it('asc puts smallest first, nulls still last', () => {
    const s = sortScanRows(ROWS.slice(0, 3), 'rsi', 'asc');
    expect(s.map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });

  it('symbol sort is alphabetical and stable across statuses', () => {
    const s = sortScanRows([...ROWS].reverse(), 'symbol', 'asc');
    expect(s.map((r) => r.symbol)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('summarizeScan', () => {
  it('counts scanned / matched / no-data honestly', () => {
    expect(summarizeScan(ROWS)).toEqual({ scanned: 3, matched: 3, noData: 2, scriptErrors: 0 });
  });

  it('empty input → zeros', () => {
    expect(summarizeScan([])).toEqual({ scanned: 0, matched: 0, noData: 0, scriptErrors: 0 });
    expect(summarizeScan([row('X', 'script_error')])).toEqual({ scanned: 0, matched: 0, noData: 0, scriptErrors: 1 });
  });
});
