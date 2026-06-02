/**
 * Economic calendar types (Phase 3 #13).
 *
 * Events come from a real, keyless macro-calendar feed and are surfaced as vertical markers
 * on the chart. `currency` carries the affected currency/region code as published (USD, EUR,
 * GBP, JPY, …) — the upstream feed labels this field "country" but its values are ISO currency
 * codes, which is what traders key off.
 */

export type EconomicImpact = 'high' | 'medium' | 'low' | 'holiday';

export interface EconomicEvent {
  id: string;
  /** Event time in UNIX ms (UTC). */
  time: number;
  /** Affected currency / region code, e.g. "USD". */
  currency: string;
  title: string;
  impact: EconomicImpact;
  /** Consensus forecast, as published (may be absent). */
  forecast?: string;
  /** Prior reading, as published (may be absent). */
  previous?: string;
}

export interface EconomicCalendarResult {
  events: EconomicEvent[];
  fetchedAt: number;
  /** `unavailable` when the upstream feed could not be reached — never fabricated. */
  status: 'ok' | 'unavailable';
  message?: string;
}
