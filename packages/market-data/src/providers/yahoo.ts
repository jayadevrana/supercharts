import type {
  Candle,
  Interval,
  ProviderCapabilities,
  ProviderHealthStatus,
  Symbol as MarketSymbol,
} from '@supercharts/types';
import { INTERVAL_MS, OANDA_INSTRUMENTS, getCatalogSymbol } from '@supercharts/types';
import {
  TinyEmitter,
  type MarketDataProvider,
  type SubscriptionHandle,
  type Unsubscribe,
} from '../provider';

/**
 * Yahoo Finance adapter — FREE forex / metals / indices data, no API key, no signup.
 *
 * Uses the public `query1.finance.yahoo.com/v8/finance/chart` endpoint that powers
 * the Yahoo Finance website. Covers everything OANDA would (FX majors/minors/crosses,
 * gold/silver/platinum, major cash indices) at zero cost.
 *
 * HONEST LIMITATIONS (surfaced in capabilities + UI):
 *   - Unofficial endpoint. IP rate-limited; can change/break without notice. Fine for
 *     a personal terminal, NOT a redistribution-grade feed.
 *   - REST poll only — no real-time stream. We poll per (interval / 4), min 15s.
 *   - FX has no real exchange volume (Yahoo reports 0); volumeKind is `tick`.
 *   - Indices only print during their cash session; FX is 24×5; metal futures ~23×5.
 *   - Data is delayed (≈ real-time for FX, up to ~15 min for some indices).
 *
 * Symbol mapping: our catalog uses OANDA-style ids (`OANDA:EUR_USD`). This provider
 * accepts those (and bare `EUR_USD`) and translates to the Yahoo ticker.
 */

const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

/** Yahoo only supports a fixed interval set. Map ours → theirs; unsupported throw. */
const INTERVAL_TO_YAHOO: Partial<Record<Interval, string>> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '60m',
  '1d': '1d',
  '1w': '1wk',
  '1mo': '1mo',
  // Yahoo has no native 2h/4h/6h/12h — those intervals are unsupported here.
};

/**
 * Explicit Yahoo tickers for metals + indices (FX is derived: strip `_`, add `=X`).
 * Keyed by the OANDA raw symbol.
 */
const SPECIAL_TICKERS: Record<string, string> = {
  // Metals — front-month futures (continuous), ~23h trading.
  XAU_USD: 'GC=F',
  XAG_USD: 'SI=F',
  XPT_USD: 'PL=F',
  // Indices — cash indices.
  SPX500_USD: '^GSPC',
  NAS100_USD: '^IXIC',
  US30_USD: '^DJI',
  UK100_GBP: '^FTSE',
  DE30_EUR: '^GDAXI',
  FR40_EUR: '^FCHI',
  EU50_EUR: '^STOXX50E',
  JP225_USD: '^N225',
  AU200_AUD: '^AXJO',
  HK33_HKD: '^HSI',
};

/** All OANDA raws this provider can serve (FX derived + specials). */
const SUPPORTED_RAWS = new Set<string>([...OANDA_INSTRUMENTS, ...Object.keys(SPECIAL_TICKERS)]);

export interface YahooProviderOptions {
  fetchFn?: typeof fetch;
}

export class YahooProvider implements MarketDataProvider {
  public readonly id = 'yahoo' as const;
  public readonly capabilities: ProviderCapabilities = {
    trades: false,
    quotes: false,
    orderBook: false,
    orderBookDepth: 0,
    candles: true,
    historicalCandles: true,
    historicalTrades: false,
    news: false,
    // FX carries no real volume on Yahoo; indices/futures do but we don't lean on it.
    volumeKind: 'tick',
    assetClasses: ['forex', 'commodity', 'index'],
  };

  private fetchFn: typeof fetch;
  private health$ = new TinyEmitter<ProviderHealthStatus>();
  private currentHealth: ProviderHealthStatus = {
    provider: 'yahoo',
    venue: 'YAHOO',
    status: 'disconnected',
    subscriptions: 0,
    lastMessageAt: null,
    latencyMs: null,
    reconnects: 0,
  };
  private polls = new Map<string, ReturnType<typeof setInterval>>();

  constructor(opts: YahooProviderOptions = {}) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  /** Map an incoming id (`OANDA:EUR_USD`, `EUR_USD`, or already-canonical) to OANDA raw. */
  normalizeSymbol(input: string): string {
    const stripped = input.includes(':') ? (input.split(':')[1] ?? input) : input;
    return stripped.toUpperCase();
  }

  /** OANDA raw → Yahoo ticker. */
  private toYahoo(raw: string): string | null {
    if (SPECIAL_TICKERS[raw]) return SPECIAL_TICKERS[raw];
    // FX: EUR_USD → EURUSD=X
    if (/^[A-Z]{3}_[A-Z]{3}$/.test(raw)) return `${raw.replace('_', '')}=X`;
    return null;
  }

  async connect(): Promise<void> {
    this.updateHealth({ status: 'connected', lastMessageAt: Date.now() });
  }

  async disconnect(): Promise<void> {
    for (const t of this.polls.values()) clearInterval(t);
    this.polls.clear();
    this.updateHealth({ status: 'disconnected' });
  }

  health(): ProviderHealthStatus {
    return this.currentHealth;
  }

  onHealth(cb: (h: ProviderHealthStatus) => void): Unsubscribe {
    return this.health$.on(cb);
  }

  async searchSymbols(query: string, limit = 50): Promise<MarketSymbol[]> {
    const q = normalizeSearchQuery(query);
    const raws = [...SUPPORTED_RAWS];
    return raws
      .filter((r) => !q || r.includes(q) || r.replace('_', '').includes(q))
      .slice(0, limit)
      .map((r) => this.buildSymbol(r));
  }

  async getSymbol(id: string): Promise<MarketSymbol | null> {
    const raw = this.normalizeSymbol(id);
    if (!this.toYahoo(raw)) return null;
    return this.buildSymbol(raw);
  }

  subscribeTrades(symbol: string): SubscriptionHandle {
    return noopHandle(symbol); // Yahoo exposes no trade prints.
  }

  subscribeQuotes(symbol: string): SubscriptionHandle {
    return noopHandle(symbol);
  }

  subscribeOrderBook(symbol: string): SubscriptionHandle {
    return noopHandle(symbol); // No book for FX/indices.
  }

  subscribeCandles(symbol: string, interval: Interval, cb: (c: Candle) => void): SubscriptionHandle {
    const raw = this.normalizeSymbol(symbol);
    if (!this.toYahoo(raw) || !INTERVAL_TO_YAHOO[interval]) return noopHandle(symbol);
    const stepMs = INTERVAL_MS[interval] ?? 60_000;
    // Poll a quarter-bar, min 15s, max 5 min — friendly to Yahoo's rate limits.
    const pollMs = Math.min(300_000, Math.max(15_000, Math.floor(stepMs / 4)));
    const key = `${raw}:${interval}`;

    let lastEmittedOpen = 0;
    const tick = async (): Promise<void> => {
      try {
        // Pull the most recent handful of bars; emit any we haven't seen yet.
        const now = Date.now();
        const candles = await this.fetchHistoricalCandles(symbol, interval, now - stepMs * 6, now, 6);
        for (const c of candles) {
          if (c.openTime < lastEmittedOpen) continue;
          lastEmittedOpen = c.openTime;
          cb(c);
        }
        this.updateHealth({ status: 'connected', lastMessageAt: Date.now() });
      } catch (err) {
        this.updateHealth({ status: 'degraded', message: `Yahoo poll ${String(err).slice(0, 80)}` });
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), pollMs);
    this.polls.set(key, timer);

    return {
      symbol,
      unsubscribe: () => {
        const t = this.polls.get(key);
        if (t) clearInterval(t);
        this.polls.delete(key);
      },
    };
  }

  async fetchHistoricalCandles(
    symbol: string,
    interval: Interval,
    from: number,
    to: number,
    limit = 1000,
  ): Promise<Candle[]> {
    const raw = this.normalizeSymbol(symbol);
    const ticker = this.toYahoo(raw);
    const yInterval = INTERVAL_TO_YAHOO[interval];
    if (!ticker || !yInterval) return [];
    const stepMs = INTERVAL_MS[interval] ?? 60_000;

    // Yahoo accepts period1/period2 as epoch SECONDS. Pad the window so we reliably
    // cover the requested span; trim to `limit` after.
    const period1 = Math.floor(from / 1000);
    const period2 = Math.ceil(to / 1000);
    const url = new URL(`${YAHOO_CHART}/${encodeURIComponent(ticker)}`);
    url.searchParams.set('interval', yInterval);
    url.searchParams.set('period1', String(period1));
    url.searchParams.set('period2', String(period2));
    url.searchParams.set('includePrePost', 'false');

    const res = await this.fetchFn(url.toString(), {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`Yahoo chart ${res.status} for ${ticker}`);
    }
    const json = (await res.json()) as YahooChartResponse;
    const result = json.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) return [];

    const ts = result.timestamp;
    const q = result.indicators.quote[0];
    const now = Date.now();
    const out: Candle[] = [];
    for (let i = 0; i < ts.length; i += 1) {
      const o = q.open[i];
      const h = q.high[i];
      const l = q.low[i];
      const c = q.close[i];
      // Yahoo leaves gaps as null (holidays, illiquid bars). Skip incomplete rows.
      if (o == null || h == null || l == null || c == null) continue;
      const openTime = ts[i]! * 1000;
      const vol = q.volume[i] ?? 0;
      out.push({
        symbol: `OANDA:${raw}`,
        provider: 'yahoo',
        venue: 'YAHOO',
        interval,
        openTime,
        closeTime: openTime + stepMs - 1,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: vol,
        quoteVolume: vol * ((o + c) / 2),
        buyVolume: 0,
        sellVolume: 0,
        delta: 0,
        trades: 0,
        vwap: (h + l + c) / 3,
        // The final bar is still forming until its bucket end passes. The alert engine
        // relies on this to fire only on closed bars.
        isClosed: openTime + stepMs <= now,
        volumeKind: 'tick',
      });
    }
    return out.slice(-limit);
  }

  private buildSymbol(raw: string): MarketSymbol {
    const catalog = getCatalogSymbol(`OANDA:${raw}`);
    const category = catalog?.category;
    const isMetal = raw.startsWith('XAU') || raw.startsWith('XAG') || raw.startsWith('XPT');
    const isIndex = category === 'index';
    const isJpy = raw.includes('JPY');
    const [base, quote] = raw.split('_');
    return {
      id: `OANDA:${raw}`,
      rawSymbol: raw,
      base: base ?? raw,
      quote: quote ?? 'USD',
      venue: 'YAHOO',
      provider: 'yahoo',
      assetClass: isIndex ? 'index' : isMetal ? 'commodity' : 'forex',
      type: isIndex ? 'index' : isMetal ? 'commodity' : 'forex',
      tickSize: isIndex ? 0.1 : isMetal ? 0.01 : isJpy ? 0.001 : 0.00001,
      lotSize: isIndex || isMetal ? 1 : 1000,
      pricePrecision: isIndex ? 1 : isMetal ? 2 : isJpy ? 3 : 5,
      quantityPrecision: 0,
      session: isIndex ? `${catalog?.label ?? raw} session` : isMetal ? 'Metals ~23x5' : 'Forex 24x5',
      timezone: 'UTC',
      status: 'trading',
    };
  }

  private updateHealth(patch: Partial<ProviderHealthStatus>): void {
    this.currentHealth = {
      ...this.currentHealth,
      ...patch,
      provider: 'yahoo',
      venue: 'YAHOO',
      subscriptions: this.polls.size,
    };
    this.health$.emit(this.currentHealth);
  }
}

function noopHandle(symbol: string): SubscriptionHandle {
  return { symbol, unsubscribe: () => {} };
}

function normalizeSearchQuery(query: string): string {
  const q = query.trim().toUpperCase();
  return q.includes(':') ? q.split(':').at(-1)!.replace(/[^A-Z0-9]/g, '') : q.replace(/[^A-Z0-9]/g, '');
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }>;
      };
    }>;
    error?: unknown;
  };
}
