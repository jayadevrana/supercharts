import { WebSocket } from 'ws';
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
import {
  TinyEmitter,
  backoffDelayMs,
  type MarketDataProvider,
  type SubscriptionHandle,
  type Unsubscribe,
} from '../provider';

/**
 * Binance public market-data adapter (spot).
 *
 * - Uses the combined stream endpoint so multiple subscriptions multiplex on one socket.
 * - Endpoint: wss://stream.binance.com:9443/stream?streams=…
 * - REST historical klines via /api/v3/klines and /api/v3/exchangeInfo.
 *
 * Public market data requires no API key.
 *
 * Volume semantics: Binance spot reports real on-exchange volume.
 */

const BINANCE_WS = 'wss://stream.binance.com:9443/stream';
const BINANCE_REST = 'https://api.binance.com';
const VENUE = 'BINANCE';

const INTERVAL_TO_BINANCE: Partial<Record<Interval, string>> = {
  '1s': '1s',
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '2h': '2h',
  '4h': '4h',
  '6h': '6h',
  '8h': '8h',
  '12h': '12h',
  '1d': '1d',
  '1w': '1w',
  '1mo': '1M',
};

interface InternalSub {
  /** Lowercased Binance stream name, e.g. "btcusdt@trade". */
  stream: string;
  callbacks: Set<(payload: unknown) => void>;
}

interface BinanceTradeMsg {
  e: 'trade';
  E: number; // event time (ms)
  s: string; // symbol BTCUSDT
  t: number; // trade id
  p: string; // price
  q: string; // quantity
  T: number; // trade time (ms)
  m: boolean; // is buyer the market maker? -> aggressor side = SELL when m === true
}

interface BinanceKlineMsg {
  e: 'kline';
  E: number;
  s: string;
  k: {
    t: number; // start time
    T: number; // close time
    i: string; // interval
    o: string;
    c: string;
    h: string;
    l: string;
    v: string; // base volume
    q: string; // quote volume
    n: number; // trades
    V: string; // taker buy base volume
    Q: string; // taker buy quote volume
    x: boolean; // is closed
  };
}

interface BinanceBookTickerMsg {
  // no event type field on bookTicker stream
  u: number;
  s: string;
  b: string;
  B: string;
  a: string;
  A: string;
}

export interface BinanceProviderOptions {
  /** Override the WS endpoint (e.g. for futures: wss://fstream.binance.com/stream). */
  wsEndpoint?: string;
  /** Override the REST endpoint. */
  restEndpoint?: string;
  /** Provider id; defaults to "binance". */
  id?: 'binance' | 'binance_futures';
  venue?: string;
  /** Optional fetch impl override (mostly for tests). */
  fetchFn?: typeof fetch;
}

export class BinanceProvider implements MarketDataProvider {
  public readonly id: 'binance' | 'binance_futures';
  public readonly capabilities: ProviderCapabilities = {
    trades: true,
    quotes: true,
    orderBook: true,
    orderBookDepth: 1000,
    candles: true,
    historicalCandles: true,
    historicalTrades: true,
    news: false,
    volumeKind: 'real',
    assetClasses: ['crypto'],
  };

  private readonly venue: string;
  private readonly wsEndpoint: string;
  private readonly restEndpoint: string;
  private readonly fetchFn: typeof fetch;

  private ws: WebSocket | null = null;
  private subs = new Map<string, InternalSub>();
  private connectAttempt = 0;
  private health$ = new TinyEmitter<ProviderHealthStatus>();
  private currentHealth: ProviderHealthStatus;
  private heartbeat?: NodeJS.Timeout;
  private lastPongMs = 0;
  private connectPromise: Promise<void> | null = null;
  private closed = false;

  private symbolCache: MarketSymbol[] = [];
  private symbolCacheAt = 0;

  constructor(opts: BinanceProviderOptions = {}) {
    this.id = opts.id ?? 'binance';
    this.venue = opts.venue ?? VENUE;
    this.wsEndpoint = opts.wsEndpoint ?? BINANCE_WS;
    this.restEndpoint = opts.restEndpoint ?? BINANCE_REST;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.currentHealth = {
      provider: this.id,
      venue: this.venue,
      status: 'disconnected',
      lastMessageAt: null,
      latencyMs: null,
      reconnects: 0,
      subscriptions: 0,
    };
  }

  health(): ProviderHealthStatus {
    return { ...this.currentHealth, subscriptions: this.subs.size };
  }

  onHealth(cb: (h: ProviderHealthStatus) => void): Unsubscribe {
    return this.health$.on(cb);
  }

  normalizeSymbol(input: string): string {
    // Accept BINANCE:BTCUSDT or BTCUSDT or BTC-USDT
    const stripped = input.includes(':') ? (input.split(':')[1] ?? input) : input;
    return stripped.replace(/[-_/]/g, '').toUpperCase();
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    this.closed = false;
    this.connectPromise = this.openSocket();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.subs.clear();
    this.updateHealth({ status: 'disconnected' });
  }

  async searchSymbols(query: string, limit = 50): Promise<MarketSymbol[]> {
    await this.ensureSymbolCache();
    const q = query.trim().toUpperCase();
    if (!q) return this.symbolCache.slice(0, limit);
    return this.symbolCache
      .filter(
        (s) =>
          s.rawSymbol.includes(q) ||
          s.base.includes(q) ||
          s.quote.includes(q) ||
          s.id.includes(q),
      )
      .slice(0, limit);
  }

  async getSymbol(canonicalId: string): Promise<MarketSymbol | null> {
    await this.ensureSymbolCache();
    return this.symbolCache.find((s) => s.id === canonicalId) ?? null;
  }

  subscribeTrades(symbol: string, cb: (t: TradeTick) => void): SubscriptionHandle {
    const raw = this.normalizeSymbol(symbol);
    const stream = `${raw.toLowerCase()}@trade`;
    return this.registerSub(stream, symbol, (payload) => {
      const msg = payload as BinanceTradeMsg;
      if (msg.e !== 'trade') return;
      const price = Number(msg.p);
      const quantity = Number(msg.q);
      const aggressor = msg.m ? 'seller' : 'buyer';
      const trade: TradeTick = {
        id: `${this.venue}:${msg.s}:${msg.t}`,
        provider: this.id,
        venue: this.venue,
        symbol: `${this.venue}:${msg.s}`,
        eventTime: msg.T ?? msg.E,
        receiveTime: Date.now(),
        price,
        quantity,
        notional: price * quantity,
        side: aggressor,
        aggressorSide: aggressor,
        tradeId: String(msg.t),
      };
      cb(trade);
    });
  }

  subscribeQuotes(symbol: string, cb: (q: QuoteTick) => void): SubscriptionHandle {
    const raw = this.normalizeSymbol(symbol);
    const stream = `${raw.toLowerCase()}@bookTicker`;
    return this.registerSub(stream, symbol, (payload) => {
      const msg = payload as BinanceBookTickerMsg;
      const bid = Number(msg.b);
      const ask = Number(msg.a);
      const quote: QuoteTick = {
        provider: this.id,
        venue: this.venue,
        symbol: `${this.venue}:${msg.s}`,
        eventTime: Date.now(),
        bid,
        bidSize: Number(msg.B),
        ask,
        askSize: Number(msg.A),
        mid: (bid + ask) / 2,
        spread: ask - bid,
      };
      cb(quote);
    });
  }

  subscribeOrderBook(
    symbol: string,
    _depth: number,
    cb: (d: OrderBookDelta) => void,
  ): SubscriptionHandle {
    // Binance offers @depth (incremental, fast) or @depth20@100ms (top-N snapshot).
    // Use depth20@100ms for the heatmap MVP — gives us ~20 levels each side at 10Hz with no snapshot/sequence dance.
    const raw = this.normalizeSymbol(symbol);
    const stream = `${raw.toLowerCase()}@depth20@100ms`;
    return this.registerSub(stream, symbol, (payload) => {
      // depth20 payload: { lastUpdateId, bids: [[price, qty], …], asks: […] }
      const msg = payload as {
        lastUpdateId: number;
        bids: [string, string][];
        asks: [string, string][];
      };
      const delta: OrderBookDelta = {
        provider: this.id,
        venue: this.venue,
        symbol: `${this.venue}:${raw}`,
        eventTime: Date.now(),
        sequenceStart: msg.lastUpdateId,
        sequenceEnd: msg.lastUpdateId,
        type: 'snapshot',
        bids: msg.bids.map(([p, q]) => [Number(p), Number(q)] as const),
        asks: msg.asks.map(([p, q]) => [Number(p), Number(q)] as const),
      };
      cb(delta);
    });
  }

  subscribeCandles(
    symbol: string,
    interval: Interval,
    cb: (c: Candle) => void,
  ): SubscriptionHandle {
    const binanceInterval = INTERVAL_TO_BINANCE[interval];
    if (!binanceInterval) {
      throw new Error(`Binance does not support kline interval ${interval}`);
    }
    const raw = this.normalizeSymbol(symbol);
    const stream = `${raw.toLowerCase()}@kline_${binanceInterval}`;
    return this.registerSub(stream, symbol, (payload) => {
      const msg = payload as BinanceKlineMsg;
      if (msg.e !== 'kline') return;
      cb(this.klineToCandle(msg.k, msg.s, interval));
    });
  }

  async fetchHistoricalCandles(
    symbol: string,
    interval: Interval,
    from: number,
    to: number,
    limit = 1000,
  ): Promise<Candle[]> {
    const binanceInterval = INTERVAL_TO_BINANCE[interval];
    if (!binanceInterval) {
      throw new Error(`Binance does not support kline interval ${interval}`);
    }
    const raw = this.normalizeSymbol(symbol);
    const out: Candle[] = [];
    // Binance caps klines at 1000 rows per call. We page in chunks of that size
    // until we cover [from, to] or reach the caller-supplied `limit`.
    const PER_CALL = 1000;
    let cursor = from;
    // Allow plenty of iterations: 1y of 1m candles = 525k bars → ~525 pages.
    const maxIterations = 600;
    let safety = 0;
    while (cursor < to && safety < maxIterations && out.length < limit) {
      safety += 1;
      const url = new URL('/api/v3/klines', this.restEndpoint);
      url.searchParams.set('symbol', raw);
      url.searchParams.set('interval', binanceInterval);
      url.searchParams.set('startTime', String(cursor));
      url.searchParams.set('endTime', String(to));
      url.searchParams.set('limit', String(PER_CALL));
      const res = await this.fetchFn(url.toString());
      if (!res.ok) {
        throw new Error(`Binance klines failed: ${res.status} ${await res.text()}`);
      }
      const rows = (await res.json()) as unknown[][];
      if (rows.length === 0) break;
      for (const row of rows) {
        const candle = this.restKlineToCandle(row, raw, interval);
        out.push(candle);
        if (out.length >= limit) break;
      }
      const last = rows[rows.length - 1];
      const lastOpenTime = Number(last?.[0]);
      if (!Number.isFinite(lastOpenTime)) break;
      cursor = lastOpenTime + 1;
      // Last page returned fewer rows than a full window — we're caught up.
      if (rows.length < PER_CALL) break;
    }
    return out;
  }

  // ------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------

  private registerSub(
    stream: string,
    canonicalSymbol: string,
    handler: (payload: unknown) => void,
  ): SubscriptionHandle {
    let entry = this.subs.get(stream);
    if (!entry) {
      entry = { stream, callbacks: new Set() };
      this.subs.set(stream, entry);
      this.sendSubscribe([stream]);
    }
    entry.callbacks.add(handler);
    void this.connect();
    return {
      symbol: canonicalSymbol,
      unsubscribe: () => {
        const e = this.subs.get(stream);
        if (!e) return;
        e.callbacks.delete(handler);
        if (e.callbacks.size === 0) {
          this.subs.delete(stream);
          this.sendUnsubscribe([stream]);
        }
      },
    };
  }

  private sendSubscribe(streams: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: streams,
        id: Date.now(),
      }),
    );
  }

  private sendUnsubscribe(streams: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        method: 'UNSUBSCRIBE',
        params: streams,
        id: Date.now(),
      }),
    );
  }

  private async openSocket(): Promise<void> {
    this.updateHealth({ status: 'connecting' });
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsEndpoint);
      this.ws = ws;
      let settled = false;
      let openTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const cleanup = (): void => {
        ws.removeAllListeners();
        if (openTimeoutId) {
          clearTimeout(openTimeoutId);
          openTimeoutId = null;
        }
      };

      ws.on('open', () => {
        this.connectAttempt = 0;
        this.lastPongMs = Date.now();
        this.updateHealth({ status: 'connected', lastMessageAt: Date.now() });
        // Re-subscribe to all known streams.
        const streams = [...this.subs.keys()];
        if (streams.length > 0) {
          this.sendSubscribe(streams);
        }
        // Heartbeat: Binance closes idle connections after 24h, server pings every 3min.
        // ws lib auto-pongs by default; we add a watchdog instead.
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => {
          const since = Date.now() - this.lastPongMs;
          if (since > 60_000) {
            // Stale — force reconnect.
            try {
              ws.terminate();
            } catch {
              /* ignore */
            }
          }
        }, 15_000);
        if (openTimeoutId) {
          clearTimeout(openTimeoutId);
          openTimeoutId = null;
        }
        settled = true;
        resolve();
      });

      ws.on('message', (raw) => {
        this.lastPongMs = Date.now();
        this.updateHealth({
          status: 'connected',
          lastMessageAt: Date.now(),
        });
        try {
          const parsed = JSON.parse(raw.toString()) as
            | { stream: string; data: unknown }
            | { result: unknown; id: number };
          if (!('stream' in parsed)) return; // ACK
          const sub = this.subs.get(parsed.stream);
          if (!sub) return;
          for (const cb of sub.callbacks) cb(parsed.data);
        } catch {
          /* ignore malformed frames */
        }
      });

      ws.on('error', (err) => {
        this.updateHealth({ status: 'degraded', message: String(err) });
      });

      ws.on('close', () => {
        cleanup();
        this.ws = null;
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = undefined;
        if (!settled) {
          settled = true;
          reject(new Error('Binance WS closed before open'));
        }
        if (this.closed) {
          this.updateHealth({ status: 'disconnected' });
          return;
        }
        this.connectAttempt += 1;
        const delay = backoffDelayMs(this.connectAttempt);
        this.updateHealth({
          status: 'disconnected',
          reconnects: this.currentHealth.reconnects + 1,
        });
        setTimeout(() => {
          if (this.closed) return;
          this.openSocket().catch(() => {
            /* will retry */
          });
        }, delay);
      });

      // If open never fires, reject after timeout. Track the id so we can clear it on
      // success / close — otherwise a successful open still scheduled a 15-second-later
      // no-op timer that kept the event loop alive and emitted a spurious rejection if
      // anyone attached a late handler.
      openTimeoutId = setTimeout(() => {
        openTimeoutId = null;
        if (!settled && ws.readyState !== WebSocket.OPEN) {
          settled = true;
          reject(new Error('Binance WS open timeout'));
        }
      }, 15_000);
    });
  }

  private updateHealth(patch: Partial<ProviderHealthStatus>): void {
    this.currentHealth = {
      ...this.currentHealth,
      ...patch,
      provider: this.id,
      venue: this.venue,
      subscriptions: this.subs.size,
    };
    this.health$.emit(this.currentHealth);
  }

  private klineToCandle(
    k: BinanceKlineMsg['k'],
    rawSymbol: string,
    interval: Interval,
  ): Candle {
    const open = Number(k.o);
    const high = Number(k.h);
    const low = Number(k.l);
    const close = Number(k.c);
    const volume = Number(k.v);
    const quoteVolume = Number(k.q);
    const buyVolume = Number(k.V);
    const sellVolume = Math.max(0, volume - buyVolume);
    const delta = buyVolume - sellVolume;
    const vwap = volume > 0 ? quoteVolume / volume : close;
    return {
      symbol: `${this.venue}:${rawSymbol}`,
      provider: this.id,
      venue: this.venue,
      interval,
      openTime: k.t,
      closeTime: k.T,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume,
      buyVolume,
      sellVolume,
      delta,
      trades: k.n,
      vwap,
      isClosed: k.x,
      volumeKind: 'real',
    };
  }

  private restKlineToCandle(row: unknown[], rawSymbol: string, interval: Interval): Candle {
    // [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote, ignore]
    const openTime = Number(row[0]);
    const closeTime = Number(row[6]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    const quoteVolume = Number(row[7]);
    const trades = Number(row[8]);
    const buyVolume = Number(row[9]);
    const sellVolume = Math.max(0, volume - buyVolume);
    const delta = buyVolume - sellVolume;
    const vwap = volume > 0 ? quoteVolume / volume : close;
    return {
      symbol: `${this.venue}:${rawSymbol}`,
      provider: this.id,
      venue: this.venue,
      interval,
      openTime,
      closeTime,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume,
      buyVolume,
      sellVolume,
      delta,
      trades,
      vwap,
      isClosed: true,
      volumeKind: 'real',
    };
  }

  private async ensureSymbolCache(): Promise<void> {
    const ttl = 6 * 60 * 60 * 1000;
    if (this.symbolCache.length > 0 && Date.now() - this.symbolCacheAt < ttl) return;
    try {
      const res = await this.fetchFn(new URL('/api/v3/exchangeInfo', this.restEndpoint).toString());
      if (!res.ok) return;
      const data = (await res.json()) as {
        symbols: Array<{
          symbol: string;
          baseAsset: string;
          quoteAsset: string;
          status: string;
          filters: Array<Record<string, string>>;
        }>;
      };
      this.symbolCache = data.symbols.map((s) => {
        const tickFilter = s.filters.find((f) => f.filterType === 'PRICE_FILTER');
        const lotFilter = s.filters.find((f) => f.filterType === 'LOT_SIZE');
        const tickSize = Number(tickFilter?.tickSize ?? 0.01);
        const lotSize = Number(lotFilter?.stepSize ?? 0.0001);
        return {
          id: `${this.venue}:${s.symbol}`,
          rawSymbol: s.symbol,
          base: s.baseAsset,
          quote: s.quoteAsset,
          venue: this.venue,
          provider: this.id,
          assetClass: 'crypto',
          type: 'spot',
          tickSize,
          lotSize,
          pricePrecision: precisionFromStep(tickSize),
          quantityPrecision: precisionFromStep(lotSize),
          session: '24x7',
          timezone: 'UTC',
          status:
            s.status === 'TRADING'
              ? 'trading'
              : s.status === 'HALT'
                ? 'halted'
                : 'unknown',
        };
      });
      this.symbolCacheAt = Date.now();
    } catch {
      // Leave cache empty; UI shows a degraded state.
    }
  }
}

function precisionFromStep(step: number): number {
  if (step <= 0) return 8;
  const s = step.toString();
  if (s.includes('e')) {
    // 1e-7 etc.
    const m = /e-(\d+)/.exec(s);
    return m ? Number(m[1]) : 8;
  }
  const dot = s.indexOf('.');
  if (dot === -1) return 0;
  return s.length - dot - 1;
}
