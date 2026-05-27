import type {
  Candle,
  Interval,
  OrderBookDelta,
  ProviderCapabilities,
  ProviderHealthStatus,
  QuoteTick,
  Symbol as MarketSymbol,
  TradeTick,
} from '@supercharts/types';
import { OANDA_INSTRUMENTS, getCatalogSymbol } from '@supercharts/types';
import {
  TinyEmitter,
  type MarketDataProvider,
  type SubscriptionHandle,
  type Unsubscribe,
} from '../provider';

/**
 * OANDA forex adapter.
 *
 * NOTE — this adapter is implemented as a *configured* skeleton: it ships the full
 * surface area (capabilities, normalize, stub methods, health), and turns active when
 * an OANDA_API_TOKEN + OANDA_ACCOUNT_ID are present in the environment.
 *
 * OANDA exposes a pricing-stream endpoint that emits PRICE events with bid/ask ladders.
 * Spot forex is decentralized — `volumeKind` is `tick` because OANDA does not provide
 * real exchange volume. We label it honestly in the UI rather than fabricating it.
 *
 * Full live implementation is delivered in a follow-up phase. Without a key, this
 * adapter reports status `not_configured` and the UI surfaces a setup state.
 */

const OANDA_PRACTICE_API = 'https://api-fxpractice.oanda.com';
const OANDA_PRACTICE_STREAM = 'https://stream-fxpractice.oanda.com';
const OANDA_LIVE_API = 'https://api-fxtrade.oanda.com';
const OANDA_LIVE_STREAM = 'https://stream-fxtrade.oanda.com';

/**
 * Whitelisted OANDA instruments. We deliberately import this from the shared symbol
 * catalog so the watchlist, alerts builder, and provider can never drift apart — one
 * file decides what we support.
 *
 * Anything not in this set is rejected at `searchSymbols` / `getSymbol` so a request
 * for an exotic doesn't accidentally hit OANDA and return spurious data.
 */
const SUPPORTED_INSTRUMENTS: readonly string[] = OANDA_INSTRUMENTS;

const INTERVAL_TO_OANDA: Partial<Record<Interval, string>> = {
  '5s': 'S5',
  '15s': 'S15',
  '30s': 'S30',
  '1m': 'M1',
  '5m': 'M5',
  '15m': 'M15',
  '30m': 'M30',
  '1h': 'H1',
  '2h': 'H2',
  '4h': 'H4',
  '12h': 'H12',
  '1d': 'D',
  '1w': 'W',
  '1mo': 'M',
};

export interface OandaProviderOptions {
  apiToken?: string;
  accountId?: string;
  env?: 'practice' | 'live';
  fetchFn?: typeof fetch;
}

export class OandaProvider implements MarketDataProvider {
  public readonly id = 'oanda' as const;
  public readonly capabilities: ProviderCapabilities = {
    trades: false,
    quotes: true,
    orderBook: false,
    orderBookDepth: 0,
    candles: true,
    historicalCandles: true,
    historicalTrades: false,
    news: false,
    volumeKind: 'tick',
    assetClasses: ['forex'],
  };

  private readonly apiToken?: string;
  private readonly accountId?: string;
  private readonly apiUrl: string;
  private readonly streamUrl: string;
  private readonly fetchFn: typeof fetch;
  private health$ = new TinyEmitter<ProviderHealthStatus>();
  private currentHealth: ProviderHealthStatus;
  private streamSub: AbortController | null = null;
  private quoteCallbacks = new Map<string, Set<(q: QuoteTick) => void>>();

  constructor(opts: OandaProviderOptions = {}) {
    this.apiToken = opts.apiToken;
    this.accountId = opts.accountId;
    const env = opts.env ?? 'practice';
    this.apiUrl = env === 'live' ? OANDA_LIVE_API : OANDA_PRACTICE_API;
    this.streamUrl = env === 'live' ? OANDA_LIVE_STREAM : OANDA_PRACTICE_STREAM;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.currentHealth = {
      provider: 'oanda',
      venue: 'OANDA',
      status: this.isConfigured() ? 'disconnected' : 'not_configured',
      lastMessageAt: null,
      latencyMs: null,
      reconnects: 0,
      subscriptions: 0,
      message: this.isConfigured()
        ? undefined
        : 'OANDA_API_TOKEN and OANDA_ACCOUNT_ID must be set to enable live forex.',
    };
  }

  private isConfigured(): boolean {
    return Boolean(this.apiToken && this.accountId);
  }

  health(): ProviderHealthStatus {
    return { ...this.currentHealth, subscriptions: this.quoteCallbacks.size };
  }

  onHealth(cb: (h: ProviderHealthStatus) => void): Unsubscribe {
    return this.health$.on(cb);
  }

  normalizeSymbol(input: string): string {
    const stripped = input.includes(':') ? (input.split(':')[1] ?? input) : input;
    return stripped.toUpperCase().replace(/[-/]/g, '_');
  }

  async searchSymbols(query: string, limit = 50): Promise<MarketSymbol[]> {
    const q = query.trim().toUpperCase();
    return SUPPORTED_INSTRUMENTS.filter((s) => !q || s.includes(q))
      .slice(0, limit)
      .map((raw) => this.buildSymbol(raw));
  }

  async getSymbol(id: string): Promise<MarketSymbol | null> {
    const raw = this.normalizeSymbol(id);
    if (!SUPPORTED_INSTRUMENTS.includes(raw)) return null;
    return this.buildSymbol(raw);
  }

  async connect(): Promise<void> {
    if (!this.isConfigured()) {
      this.updateHealth({ status: 'not_configured' });
      return;
    }
    this.updateHealth({ status: 'connected', lastMessageAt: Date.now() });
  }

  async disconnect(): Promise<void> {
    if (this.streamSub) {
      this.streamSub.abort();
      this.streamSub = null;
    }
    this.quoteCallbacks.clear();
    this.updateHealth({ status: 'disconnected' });
  }

  subscribeTrades(_symbol: string, _cb: (t: TradeTick) => void): SubscriptionHandle {
    // OANDA does not expose anonymous trade prints. UI must disable deep-trade for forex.
    return noopHandle(_symbol);
  }

  subscribeQuotes(symbol: string, cb: (q: QuoteTick) => void): SubscriptionHandle {
    if (!this.isConfigured()) return noopHandle(symbol);
    const raw = this.normalizeSymbol(symbol);
    let set = this.quoteCallbacks.get(raw);
    if (!set) {
      set = new Set();
      this.quoteCallbacks.set(raw, set);
      this.openPricingStream();
    }
    set.add(cb);
    return {
      symbol,
      unsubscribe: () => {
        const s = this.quoteCallbacks.get(raw);
        if (!s) return;
        s.delete(cb);
        if (s.size === 0) {
          this.quoteCallbacks.delete(raw);
          if (this.quoteCallbacks.size === 0 && this.streamSub) {
            this.streamSub.abort();
            this.streamSub = null;
          } else {
            this.openPricingStream(); // restart with new instrument set
          }
        }
      },
    };
  }

  subscribeOrderBook(symbol: string, _depth: number, _cb: (d: OrderBookDelta) => void): SubscriptionHandle {
    // Forex has no centralized book; do not invent one.
    return noopHandle(symbol);
  }

  subscribeCandles(
    symbol: string,
    interval: Interval,
    cb: (c: Candle) => void,
  ): SubscriptionHandle {
    // Poll candles every (interval / 2). OANDA exposes a streaming endpoint only for prices,
    // so candles are built either by polling or by aggregating local quote stream.
    if (!this.isConfigured() || !INTERVAL_TO_OANDA[interval]) return noopHandle(symbol);
    let stopped = false;
    let lastOpen = 0;
    const pollMs = Math.max(2_000, Math.floor((intervalToMs(interval) ?? 60_000) / 4));
    const loop = async (): Promise<void> => {
      if (stopped) return;
      try {
        const candles = await this.fetchHistoricalCandles(
          symbol,
          interval,
          Date.now() - (intervalToMs(interval) ?? 60_000) * 2,
          Date.now(),
          5,
        );
        const last = candles[candles.length - 1];
        if (last && last.openTime !== lastOpen) {
          lastOpen = last.openTime;
          cb(last);
        }
      } catch {
        /* swallow, retry on next loop */
      }
      if (!stopped) setTimeout(loop, pollMs);
    };
    void loop();
    return {
      symbol,
      unsubscribe: () => {
        stopped = true;
      },
    };
  }

  async fetchHistoricalCandles(
    symbol: string,
    interval: Interval,
    from: number,
    to: number,
    limit = 500,
  ): Promise<Candle[]> {
    if (!this.isConfigured()) return [];
    const oandaGranularity = INTERVAL_TO_OANDA[interval];
    if (!oandaGranularity) return [];
    const raw = this.normalizeSymbol(symbol);
    const url = new URL(`/v3/instruments/${raw}/candles`, this.apiUrl);
    url.searchParams.set('granularity', oandaGranularity);
    url.searchParams.set('from', new Date(from).toISOString());
    url.searchParams.set('to', new Date(to).toISOString());
    url.searchParams.set('price', 'M');
    url.searchParams.set('count', String(Math.min(limit, 5000)));
    const res = await this.fetchFn(url.toString(), {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
    if (!res.ok) {
      this.updateHealth({ status: 'degraded', message: `OANDA candles ${res.status}` });
      return [];
    }
    const data = (await res.json()) as {
      candles: Array<{
        time: string;
        volume: number;
        complete: boolean;
        mid: { o: string; h: string; l: string; c: string };
      }>;
    };
    const step = intervalToMs(interval) ?? 60_000;
    return data.candles.map((c) => {
      const openTime = new Date(c.time).getTime();
      const o = Number(c.mid.o);
      const h = Number(c.mid.h);
      const l = Number(c.mid.l);
      const cl = Number(c.mid.c);
      const volume = c.volume;
      return {
        symbol: `OANDA:${raw}`,
        provider: 'oanda',
        venue: 'OANDA',
        interval,
        openTime,
        closeTime: openTime + step - 1,
        open: o,
        high: h,
        low: l,
        close: cl,
        volume,
        quoteVolume: volume * ((o + cl) / 2),
        buyVolume: 0,
        sellVolume: 0,
        delta: 0,
        trades: 0,
        vwap: (o + h + l + cl) / 4,
        isClosed: c.complete,
        volumeKind: 'tick',
      };
    });
  }

  private buildSymbol(raw: string): MarketSymbol {
    const [base, quote] = raw.split('_');
    const catalog = getCatalogSymbol(`OANDA:${raw}`);
    const category = catalog?.category;
    const isMetal = base === 'XAU' || base === 'XAG' || base === 'XPT' || base === 'XPD';
    const isIndex = category === 'index';
    const isJpy = raw.includes('JPY');

    // Tick size / precision differ wildly across instrument families. Pulling them from
    // the right family keeps the price-axis from showing wrong decimals for indices.
    const tickSize = isIndex ? 0.1 : isMetal ? 0.01 : isJpy ? 0.001 : 0.00001;
    const pricePrecision = isIndex ? 1 : isMetal ? 2 : isJpy ? 3 : 5;

    return {
      id: `OANDA:${raw}`,
      rawSymbol: raw,
      base: base ?? raw,
      quote: quote ?? 'USD',
      venue: 'OANDA',
      provider: 'oanda',
      // assetClass / type drive UI affordances (e.g. "tick volume" badge, lot sizing in
      // the order panel). Keep them honest so the product never lies about its data.
      assetClass: isIndex ? 'index' : isMetal ? 'commodity' : 'forex',
      type: isIndex ? 'index' : isMetal ? 'commodity' : 'forex',
      tickSize,
      lotSize: isIndex || isMetal ? 1 : 1000,
      pricePrecision,
      quantityPrecision: 0,
      session: isIndex ? `${catalog?.label ?? raw} session` : 'Forex 24x5',
      timezone: 'UTC',
      status: 'trading',
    };
  }

  private updateHealth(patch: Partial<ProviderHealthStatus>): void {
    this.currentHealth = {
      ...this.currentHealth,
      ...patch,
      provider: 'oanda',
      venue: 'OANDA',
      subscriptions: this.quoteCallbacks.size,
    };
    this.health$.emit(this.currentHealth);
  }

  private openPricingStream(): void {
    if (this.streamSub) {
      this.streamSub.abort();
      this.streamSub = null;
    }
    const instruments = [...this.quoteCallbacks.keys()].join(',');
    if (!instruments) return;
    const url = new URL(`/v3/accounts/${this.accountId}/pricing/stream`, this.streamUrl);
    url.searchParams.set('instruments', instruments);
    const controller = new AbortController();
    this.streamSub = controller;
    void this.consumeStream(url.toString(), controller.signal);
  }

  private async consumeStream(url: string, signal: AbortSignal): Promise<void> {
    try {
      const res = await this.fetchFn(url, {
        headers: { Authorization: `Bearer ${this.apiToken}`, Accept: 'application/stream+json' },
        signal,
      });
      if (!res.ok || !res.body) {
        this.updateHealth({ status: 'degraded', message: `OANDA stream ${res.status}` });
        return;
      }
      this.updateHealth({ status: 'connected', lastMessageAt: Date.now() });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line) as {
              type: string;
              instrument?: string;
              bids?: Array<{ price: string }>;
              asks?: Array<{ price: string }>;
              time?: string;
            };
            if (msg.type !== 'PRICE' || !msg.instrument || !msg.bids?.[0] || !msg.asks?.[0]) continue;
            const set = this.quoteCallbacks.get(msg.instrument);
            if (!set) continue;
            const bid = Number(msg.bids[0].price);
            const ask = Number(msg.asks[0].price);
            const quote: QuoteTick = {
              provider: 'oanda',
              venue: 'OANDA',
              symbol: `OANDA:${msg.instrument}`,
              eventTime: msg.time ? new Date(msg.time).getTime() : Date.now(),
              bid,
              bidSize: 0,
              ask,
              askSize: 0,
              mid: (bid + ask) / 2,
              spread: ask - bid,
            };
            for (const cb of set) cb(quote);
          } catch {
            /* skip malformed */
          }
        }
      }
    } catch (err) {
      if (!signal.aborted) {
        this.updateHealth({ status: 'degraded', message: String(err) });
        setTimeout(() => this.openPricingStream(), 3_000);
      }
    }
  }
}

function intervalToMs(interval: Interval): number | undefined {
  const map: Partial<Record<Interval, number>> = {
    '5s': 5_000,
    '15s': 15_000,
    '30s': 30_000,
    '1m': 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '30m': 30 * 60_000,
    '1h': 3_600_000,
    '2h': 2 * 3_600_000,
    '4h': 4 * 3_600_000,
    '12h': 12 * 3_600_000,
    '1d': 86_400_000,
    '1w': 7 * 86_400_000,
    '1mo': 30 * 86_400_000,
  };
  return map[interval];
}

function noopHandle(symbol: string): SubscriptionHandle {
  return { symbol, unsubscribe: () => {} };
}
