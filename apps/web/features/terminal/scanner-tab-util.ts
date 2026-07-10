/** Pure helpers for the Scanner tab — sorting + honest result summaries. Unit-tested. */

export interface UiScanRow {
  symbol: string;
  status: 'ok' | 'insufficient_data' | 'unavailable' | 'script_error';
  error?: string;
  bars: number;
  metrics: Record<string, number | null>;
  matched: boolean;
}

export type ScanSortKey = 'symbol' | 'close' | 'changePct' | 'volume' | 'rsi' | 'emaDistPct' | 'atrPct' | 'rvol';
export type ScanSortDir = 'asc' | 'desc';

/** Sort rows by a column. Metric sorts put null/missing values last regardless of direction. */
export function sortScanRows(rows: readonly UiScanRow[], key: ScanSortKey, dir: ScanSortDir): UiScanRow[] {
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'symbol') return mul * a.symbol.localeCompare(b.symbol);
    const av = a.metrics[key] ?? null;
    const bv = b.metrics[key] ?? null;
    if (av === null && bv === null) return a.symbol.localeCompare(b.symbol); // stable-ish tail
    if (av === null) return 1; // nulls last, both directions
    if (bv === null) return -1;
    return mul * (av - bv);
  });
}

/** Honest scan summary for the footer: how many really scanned, matched, and lacked data. */
export function summarizeScan(rows: readonly UiScanRow[]): { scanned: number; matched: number; noData: number; scriptErrors: number } {
  let scanned = 0;
  let matched = 0;
  let noData = 0;
  let scriptErrors = 0;
  for (const r of rows) {
    if (r.status === 'ok') {
      scanned += 1;
      if (r.matched) matched += 1;
    } else if (r.status === 'script_error') {
      scriptErrors += 1;
    } else {
      noData += 1;
    }
  }
  return { scanned, matched, noData, scriptErrors };
}
