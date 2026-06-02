import type { Interval } from '@supercharts/types';
import { INTERVALS, INTERVAL_MS } from '@supercharts/types';

/**
 * CSV → OHLC parsing for custom data import (Phase 3 #14).
 *
 * Pure, dependency-free, and unit-tested. Auto-detects the delimiter, an optional header row,
 * and the timestamp format (UNIX s / ms or an ISO/date string), then maps columns to OHLC(V).
 * The native bar interval is inferred from the median spacing between rows. Bad rows are dropped
 * with a warning — never invented. The caller turns `OhlcRow[]` into full `Candle` objects.
 */

export interface OhlcRow {
  /** Bar open time, UNIX ms UTC. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ParsedCsv {
  rows: OhlcRow[];
  interval: Interval;
  /** Index of the column used for each field (−1 = none / volume absent). */
  columns: { time: number; open: number; high: number; low: number; close: number; volume: number };
  delimiter: string;
  /** True when the first line was treated as a header. */
  hasHeader: boolean;
  warnings: string[];
}

export const MAX_CUSTOM_ROWS = 5000;

const HEADER_ALIASES: Record<keyof OhlcRow, string[]> = {
  time: ['time', 't', 'date', 'datetime', 'timestamp', 'date/time', 'open time', 'opentime', 'unix', 'epoch'],
  open: ['open', 'o'],
  high: ['high', 'h'],
  low: ['low', 'l'],
  close: ['close', 'c', 'last', 'price', 'adj close', 'close*'],
  volume: ['volume', 'vol', 'v', 'qty', 'quantity'],
};

function detectDelimiter(line: string): string {
  const counts: Array<[string, number]> = [
    ['\t', (line.match(/\t/g) ?? []).length],
    [';', (line.match(/;/g) ?? []).length],
    [',', (line.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

function splitLine(line: string, delim: string): string[] {
  // Lightweight quoted-field support: "1,234.5" stays one cell.
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
    } else if (ch === delim && !inQ) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim().replace(/^"|"$/g, ''));
}

/** Parse a numeric cell, tolerating thousands separators and surrounding symbols. */
function num(cell: string): number {
  if (cell == null) return NaN;
  const cleaned = cell.replace(/[$€£%\s]/g, '').replace(/,(?=\d{3}\b)/g, '');
  if (cleaned === '' || cleaned === '-') return NaN;
  return Number(cleaned);
}

/** Parse a timestamp cell → UNIX ms, or NaN. Handles UNIX s/ms and ISO/date strings. */
export function parseTime(cell: string): number {
  const s = (cell ?? '').trim();
  if (s === '') return NaN;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    // Disambiguate by magnitude: ~1e9 = seconds, ~1e12 = ms, ~1e15 = microseconds.
    if (n >= 1e16) return Math.floor(n / 1000); // ns→ms is unrealistic here; treat as µs guard
    if (n >= 1e14) return Math.floor(n / 1000); // microseconds → ms
    if (n >= 1e11) return n; // milliseconds
    if (n >= 1e8) return n * 1000; // seconds → ms
    return NaN; // too small to be a real epoch
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function mapHeader(cells: string[]): ParsedCsv['columns'] | null {
  const lower = cells.map((c) => c.toLowerCase().trim());
  const find = (aliases: string[]): number => lower.findIndex((c) => aliases.includes(c));
  const cols = {
    time: find(HEADER_ALIASES.time),
    open: find(HEADER_ALIASES.open),
    high: find(HEADER_ALIASES.high),
    low: find(HEADER_ALIASES.low),
    close: find(HEADER_ALIASES.close),
    volume: find(HEADER_ALIASES.volume),
  };
  // A usable header must locate at least time + the four OHLC columns.
  if (cols.time < 0 || cols.open < 0 || cols.high < 0 || cols.low < 0 || cols.close < 0) return null;
  return cols;
}

function inferInterval(times: number[]): Interval {
  if (times.length < 2) return '1d';
  const deltas: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const d = times[i]! - times[i - 1]!;
    if (d > 0) deltas.push(d);
  }
  if (deltas.length === 0) return '1d';
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)]!;
  // Nearest supported interval by ratio (log distance) — robust to small gaps/DST.
  let best: Interval = '1d';
  let bestScore = Infinity;
  for (const iv of INTERVALS) {
    const ms = INTERVAL_MS[iv];
    if (!ms) continue; // skip 'tick'
    const score = Math.abs(Math.log(median / ms));
    if (score < bestScore) {
      bestScore = score;
      best = iv;
    }
  }
  return best;
}

export function parseOhlcCsv(text: string): ParsedCsv {
  const warnings: string[] = [];
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) {
    return { rows: [], interval: '1d', columns: emptyCols(), delimiter: ',', hasHeader: false, warnings: ['Empty file.'] };
  }

  const delimiter = detectDelimiter(lines[0]!);
  const firstCells = splitLine(lines[0]!, delimiter);

  // `mapHeader` only matches when the row holds alias *labels* (open/high/…), which numeric
  // data rows never do — so a successful match means the first row really is a header.
  const headerCols = mapHeader(firstCells);

  let columns: ParsedCsv['columns'];
  let dataStart: number;
  let hasHeader: boolean;

  if (headerCols) {
    columns = headerCols;
    dataStart = 1;
    hasHeader = true;
  } else {
    // No usable header → assume positional time,open,high,low,close[,volume].
    const n = firstCells.length;
    columns = { time: 0, open: 1, high: 2, low: 3, close: 4, volume: n >= 6 ? 5 : -1 };
    dataStart = 0;
    hasHeader = false;
    if (n < 5) warnings.push(`Each row needs at least 5 columns (time,open,high,low,close); found ${n}.`);
  }

  const rows: OhlcRow[] = [];
  let skipped = 0;
  for (let i = dataStart; i < lines.length; i += 1) {
    const cells = splitLine(lines[i]!, delimiter);
    const time = parseTime(cells[columns.time] ?? '');
    const open = num(cells[columns.open] ?? '');
    const high = num(cells[columns.high] ?? '');
    const low = num(cells[columns.low] ?? '');
    const close = num(cells[columns.close] ?? '');
    const volume = columns.volume >= 0 ? num(cells[columns.volume] ?? '') : 0;
    if (![time, open, high, low, close].every(Number.isFinite)) {
      skipped += 1;
      continue;
    }
    rows.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }

  // Sort ascending + dedupe by time (last wins).
  rows.sort((a, b) => a.time - b.time);
  const deduped: OhlcRow[] = [];
  for (const r of rows) {
    const last = deduped[deduped.length - 1];
    if (last && last.time === r.time) deduped[deduped.length - 1] = r;
    else deduped.push(r);
  }

  if (skipped > 0) warnings.push(`Skipped ${skipped} row(s) that were not valid OHLC data.`);
  let final = deduped;
  if (final.length > MAX_CUSTOM_ROWS) {
    warnings.push(`Truncated to the most recent ${MAX_CUSTOM_ROWS} of ${final.length} rows.`);
    final = final.slice(final.length - MAX_CUSTOM_ROWS);
  }

  const interval = inferInterval(final.map((r) => r.time));
  return { rows: final, interval, columns, delimiter, hasHeader, warnings };
}

function emptyCols(): ParsedCsv['columns'] {
  return { time: -1, open: -1, high: -1, low: -1, close: -1, volume: -1 };
}
