import { describe, it, expect } from 'vitest';
import { normalizeEconomicEvents, type RawCalendarEvent } from '../apps/api/src/economic-calendar';

const raw = (over: Partial<RawCalendarEvent> = {}): RawCalendarEvent => ({
  title: 'Final Manufacturing PMI',
  country: 'USD',
  date: '2026-05-31T08:30:00-04:00',
  impact: 'High',
  forecast: '54.5',
  previous: '54.5',
  ...over,
});

describe('normalizeEconomicEvents', () => {
  it('maps impact strings, with anything unknown bucketed as holiday', () => {
    const impacts = ['High', 'Medium', 'Low', 'Holiday', 'NonFarm', undefined].map(
      (impact) => normalizeEconomicEvents([raw({ impact })])[0]?.impact,
    );
    expect(impacts).toEqual(['high', 'medium', 'low', 'holiday', 'holiday', 'holiday']);
  });

  it('parses the ISO timestamp (with offset) to UTC ms', () => {
    const [e] = normalizeEconomicEvents([raw({ date: '2026-05-31T08:30:00-04:00' })]);
    // 08:30 at -04:00 == 12:30 UTC.
    expect(e.time).toBe(Date.UTC(2026, 4, 31, 12, 30, 0));
  });

  it('drops rows with no title or an unparseable date', () => {
    const out = normalizeEconomicEvents([
      raw({ title: undefined }),
      raw({ date: undefined }),
      raw({ date: 'not-a-date' }),
      raw(),
    ]);
    expect(out).toHaveLength(1);
  });

  it('sorts ascending by time regardless of input order', () => {
    const out = normalizeEconomicEvents([
      raw({ title: 'B', date: '2026-05-31T12:00:00Z' }),
      raw({ title: 'A', date: '2026-05-31T09:00:00Z' }),
      raw({ title: 'C', date: '2026-05-31T18:00:00Z' }),
    ]);
    expect(out.map((e) => e.title)).toEqual(['A', 'B', 'C']);
  });

  it('uppercases the currency and blanks empty forecast/previous to undefined', () => {
    const [e] = normalizeEconomicEvents([raw({ country: 'gbp', forecast: '', previous: '  ' })]);
    expect(e.currency).toBe('GBP');
    expect(e.forecast).toBeUndefined();
    expect(e.previous).toBeUndefined();
  });

  it('produces a stable id for identical events', () => {
    const a = normalizeEconomicEvents([raw()])[0];
    const b = normalizeEconomicEvents([raw()])[0];
    expect(a.id).toBe(b.id);
    expect(a.id.startsWith('ec_')).toBe(true);
  });

  it('tolerates a non-array payload without throwing', () => {
    expect(normalizeEconomicEvents(undefined as unknown as RawCalendarEvent[])).toEqual([]);
  });
});
