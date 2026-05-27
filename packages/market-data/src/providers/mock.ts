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
import { INTERVAL_MS } from '@supercharts/types';
import {
  TinyEmitter,
  type MarketDataProvider,
  type SubscriptionHandle,
  type Unsubscribe,
} from '../provider';

/**
 * Deterministic-ish mock provider for offline / no-network dev.
 *
 * Generates a geometric random walk per symbol with realistic candle/volume shape, and
 * synthetic order-book depth that drifts around mid. Useful for screenshots, e2e tests,
 * and demoing every UI surface without an external dependency.
 */

export interface MockProviderOptions {
  symbols?: MarketSymbol[];
  startPrices?: Record<string, number>;
  tickIntervalMs?: number;
}

const DEFAULT_SYMBOLS: MarketSymbol[] = [
  mockSym('MOCK:BTCUSD', 'BTC', 'USD', 'crypto', 'spot', 0.5, 0.0001),
  mockSym('MOCK:ETHUSD', 'ETH', 'USD', 'crypto', 'spot', 0.05, 0.001),
  mockSym('MOCK:EURUSD', 'EUR', 'USD', 'forex', 'forex', 0.00001, 1000),
];

const DEFAULT_PRICES: Record<string, number> = {
  'MOCK:BTCUSD': 67_500,
  'MOCK:ETHUSD': 3_500,
  'MOCK:EURUSD': 1.085,
};

export class MockProvider implements MarketDataProvider {
  public readonly id = 'mock' as const;
  public readonly capabilities: ProviderCapabilities = {
    trades: true,
    quotes: true,
    orderBook: true,
    orderBookDepth: 20,
    candles: true,
    historicalCandles: true,
    historicalTrades: true,
    news: false,
    volumeKind: 'synthetic',
    assetClasses: ['crypto', 'forex'],
  };

  private symbols: MarketSymbol[];
  private prices: Map<string, number>;
  private timer?: NodeJS.Timeout;
  private health$ = new TinyEmitter<ProviderHealthStatus>();
  private currentHealth: ProviderHealthStatus = {
    provider: 'mock',
    venue: 'MOCK',
    status: 'disconnected',
    lastMessageAt: null,
    latencyMs: 0,
    reconnects: 0,
    subscriptions: 0,
  };
  private tickMs: number;
  private tradeSubs = new Map<string, Set<(t: TradeTick) => void>>();
  private quoteSubs = new Map<string, Set<(q: QuoteTick) => void>>();
  private bookSubs = new Map<string, Set<(d: OrderBookDelta) => void>>();
  private candleSubs = new Map<
    string,
    { interval: Interval; cb: (c: Candle) => void; currentBar: Candle | null }
  >();

  constructor(opts: MockProviderOptions = {}) {
    this.symbols = opts.symbols ?? DEFAULT_SYMBOLS;
    this.prices = new Map(Object.entries({ ...DEFAULT_PRICES, ...(opts.startPrices ?? {}) }));
    this.tickMs = opts.tickIntervalMs ?? 250;
  }

  health(): ProviderHealthStatus {
    return {
      ...this.currentHealth,
      subscriptions:
        this.tradeSubs.size + this.quoteSubs.size + this.bookSubs.size + this.candleSubs.size,
    };
  }

  onHealth(cb: (h: ProviderHealthStatus) => void): Unsubscribe {
    return this.health$.on(cb);
  }

  normalizeSymbol(input: string): string {
    return input.toUpperCase();
  }

  async searchSymbols(query: string, limit = 50): Promise<MarketSymbol[]> {
    const q = query.trim().toUpperCase();
    return this.symbols
      .filter((s) => !q || s.id.includes(q) || s.base.includes(q) || s.quote.includes(q))
      .slice(0, limit);
  }

  async getSymbol(id: string): Promise<MarketSymbol | null> {
    return this.symbols.find((s) => s.id === id) ?? null;
  }

  async connect(): Promise<void> {
    if (this.timer) return;
    this.currentHealth = {
      ...this.currentHealth,
      status: 'connected',
      lastMessageAt: Date.now(),
    };
    this.health$.emit(this.health());
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.tradeSubs.clear();
    this.quoteSubs.clear();
    this.bookSubs.clear();
    this.candleSubs.clear();
    this.currentHealth = { ...this.currentHealth, status: 'disconnected' };
    this.health$.emit(this.health());
  }

  subscribeTrades(symbol: string, cb: (t: TradeTick) => void): SubscriptionHandle {
    return this.addSub(this.tradeSubs, symbol, cb);
  }

  subscribeQuotes(symbol: string, cb: (q: QuoteTick) => void): SubscriptionHandle {
    return this.addSub(this.quoteSubs, symbol, cb);
  }

  subscribeOrderBook(
    symbol: string,
    _depth: number,
    cb: (d: OrderBookDelta) => void,
  ): SubscriptionHandle {
    return this.addSub(this.bookSubs, symbol, cb);
  }

  subscribeCandles(
    symbol: string,
    interval: Interval,
    cb: (c: Candle) => void,
  ): SubscriptionHandle {
    const id = symbol;
    this.candleSubs.set(id, { interval, cb, currentBar: null });
    void this.connect();
    return {
      symbol,
      unsubscribe: () => this.candleSubs.delete(id),
    };
  }

  async fetchHistoricalCandles(
    symbol: string,
    interval: Interval,
    from: number,
    to: number,
    limit = 1000,
  ): Promise<Candle[]> {
    const step = INTERVAL_MS[interval] || 60_000;
    let price = this.prices.get(symbol) ?? 100;
    const out: Candle[] = [];
    const aligned = Math.floor(from / step) * step;
    for (let t = aligned; t < to && out.length < limit; t += step) {
      const open = price;
      const drift = 0;
      const vol = price * 0.002;
      const high = open + Math.random() * vol;
      const low = open - Math.random() * vol;
      const close = low + Math.random() * (high - low);
      price = close + drift;
      const buyVolume = 100 + Math.random() * 500;
      const sellVolume = 100 + Math.random() * 500;
      const volume = buyVolume + sellVolume;
      out.push({
        symbol,
        provider: 'mock',
        venue: 'MOCK',
        interval,
        openTime: t,
        closeTime: t + step - 1,
        open,
        high,
        low,
        close,
        volume,
        quoteVolume: volume * ((open + close) / 2),
        buyVolume,
        sellVolume,
        delta: buyVolume - sellVolume,
        trades: Math.floor(volume / 5),
        vwap: (open + high + low + close) / 4,
        isClosed: true,
        volumeKind: 'synthetic',
      });
    }
    return out;
  }

  // ------------------------------------------------------------

  private addSub<TFn>(
    bucket: Map<string, Set<TFn>>,
    symbol: string,
    cb: TFn,
  ): SubscriptionHandle {
    let set = bucket.get(symbol);
    if (!set) {
      set = new Set();
      bucket.set(symbol, set);
    }
    set.add(cb);
    void this.connect();
    return {
      symbol,
      unsubscribe: () => {
        const s = bucket.get(symbol);
        if (!s) return;
        s.delete(cb);
        if (s.size === 0) bucket.delete(symbol);
      },
    };
  }

  private tick(): void {
    const now = Date.now();
    for (const sym of this.symbols) {
      const id = sym.id;
      const last = this.prices.get(id) ?? 100;
      const vol = Math.max(last * 0.0005, sym.tickSize);
      const drift = (Math.random() - 0.5) * vol * 2;
      const next = Math.max(sym.tickSize, last + drift);
      this.prices.set(id, next);

      // Trade
      const tSubs = this.tradeSubs.get(id);
      if (tSubs && tSubs.size > 0) {
        const aggressor = drift >= 0 ? 'buyer' : 'seller';
        const quantity = Math.max(sym.lotSize, Math.random() * 5);
        const tt: TradeTick = {
          id: `mock-${id}-${now}-${Math.random().toString(36).slice(2, 7)}`,
          provider: 'mock',
          venue: 'MOCK',
          symbol: id,
          eventTime: now,
          receiveTime: now,
          price: next,
          quantity,
          notional: next * quantity,
          side: aggressor,
          aggressorSide: aggressor,
          tradeId: String(now),
        };
        for (const cb of tSubs) cb(tt);
      }

      // Quote
      const qSubs = this.quoteSubs.get(id);
      if (qSubs && qSubs.size > 0) {
        const half = sym.tickSize * (1 + Math.random() * 2);
        const bid = next - half;
        const ask = next + half;
        const q: QuoteTick = {
          provider: 'mock',
          venue: 'MOCK',
          symbol: id,
          eventTime: now,
          bid,
          bidSize: 10 + Math.random() * 50,
          ask,
          askSize: 10 + Math.random() * 50,
          mid: next,
          spread: ask - bid,
        };
        for (const cb of qSubs) cb(q);
      }

      // Book
      const bSubs = this.bookSubs.get(id);
      if (bSubs && bSubs.size > 0) {
        const bids: Array<[number, number]> = [];
        const asks: Array<[number, number]> = [];
        for (let i = 1; i <= 20; i += 1) {
          bids.push([next - i * sym.tickSize, Math.random() * 80]);
          asks.push([next + i * sym.tickSize, Math.random() * 80]);
        }
        const delta: OrderBookDelta = {
          provider: 'mock',
          venue: 'MOCK',
          symbol: id,
          eventTime: now,
          sequenceStart: now,
          sequenceEnd: now,
          type: 'snapshot',
          bids,
          asks,
        };
        for (const cb of bSubs) cb(delta);
      }

      // Candles
      for (const [subId, sub] of this.candleSubs) {
        if (subId !== id) continue;
        const step = INTERVAL_MS[sub.interval] || 60_000;
        const bucketOpen = Math.floor(now / step) * step;
        let bar = sub.currentBar;
        if (!bar || bar.openTime !== bucketOpen) {
          if (bar) {
            sub.cb({ ...bar, isClosed: true });
          }
          bar = {
            symbol: id,
            provider: 'mock',
            venue: 'MOCK',
            interval: sub.interval,
            openTime: bucketOpen,
            closeTime: bucketOpen + step - 1,
            open: next,
            high: next,
            low: next,
            close: next,
            volume: 0,
            quoteVolume: 0,
            buyVolume: 0,
            sellVolume: 0,
            delta: 0,
            trades: 0,
            vwap: next,
            isClosed: false,
            volumeKind: 'synthetic',
          };
          sub.currentBar = bar;
        }
        bar.high = Math.max(bar.high, next);
        bar.low = Math.min(bar.low, next);
        bar.close = next;
        const v = 0.5 + Math.random();
        bar.volume += v;
        bar.quoteVolume += v * next;
        if (drift >= 0) bar.buyVolume += v;
        else bar.sellVolume += v;
        bar.delta = bar.buyVolume - bar.sellVolume;
        bar.trades += 1;
        bar.vwap = bar.quoteVolume / Math.max(bar.volume, 1e-9);
        sub.cb({ ...bar });
      }
    }
    this.currentHealth.lastMessageAt = now;
  }
}

function mockSym(
  id: string,
  base: string,
  quote: string,
  assetClass: MarketSymbol['assetClass'],
  type: MarketSymbol['type'],
  tickSize: number,
  lotSize: number,
): MarketSymbol {
  return {
    id,
    base,
    quote,
    venue: 'MOCK',
    provider: 'mock',
    assetClass,
    type,
    tickSize,
    lotSize,
    pricePrecision: 2,
    quantityPrecision: 4,
    session: assetClass === 'forex' ? '24x5' : '24x7',
    timezone: 'UTC',
    rawSymbol: id.split(':')[1] ?? id,
    status: 'trading',
  };
}
