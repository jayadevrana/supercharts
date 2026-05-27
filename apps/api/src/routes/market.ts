import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IngestionContext } from '@supercharts/ingestion';
import type { Interval } from '@supercharts/types';
import { INTERVALS, INTERVAL_MS as INTERVAL_TO_MS } from '@supercharts/types';
import { buildVisibleRangeProfile } from '@supercharts/chart-core/pure';

const INTERVAL_SET = new Set<Interval>(INTERVALS);

const candleSchema = z.object({
  symbol: z.string().min(1),
  interval: z.string().refine((v) => INTERVAL_SET.has(v as Interval)),
  from: z.coerce.number().optional(),
  to: z.coerce.number().optional(),
  // Allow up to a full year of hourly bars (8760) plus a buffer.
  limit: z.coerce.number().min(1).max(20000).optional(),
});

export function marketRoutes(fastify: FastifyInstance, ctx: IngestionContext): void {
  fastify.get('/api/symbols/search', async (req) => {
    const { q = '', limit = 50 } = req.query as { q?: string; limit?: number };
    const lim = Number(limit) || 50;
    // Fan out to every provider in parallel — serial awaits added one network RTT per
    // provider to every keystroke in the symbol picker.
    const results = await Promise.all(
      Object.values(ctx.providers).map((p) => p.searchSymbols(q, lim).catch(() => [])),
    );
    return { items: results.flat().slice(0, lim) };
  });

  fastify.get('/api/symbols/:symbolId', async (req, reply) => {
    const symbolId = (req.params as { symbolId: string }).symbolId;
    for (const provider of Object.values(ctx.providers)) {
      const s = await provider.getSymbol(symbolId);
      if (s) return s;
    }
    reply.code(404);
    return { error: 'symbol_not_found' };
  });

  fastify.get('/api/candles', async (req, reply) => {
    const parsed = candleSchema.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_query', details: parsed.error.flatten() };
    }
    const { symbol, interval, from, to, limit } = parsed.data;
    const interval_ = interval as Interval;
    const provider = resolveProvider(symbol, ctx);

    // 1) Hit hot in-memory store first.
    const cached = ctx.candleStore.query(symbol, interval_, from, to, limit ?? 10000);

    // Decide whether the cache already covers the request. The cache is sufficient if
    // it spans the requested window OR if we have at least `limit` rows.
    const expected = (() => {
      if (from == null || to == null) return 0;
      const stepMs = INTERVAL_TO_MS[interval_];
      if (!stepMs) return 0;
      return Math.floor((to - from) / stepMs);
    })();
    const enough =
      cached.length > 0 &&
      ((expected > 0 && cached.length >= expected * 0.95) ||
        cached.length >= (limit ?? 500));
    if (enough) return { candles: cached, source: 'cache' };

    if (!provider) {
      return { candles: cached, source: 'cache' };
    }

    const fromMs = from ?? Date.now() - 7 * 24 * 60 * 60_000;
    const toMs = to ?? Date.now();
    try {
      const candles = await provider.fetchHistoricalCandles(
        symbol,
        interval_,
        fromMs,
        toMs,
        limit ?? 1000,
      );
      for (const c of candles) ctx.candleStore.upsert(symbol, interval_, c);
      // Subscribe to live updates so subsequent calls hit cache.
      ctx.subscriptions.acquire({ symbol, kind: 'candles', interval: interval_ });
      return {
        candles,
        source: 'provider',
        volumeKind: provider.capabilities.volumeKind,
      };
    } catch (err) {
      reply.code(502);
      return {
        candles: cached,
        source: 'cache',
        error: 'provider_error',
        message: String(err),
      };
    }
  });

  fastify.get('/api/volume-profile', async (req, reply) => {
    const schema = z.object({
      symbol: z.string(),
      interval: z.string().refine((v) => INTERVAL_SET.has(v as Interval)),
      from: z.coerce.number(),
      to: z.coerce.number(),
      rowSize: z.coerce.number().optional(),
      valueAreaPercent: z.coerce.number().optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_query' };
    }
    const { symbol, interval, from, to } = parsed.data;
    const rowSize = parsed.data.rowSize ?? estimateRowSize(symbol);
    const valueAreaPercent = parsed.data.valueAreaPercent ?? 0.7;
    const candles = ctx.candleStore.query(symbol, interval as Interval, from, to, 5000);
    const profile = buildVisibleRangeProfile(candles, rowSize, valueAreaPercent);
    return { mode: 'visible_range', symbol, fromTime: from, toTime: to, ...profile };
  });

  fastify.get('/api/heatmap', async (req, reply) => {
    const schema = z.object({ symbol: z.string(), limit: z.coerce.number().optional() });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_query' };
    }
    ctx.subscriptions.acquire({ symbol: parsed.data.symbol, kind: 'orderbook' });
    return {
      cells: ctx.heatmapAggregator.history(parsed.data.symbol, parsed.data.limit ?? 1500),
    };
  });

  fastify.get('/api/deep-trades', async (req, reply) => {
    const schema = z.object({ symbol: z.string(), limit: z.coerce.number().optional() });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_query' };
    }
    ctx.subscriptions.acquire({ symbol: parsed.data.symbol, kind: 'trades' });
    return {
      bubbles: ctx.deepTradeDetector.history(parsed.data.symbol, parsed.data.limit ?? 500),
    };
  });

  fastify.get('/api/provider-health', async () => {
    const arr = ctx.subscriptions.health();
    return { providers: arr };
  });

  fastify.get('/api/scanner/top-movers', async () => {
    // 24h ticker movers (Binance public, no key). Cached for 5s.
    const data = await topMovers();
    return { items: data };
  });

  /**
   * Bulk quote for an arbitrary list of canonical symbols. Drives the watchlist —
   * the top-movers endpoint only carries the symbols that *happen* to be moving today,
   * so most watchlist rows would render with no price. This endpoint fills every row.
   *
   * Hard-capped at MAX_QUOTE_SYMBOLS so a single client can't ask us to assemble a
   * multi-thousand-symbol upstream URL (Binance's `symbols=` param is bounded too).
   */
  fastify.get('/api/quotes', async (req, reply) => {
    const parsed = z
      .object({ symbols: z.string().optional() })
      .safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_query' };
    }
    const symbols = (parsed.data.symbols ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_QUOTE_SYMBOLS);
    if (symbols.length === 0) return { items: [] };
    const binanceSymbols = symbols
      .filter((s) => s.startsWith('BINANCE:'))
      .map((s) => s.slice('BINANCE:'.length));
    const items: Array<{ symbol: string; lastPrice: number; changePercent: number; quoteVolume: number }> = [];
    if (binanceSymbols.length > 0) {
      try {
        const url = new URL('https://api.binance.com/api/v3/ticker/24hr');
        url.searchParams.set('symbols', JSON.stringify(binanceSymbols));
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) });
        if (res.ok) {
          const raw = (await res.json()) as Array<{
            symbol: string;
            lastPrice: string;
            priceChangePercent: string;
            quoteVolume: string;
          }>;
          for (const r of raw) {
            items.push({
              symbol: `BINANCE:${r.symbol}`,
              lastPrice: Number(r.lastPrice),
              changePercent: Number(r.priceChangePercent),
              quoteVolume: Number(r.quoteVolume),
            });
          }
        }
      } catch {
        /* fall through — partial response is better than 502 for a watchlist quote */
      }
    }
    return { items };
  });
}

const MAX_QUOTE_SYMBOLS = 200;
const QUOTE_TIMEOUT_MS = 8_000;

function resolveProvider(symbol: string, ctx: IngestionContext) {
  const venue = symbol.split(':')[0]?.toLowerCase();
  if (!venue) return null;
  switch (venue) {
    case 'binance':
      return ctx.providers.binance;
    case 'oanda':
      return ctx.providers.oanda;
    case 'mock':
      return ctx.providers.mock;
    default:
      return null;
  }
}

function estimateRowSize(symbol: string): number {
  if (symbol.includes('BTC')) return 5;
  if (symbol.includes('ETH')) return 0.5;
  if (symbol.includes('SOL')) return 0.05;
  if (symbol.includes('USD')) return 0.0001;
  return 1;
}

const moversCache: { at: number; items: unknown[] } = { at: 0, items: [] };
// Coalesce concurrent callers: when the cache is stale, the first request fires the
// upstream fetch and every other caller awaits the same promise. Previously two
// near-simultaneous requests would both pass the TTL check and stampede Binance.
let moversInFlight: Promise<unknown[]> | null = null;

async function topMovers(): Promise<unknown[]> {
  const now = Date.now();
  if (now - moversCache.at < 5_000) return moversCache.items;
  if (moversInFlight) return moversInFlight;
  moversInFlight = (async (): Promise<unknown[]> => {
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr', {
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return moversCache.items;
      const raw = (await res.json()) as Array<{
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
        quoteVolume: string;
      }>;
      const items = raw
        .filter((r) => r.symbol.endsWith('USDT') && Number(r.quoteVolume) > 5_000_000)
        .map((r) => ({
          symbol: `BINANCE:${r.symbol}`,
          lastPrice: Number(r.lastPrice),
          changePercent: Number(r.priceChangePercent),
          quoteVolume: Number(r.quoteVolume),
        }))
        .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
        .slice(0, 40);
      moversCache.at = Date.now();
      moversCache.items = items;
      return items;
    } catch {
      return moversCache.items;
    } finally {
      moversInFlight = null;
    }
  })();
  return moversInFlight;
}
