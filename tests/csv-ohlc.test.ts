import { describe, it, expect } from 'vitest';
import { parseOhlcCsv, parseTime } from '../apps/api/src/csv-ohlc';

describe('parseTime', () => {
  it('treats 10-digit values as UNIX seconds', () => {
    expect(parseTime('1700000000')).toBe(1700000000 * 1000);
  });
  it('treats 13-digit values as UNIX milliseconds', () => {
    expect(parseTime('1700000000000')).toBe(1700000000000);
  });
  it('parses ISO and plain date strings to UTC ms', () => {
    expect(parseTime('2024-01-02T00:00:00Z')).toBe(Date.UTC(2024, 0, 2));
    expect(parseTime('2024-01-02')).toBe(Date.UTC(2024, 0, 2));
  });
  it('rejects junk and too-small numbers', () => {
    expect(Number.isNaN(parseTime('hello'))).toBe(true);
    expect(Number.isNaN(parseTime('12345'))).toBe(true);
  });
});

describe('parseOhlcCsv', () => {
  it('parses a headered daily CSV with volume', () => {
    const csv = [
      'Date,Open,High,Low,Close,Volume',
      '2024-01-01,100,110,95,105,1000',
      '2024-01-02,105,120,104,118,1500',
      '2024-01-03,118,119,108,109,1200',
    ].join('\n');
    const r = parseOhlcCsv(csv);
    expect(r.hasHeader).toBe(true);
    expect(r.rows).toHaveLength(3);
    expect(r.interval).toBe('1d');
    expect(r.rows[0]).toEqual({ time: Date.UTC(2024, 0, 1), open: 100, high: 110, low: 95, close: 105, volume: 1000 });
    expect(r.rows[2].close).toBe(109);
  });

  it('parses a headerless positional CSV with UNIX-second timestamps', () => {
    const base = 1700000000; // seconds
    const csv = [
      `${base},10,11,9,10.5,100`,
      `${base + 3600},10.5,12,10,11.8,120`,
      `${base + 7200},11.8,11.9,10.8,10.9,90`,
    ].join('\n');
    const r = parseOhlcCsv(csv);
    expect(r.hasHeader).toBe(false);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].time).toBe(base * 1000);
    expect(r.interval).toBe('1h');
  });

  it('auto-detects a semicolon delimiter and thousands separators', () => {
    const csv = [
      'time;open;high;low;close',
      '2024-03-01;"1,200.5";"1,250.0";"1,180.0";"1,240.0"',
      '2024-03-02;1240;1300;1235;1295',
    ].join('\n');
    const r = parseOhlcCsv(csv);
    expect(r.delimiter).toBe(';');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].open).toBe(1200.5);
    expect(r.rows[0].high).toBe(1250);
    expect(r.columns.volume).toBe(-1); // no volume column
  });

  it('drops invalid rows and records a warning, keeping the good ones', () => {
    const csv = [
      'date,open,high,low,close',
      '2024-01-01,100,110,95,105',
      'garbage,line,that,is,bad',
      '2024-01-02,105,120,104,118',
      ',,,,', // empty cells
    ].join('\n');
    const r = parseOhlcCsv(csv);
    expect(r.rows).toHaveLength(2);
    expect(r.warnings.some((w) => /Skipped 2 row/.test(w))).toBe(true);
  });

  it('sorts ascending and dedupes duplicate timestamps (last wins)', () => {
    const csv = [
      'date,open,high,low,close',
      '2024-01-03,3,3,3,3',
      '2024-01-01,1,1,1,1',
      '2024-01-02,2,2,2,2',
      '2024-01-02,9,9,9,9', // duplicate of 01-02 → should replace
    ].join('\n');
    const r = parseOhlcCsv(csv);
    expect(r.rows.map((x) => x.close)).toEqual([1, 9, 3]);
  });

  it('infers an hourly interval from row spacing', () => {
    const start = Date.UTC(2024, 5, 1);
    const rows = Array.from({ length: 6 }, (_, i) => {
      const t = new Date(start + i * 3_600_000).toISOString();
      return `${t},1,2,0.5,1.5,10`;
    });
    const r = parseOhlcCsv(['datetime,open,high,low,close,volume', ...rows].join('\n'));
    expect(r.interval).toBe('1h');
    expect(r.rows).toHaveLength(6);
  });

  it('returns an empty result with a warning for a blank file', () => {
    const r = parseOhlcCsv('\n\n   \n');
    expect(r.rows).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
