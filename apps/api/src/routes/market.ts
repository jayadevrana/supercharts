import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IngestionContext } from '@supercharts/ingestion';
import type { Interval } from '@supercharts/types';
import {
  CATEGORY_ORDER,
  INTERVALS,
  INTERVAL_MS as INTERVAL_TO_MS,
  getCatalogSymbol,
} from '@supercharts/types';
import type { MarketDataProvider } from '@supercharts/market-data';
import { buildVisibleRangeProfile } from '@supercharts/chart-core/pure';
import type { FastifyRequest } from 'fastify';
import type { AppDB } from '../db';
import { getOptionalUser } from '../auth';
import { hasActiveConnection } from '../broker/store';

const INTERVAL_SET = new Set<Interval>(INTERVALS);

const candleSchema = z.object({
  symbol: z.string().min(1),
  interval: z.string().refine((v) => INTERVAL_SET.has(v as Interval)),
  from: z.coerce.number().optional(),
  to: z.coerce.number().optional(),
  // Allow up to a full year of hourly bars (8760) plus a buffer.
  limit: z.coerce.number().min(1).max(20000).optional(),
});

export function marketRoutes(fastify: FastifyInstance, ctx: IngestionContext, db?: AppDB): void {
  // Compliance (BYOB spec §3.7-2): KITE data is the connected user's OWN broker feed — it is
  // never served to anyone without their own active connection. Without a db (unit contexts)
  // the gate fails closed.
  const canSeeKite = (req: FastifyRequest): boolean => {
    if (!db) return false;
    const user = getOptionalUser(req, db);
    return hasActiveConnection(db, user?.id, 'kite');
  };

  fastify.get('/api/symbols/search', async (req) => {
    const { q = '', limit = 50 } = req.query as { q?: string; limit?: number };
    const lim = Number(limit) || 50;
    const kiteOk = canSeeKite(req);
    // Fan out to every provider in parallel — serial awaits added one network RTT per
    // provider to every keystroke in the symbol picker.
    const results = await Promise.all(
      Object.values(ctx.providers).map((p) => p.searchSymbols(q, lim).catch(() => [])),
    );
    const items = results
      .flat()
      .filter((s) => kiteOk || !s.id.startsWith('KITE:'))
      .sort((a, b) => {
      const ac = getCatalogSymbol(a.id);
      const bc = getCatalogSymbol(b.id);
      if (ac && !bc) return -1;
      if (!ac && bc) return 1;
      if (ac && bc) {
        const cat = CATEGORY_ORDER.indexOf(ac.category) - CATEGORY_ORDER.indexOf(bc.category);
        if (cat !== 0) return cat;
        return ac.sort - bc.sort;
      }
      return 0;
    });
    return { items: items.slice(0, lim) };
  });

  fastify.get('/api/symbols/:symbolId', async (req, reply) => {
    const symbolId = (req.params as { symbolId: string }).symbolId;
    if (symbolId.startsWith('KITE:') && !canSeeKite(req)) {
      reply.code(403);
      return { error: 'broker_connection_required', message: 'Connect your own Zerodha account to view Indian market data.' };
    }
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
    if (symbol.startsWith('KITE:') && !canSeeKite(req)) {
      reply.code(403);
      return { error: 'broker_connection_required', message: 'Connect your own Zerodha account to view Indian market data.' };
    }
    const interval_ = interval as Interval;
    const now = Date.now();
    const requestedFrom = from ?? now - 7 * 24 * 60 * 60_000;
    const toMs = to ?? now;
    // Kite's configured history policy is exactly one year. Keep this clamp server-side so
    // every caller (chart, scan, curl, or a future UI) observes the same storage budget.
    const fromMs = symbol.startsWith('KITE:')
      ? Math.max(requestedFrom, now - 365 * 24 * 60 * 60_000)
      : requestedFrom;

    // Custom CSV-imported datasets (Phase 3 #14) live only in the cache under a CUSTOM: venue.
    // Serve every stored row regardless of the requested window so historical uploads chart even
    // when the client asks for "the last N bars from now".
    if (symbol.startsWith('CUSTOM:')) {
      const all = ctx.candleStore.query(symbol, interval_, undefined, undefined, limit ?? 20000);
      return { candles: all, source: 'custom' };
    }

    const provider = resolveProvider(symbol, ctx);

    // 1) Hit hot in-memory store first.
    const cached = ctx.candleStore.query(symbol, interval_, fromMs, toMs, limit ?? 10000);

    // Decide whether the cache already covers the request. The cache is sufficient if
    // it spans the requested window OR if we have at least `limit` rows.
    const expected = (() => {
      const stepMs = INTERVAL_TO_MS[interval_];
      if (!stepMs) return 0;
      return Math.floor((toMs - fromMs) / stepMs);
    })();
    const enough =
      cached.length > 0 &&
      ((expected > 0 && cached.length >= expected * 0.95) ||
        cached.length >= (limit ?? 500));
    if (enough) return { candles: cached, source: 'cache' };

    if (!provider) {
      return { candles: cached, source: 'cache' };
    }

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
    const items: QuoteItem[] = [];
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
    const providerQuoteSymbols = symbols.filter((s) => !s.startsWith('BINANCE:'));
    if (providerQuoteSymbols.length > 0) {
      const settled = await Promise.allSettled(
        providerQuoteSymbols.map((symbol) => providerQuote(symbol, ctx)),
      );
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) items.push(r.value);
      }
    }
    return { items };
  });
}

const MAX_QUOTE_SYMBOLS = 200;
const QUOTE_TIMEOUT_MS = 8_000;
const PROVIDER_QUOTE_TTL_MS = 30_000;
const PROVIDER_QUOTE_TIMEOUT_MS = 3_500;
type QuoteItem = { symbol: string; lastPrice: number; changePercent: number; quoteVolume: number };
const providerQuoteCache = new Map<string, { at: number; item: QuoteItem }>();

async function providerQuote(symbol: string, ctx: IngestionContext): Promise<QuoteItem | null> {
  const cached = providerQuoteCache.get(symbol);
  const now = Date.now();
  if (cached && now - cached.at < PROVIDER_QUOTE_TTL_MS) return cached.item;
  const provider = resolveProvider(symbol, ctx);
  if (!provider?.capabilities.historicalCandles) return null;

  const item = await withTimeout(fetchProviderQuote(symbol, provider), PROVIDER_QUOTE_TIMEOUT_MS).catch(() => null);
  if (item) providerQuoteCache.set(symbol, { at: Date.now(), item });
  return item;
}

async function fetchProviderQuote(symbol: string, provider: MarketDataProvider): Promise<QuoteItem | null> {
  const now = Date.now();
  const lookback = 5 * 24 * 60 * 60_000;
  const candles = await provider.fetchHistoricalCandles(symbol, '1m', now - lookback, now, 2);
  const last = candles[candles.length - 1];
  if (!last || !Number.isFinite(last.close)) return null;
  const prev = candles.length >= 2 ? candles[candles.length - 2] : undefined;
  const base = prev?.close ?? last.open;
  const changePercent = base ? ((last.close - base) / base) * 100 : 0;
  return {
    symbol,
    lastPrice: last.close,
    changePercent,
    quoteVolume: last.quoteVolume ?? last.volume ?? 0,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('provider_quote_timeout')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function resolveProvider(symbol: string, ctx: IngestionContext) {
  const venue = symbol.split(':')[0]?.toLowerCase();
  if (!venue) return null;
  switch (venue) {
    case 'binance':
      return ctx.providers.binance;
    case 'oanda':
      return ctx.providers.oanda;
    case 'kite':
      return ctx.providers.kite;
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
