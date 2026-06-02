import type { EconomicEvent, EconomicImpact } from '@supercharts/types';

/**
 * Economic-calendar normalization (Phase 3 #13).
 *
 * Pure transform from the upstream weekly macro-calendar feed's raw shape into our typed
 * `EconomicEvent[]`. Kept separate from the fetch so it is deterministic and unit-tested;
 * the route only does the network + caching around it. The feed never fabricates — invalid
 * rows are dropped, not invented.
 */

export interface RawCalendarEvent {
  title?: string;
  /** Currency / region code (the feed misnames this "country"). */
  country?: string;
  /** ISO-8601 timestamp with offset, e.g. "2026-05-31T08:30:00-04:00". */
  date?: string;
  /** "High" | "Medium" | "Low" | "Holiday". */
  impact?: string;
  forecast?: string;
  previous?: string;
}

function mapImpact(s: string | undefined): EconomicImpact {
  switch ((s ?? '').trim().toLowerCase()) {
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'holiday'; // "Holiday" and anything unrecognised → non-market-moving bucket
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Normalize + sort raw feed rows; drops rows without a title or a parseable date. */
export function normalizeEconomicEvents(raw: RawCalendarEvent[]): EconomicEvent[] {
  const out: EconomicEvent[] = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    if (!e || !e.title || !e.date) continue;
    const time = Date.parse(e.date);
    if (!Number.isFinite(time)) continue;
    const currency = (e.country ?? '').trim().toUpperCase();
    const forecast = e.forecast?.trim() || undefined;
    const previous = e.previous?.trim() || undefined;
    out.push({
      id: `ec_${hash(`${e.date}|${currency}|${e.title}`)}`,
      time,
      currency,
      title: e.title.trim(),
      impact: mapImpact(e.impact),
      forecast,
      previous,
    });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
