import type { FastifyInstance } from 'fastify';

/**
 * Binance USD-M futures data (Open Interest). Public endpoints, no key. We proxy
 * them server-side so the browser never hits fapi directly (CORS) and so we can
 * cache — OI moves slowly, polling fapi per client would be wasteful + rate-limited.
 *
 * Only Binance spot symbols that have a USD-M perpetual resolve; anything else
 * (FX/metals via Yahoo, or a coin with no perp) returns `available: false` so the
 * UI shows "no data" rather than a fabricated series.
 */

const FAPI = 'https://fapi.binance.com';
const TTL_MS = 30_000;
const TIMEOUT_MS = 6_000;

interface OIPoint {
  time: number;
  openInterest: number;
}
interface OIResult {
  symbol: string;
  available: boolean;
  openInterest: number | null;
  time: number | null;
  history: OIPoint[];
}

const cache = new Map<string, { at: number; data: OIResult }>();

/** `BINANCE:BTCUSDT` → `BTCUSDT`; non-Binance symbols have no perp here. */
function futuresSymbol(symbol: string): string | null {
  if (!symbol.startsWith('BINANCE:')) return null;
  return symbol.slice('BINANCE:'.length).toUpperCase();
}

export function futuresRoutes(app: FastifyInstance): void {
  app.get('/api/futures/oi', async (req, reply) => {
    const symbol = String((req.query as { symbol?: string }).symbol ?? '');
    const fsym = futuresSymbol(symbol);
    const empty: OIResult = { symbol, available: false, openInterest: null, time: null, history: [] };
    if (!fsym) return empty;

    const hit = cache.get(fsym);
    const now = Date.now();
    if (hit && now - hit.at < TTL_MS) return hit.data;

    try {
      const [curRes, histRes] = await Promise.all([
        fetch(`${FAPI}/fapi/v1/openInterest?symbol=${fsym}`, { signal: AbortSignal.timeout(TIMEOUT_MS) }),
        fetch(`${FAPI}/futures/data/openInterestHist?symbol=${fsym}&period=5m&limit=48`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      ]);
      if (!curRes.ok) {
        // 400 here = the symbol has no USD-M perp. Cache the negative so we don't refetch.
        cache.set(fsym, { at: now, data: empty });
        return empty;
      }
      const cur = (await curRes.json()) as { openInterest: string; time: number };
      const hist = histRes.ok
        ? ((await histRes.json()) as Array<{ sumOpenInterest: string; timestamp: number }>)
        : [];
      const data: OIResult = {
        symbol,
        available: true,
        openInterest: Number(cur.openInterest),
        time: cur.time ?? now,
        history: hist
          .map((h) => ({ time: h.timestamp, openInterest: Number(h.sumOpenInterest) }))
          .filter((p) => Number.isFinite(p.openInterest)),
      };
      cache.set(fsym, { at: now, data });
      return data;
    } catch (err) {
      app.log.warn(`[futures] OI fetch failed for ${fsym}: ${String(err)}`);
      reply.code(200);
      return empty;
    }
  });
}
