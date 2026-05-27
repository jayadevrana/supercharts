import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import type { NewsItem, NewsResult, NewsSource, NewsTopic } from '@supercharts/types';

/**
 * News adapters.
 *
 * - GDELT: free, no key. Used for macro / geopolitical / inflation / central-bank coverage.
 * - CryptoPanic: requires CRYPTOPANIC_API_KEY. Returns crypto-specific news; without a key
 *   the adapter returns status `not_configured` and we fall back to GDELT-only.
 * - Finnhub: company / market news, requires FINNHUB_API_KEY.
 *
 * Every adapter normalizes to `NewsItem`. Multi-source queries dedupe by URL hash.
 */

interface CacheEntry {
  at: number;
  result: NewsResult;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

/**
 * GDELT rate limit: hard at 1 request per 5 seconds. We serialize requests through a
 * mutex and back off when we hit a 429, caching every successful payload for 5 minutes.
 */
const GDELT_MIN_INTERVAL_MS = 6_000;
let gdeltNextAllowedAt = 0;
let gdeltInFlight: Promise<NewsItem[]> | null = null;
const gdeltCache = new Map<string, { at: number; items: NewsItem[] }>();
const GDELT_CACHE_TTL_MS = 5 * 60_000;

export function newsRoutes(fastify: FastifyInstance, db: AppDB, env: NodeJS.ProcessEnv): void {
  fastify.get('/api/news/latest', async (req) => {
    const schema = z.object({
      symbols: z.string().optional(),
      topics: z.string().optional(),
      query: z.string().optional(),
      source: z.string().optional(),
      limit: z.coerce.number().optional(),
    });
    const q = schema.parse(req.query);
    const symbols = q.symbols ? q.symbols.split(',') : [];
    const topics = (q.topics ? q.topics.split(',') : ['macro', 'crypto', 'forex']) as NewsTopic[];
    const key = JSON.stringify({ symbols, topics, query: q.query, source: q.source });
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.result;

    const tasks: Array<Promise<NewsItem[]>> = [];
    if (!q.source || q.source === 'gdelt') tasks.push(fetchGdelt(q.query, topics));
    if (!q.source || q.source === 'cryptopanic') tasks.push(fetchCryptoPanic(env, symbols));
    if (!q.source || q.source === 'finnhub') tasks.push(fetchFinnhub(env, symbols));

    const all = (await Promise.allSettled(tasks))
      .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      .sort((a, b) => b.publishedAt - a.publishedAt);

    const deduped = dedupeNews(all).slice(0, q.limit ?? 50);
    const result: NewsResult = {
      items: deduped,
      fetchedAt: Date.now(),
      source: 'aggregated',
      status: 'ok',
    };
    cache.set(key, { at: Date.now(), result });
    return result;
  });

  fastify.get('/api/news/symbol/:symbol', async (req) => {
    const symbol = (req.params as { symbol: string }).symbol;
    const items = await fetchAggregated(env, [symbol], ['macro', 'crypto', 'forex'], undefined, 40);
    return { items, source: 'aggregated', status: 'ok' };
  });

  fastify.get('/api/news/macro', async () => {
    const items = await fetchAggregated(env, [], ['macro', 'central_bank', 'inflation', 'rates', 'geopolitical'], undefined, 50);
    return { items, source: 'aggregated', status: 'ok' };
  });

  fastify.post('/api/news/save', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = z.object({ newsId: z.string(), payload: z.any() }).safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload' };
    }
    db.raw
      .prepare(
        'INSERT OR REPLACE INTO news_saved_items (id, user_id, news_id, payload, saved_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(nanoid(), user.id, parsed.data.newsId, JSON.stringify(parsed.data.payload), Date.now());
    return { ok: true };
  });

  fastify.delete('/api/news/save/:id', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM news_saved_items WHERE news_id = ? AND user_id = ?').run(id, user.id);
    return { ok: true };
  });
}

async function fetchAggregated(
  env: NodeJS.ProcessEnv,
  symbols: string[],
  topics: NewsTopic[],
  query: string | undefined,
  limit: number,
): Promise<NewsItem[]> {
  const tasks: Array<Promise<NewsItem[]>> = [
    fetchGdelt(query, topics),
    fetchCryptoPanic(env, symbols),
    fetchFinnhub(env, symbols),
  ];
  const all = (await Promise.allSettled(tasks))
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .sort((a, b) => b.publishedAt - a.publishedAt);
  return dedupeNews(all).slice(0, limit);
}

function dedupeNews(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const item of items) {
    const key = `${item.url}|${item.title.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function fetchGdelt(query: string | undefined, topics: NewsTopic[]): Promise<NewsItem[]> {
  const terms = query ?? buildGdeltTerms(topics);
  const cacheKey = terms;
  const cached = gdeltCache.get(cacheKey);
  if (cached && Date.now() - cached.at < GDELT_CACHE_TTL_MS) return cached.items;

  // Coalesce concurrent requests — one in-flight at a time across ALL cache keys.
  if (gdeltInFlight) {
    try {
      await gdeltInFlight;
    } catch {
      /* fall through */
    }
    const second = gdeltCache.get(cacheKey);
    if (second) return second.items;
  }

  const wait = Math.max(0, gdeltNextAllowedAt - Date.now());
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }

  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', terms);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', '40');
  url.searchParams.set('sort', 'DateDesc');

  // Assign `gdeltInFlight` BEFORE invoking the async IIFE. Previously the assignment
  // happened on the next line, which meant a synchronous throw inside the IIFE could
  // leave `finally` to clear nothing meaningful while concurrent callers raced past
  // the in-flight check.
  let runResolve: (v: NewsItem[]) => void = () => {};
  const runPromise = new Promise<NewsItem[]>((resolve) => {
    runResolve = resolve;
  });
  gdeltInFlight = runPromise;
  void (async (): Promise<void> => {
    try {
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
      gdeltNextAllowedAt = Date.now() + GDELT_MIN_INTERVAL_MS;
      if (res.status === 429) {
        // Back off harder when GDELT explicitly rate-limits us.
        gdeltNextAllowedAt = Date.now() + 30_000;
        runResolve(cached?.items ?? []);
        return;
      }
      if (!res.ok) {
        runResolve(cached?.items ?? []);
        return;
      }
      const data = (await res.json()) as {
        articles?: Array<{ url: string; title: string; seendate: string; socialimage?: string }>;
      };
      const items: NewsItem[] = (data.articles ?? []).map((a) => ({
        id: hash(a.url),
        source: 'gdelt' as NewsSource,
        publishedAt: parseGdeltDate(a.seendate),
        title: a.title,
        url: a.url,
        imageUrl: a.socialimage,
        summary: undefined,
        symbols: [],
        topics,
        sentiment: null,
        relevance: 0.7,
      }));
      gdeltCache.set(cacheKey, { at: Date.now(), items });
      runResolve(items);
    } catch {
      runResolve(cached?.items ?? []);
    } finally {
      if (gdeltInFlight === runPromise) gdeltInFlight = null;
    }
  })();
  return runPromise;
}

function buildGdeltTerms(topics: NewsTopic[]): string {
  const baseMap: Record<NewsTopic, string> = {
    macro: '(inflation OR "interest rates" OR Fed OR ECB OR BOJ)',
    crypto: '(bitcoin OR ethereum OR crypto)',
    forex: '(EURUSD OR GBPUSD OR USDJPY OR DXY OR "US dollar")',
    central_bank: '(Federal Reserve OR ECB OR BOJ OR PBoC OR "central bank")',
    inflation: '(CPI OR PCE OR inflation)',
    rates: '("interest rate" OR FOMC OR "rate decision")',
    geopolitical: '(war OR sanctions OR OPEC OR election)',
    commodity: '(gold OR oil OR copper OR silver)',
    equity: '(S&P OR Nasdaq OR "stock market")',
    regulation: '(SEC OR CFTC OR regulation OR ban)',
    protocol: '(Ethereum OR Solana OR upgrade OR fork)',
    security: '(hack OR exploit OR exchange)',
    earnings: '(earnings OR "quarterly results")',
  };
  const parts = topics.map((t) => baseMap[t]).filter(Boolean);
  return parts.length === 0 ? 'finance' : parts.join(' OR ');
}

function parseGdeltDate(s: string): number {
  // Format: YYYYMMDDhhmmss
  if (!s || s.length < 14) return Date.now();
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  const hh = Number(s.slice(8, 10));
  const mm = Number(s.slice(10, 12));
  const ss = Number(s.slice(12, 14));
  return Date.UTC(y, m, d, hh, mm, ss);
}

async function fetchCryptoPanic(env: NodeJS.ProcessEnv, symbols: string[]): Promise<NewsItem[]> {
  const key = env.CRYPTOPANIC_API_KEY;
  if (!key) return [];
  const url = new URL('https://cryptopanic.com/api/v1/posts/');
  url.searchParams.set('auth_token', key);
  url.searchParams.set('public', 'true');
  if (symbols.length > 0) {
    const currencies = symbols
      .map((s) => s.split(':')[1]?.replace(/USDT|USD/g, ''))
      .filter((s): s is string => Boolean(s));
    if (currencies.length > 0) url.searchParams.set('currencies', currencies.join(','));
  }
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ id: number; title: string; url: string; published_at: string; source?: { title: string }; votes?: { positive: number; negative: number; important: number } }> };
    return (data.results ?? []).map((r) => ({
      id: `cp_${r.id}`,
      source: 'cryptopanic' as NewsSource,
      publishedAt: new Date(r.published_at).getTime(),
      title: r.title,
      url: r.url,
      summary: r.source?.title,
      symbols,
      topics: ['crypto'],
      sentiment:
        r.votes && r.votes.positive + r.votes.negative > 0
          ? (r.votes.positive - r.votes.negative) / (r.votes.positive + r.votes.negative + 1)
          : null,
      relevance: 0.85,
    }));
  } catch {
    return [];
  }
}

async function fetchFinnhub(env: NodeJS.ProcessEnv, symbols: string[]): Promise<NewsItem[]> {
  const key = env.FINNHUB_API_KEY;
  if (!key) return [];
  const url = new URL('https://finnhub.io/api/v1/news');
  url.searchParams.set('category', 'general');
  url.searchParams.set('token', key);
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ id: number; headline: string; summary: string; source: string; url: string; datetime: number; image: string; related: string }>;
    return data.map((r) => ({
      id: `fh_${r.id}`,
      source: 'finnhub' as NewsSource,
      publishedAt: r.datetime * 1000,
      title: r.headline,
      url: r.url,
      summary: r.summary,
      imageUrl: r.image,
      // Finnhub returns equity tickers in `related` (e.g. "AAPL,MSFT"). Prefix with a
      // canonical venue so downstream symbol-resolvers don't drop them. The previous
      // `:${s}` produced ":AAPL", which is not a valid canonical id anywhere.
      symbols: r.related
        ? r.related.split(',').map((s) => s.trim()).filter(Boolean).map((s) => `FINNHUB:${s}`)
        : symbols,
      topics: ['macro', 'equity'],
      sentiment: null,
      relevance: 0.6,
    }));
  } catch {
    return [];
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `n_${(h >>> 0).toString(36)}`;
}
