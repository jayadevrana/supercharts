import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EconomicCalendarResult } from '@supercharts/types';
import { normalizeEconomicEvents, type RawCalendarEvent } from '../economic-calendar';

/**
 * Economic calendar (Phase 3 #13). Serves this week's macro events from a real, keyless feed
 * (the published Forex Factory weekly JSON mirror). Cached for 30 min — the weekly feed changes
 * slowly and the upstream rate-limits aggressive polling. On a fetch failure we serve the last
 * good cache if we have one, otherwise an honest `unavailable` status — events are never faked.
 */
const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const TTL_MS = 30 * 60_000;

let cache: { at: number; result: EconomicCalendarResult } | null = null;

function filterByImpact(result: EconomicCalendarResult, impact?: string): EconomicCalendarResult {
  if (!impact) return result;
  const allow = new Set(impact.split(',').map((s) => s.trim().toLowerCase()));
  return { ...result, events: result.events.filter((e) => allow.has(e.impact)) };
}

export function calendarRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/calendar/economic', async (req) => {
    const q = z.object({ impact: z.string().optional() }).parse(req.query);

    if (cache && Date.now() - cache.at < TTL_MS) return filterByImpact(cache.result, q.impact);

    try {
      const res = await fetch(FEED_URL, {
        headers: { 'User-Agent': 'SuperCharts/1.0 (+charts terminal)' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`feed ${res.status}`);
      const raw = (await res.json()) as RawCalendarEvent[];
      const result: EconomicCalendarResult = {
        events: normalizeEconomicEvents(raw),
        fetchedAt: Date.now(),
        status: 'ok',
      };
      cache = { at: Date.now(), result };
      return filterByImpact(result, q.impact);
    } catch {
      // Prefer the last good payload over an empty one; otherwise surface honest unavailability.
      if (cache) return filterByImpact(cache.result, q.impact);
      const result: EconomicCalendarResult = {
        events: [],
        fetchedAt: Date.now(),
        status: 'unavailable',
        message: 'Economic calendar feed is unavailable right now.',
      };
      return result;
    }
  });
}
