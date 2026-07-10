import { WebSocket } from 'ws';
import type {
  AssetClass,
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
import { TinyEmitter, type MarketDataProvider, type SubscriptionHandle, type Unsubscribe } from '../provider';

const KITE_REST = 'https://api.kite.trade';
const KITE_WS = 'wss://ws.kite.trade';
const VENUE = 'KITE';
const MAX_SUBSCRIPTIONS_PER_CONNECTION = 3000;

/** The provider can only call these market-data endpoints. */
export const KITE_ALLOWED_PATHS = ['/instruments', '/instruments/historical'] as const;

export function assertKiteReadOnlyPath(path: string): void {
  if (path === '/instruments' || path.startsWith('/instruments/historical/')) return;
  throw new Error(`Kite path not allowed: ${path}`);
}

const INTERVAL_TO_KITE: Partial<Record<Interval, string>> = {
  '1m': 'minute', '3m': '3minute', '5m': '5minute', '15m': '15minute',
  '30m': '30minute', '1h': '60minute', '1d': 'day',
};

export interface KiteInstrument extends MarketSymbol {
  instrumentToken: number;
  exchangeToken: string;
  segment: string;
  tradingSymbol: string;
  expiry?: string;
  strike?: number;
}

export interface KiteProviderOptions {
  apiKey: string;
  accessToken: string;
  fetchFn?: typeof fetch;
  restEndpoint?: string;
  wsEndpoint?: string;
}

interface KiteQuote {
  token: number;
  price: number;
  volume: number;
  eventTime: number;
}

export class KiteProvider implements MarketDataProvider {
  public readonly id = 'kite' as const;
  public readonly capabilities: ProviderCapabilities = {
    trades: false, quotes: true, orderBook: false, orderBookDepth: 0,
    candles: true, historicalCandles: true, historicalTrades: false, news: false,
    volumeKind: 'real', assetClasses: ['stock', 'futures', 'options', 'commodity', 'index'],
  };
  private readonly fetchFn: typeof fetch;
  private readonly restEndpoint: string;
  private readonly wsEndpoint: string;
  private catalog = new Map<string, KiteInstrument>();
  private tokenToSymbol = new Map<number, KiteInstrument>();
  private healthState: ProviderHealthStatus;
  private readonly health$ = new TinyEmitter<ProviderHealthStatus>();
  private socket: WebSocket | null = null;
  private quoteCallbacks = new Map<string, Set<(quote: QuoteTick) => void>>();
  private candleCallbacks = new Map<string, Set<(candle: Candle) => void>>();
  private subscribedTokens = new Set<number>();
  private lastDayVolume = new Map<number, number>();
  private currentCandles = new Map<string, Candle>();

  constructor(private readonly opts: KiteProviderOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.restEndpoint = opts.restEndpoint ?? KITE_REST;
    this.wsEndpoint = opts.wsEndpoint ?? KITE_WS;
    this.healthState = { provider: 'kite', venue: VENUE, status: 'disconnected', lastMessageAt: null, latencyMs: null, reconnects: 0, subscriptions: 0 };
  }

  async refreshInstruments(): Promise<number> {
    const res = await this.request('/instruments');
    const text = await res.text();
    if (!res.ok) throw new Error(`Kite instruments failed: ${res.status}`);
    const rows = parseKiteInstrumentsCsv(text);
    this.catalog = new Map(rows.map((row) => [row.id, row]));
    this.tokenToSymbol = new Map(rows.map((row) => [row.instrumentToken, row]));
    return rows.length;
  }

  async connect(): Promise<void> {
    if (!this.opts.apiKey || !this.opts.accessToken) {
      this.updateHealth({ status: 'not_configured', message: 'Kite API key or access token is not configured' });
      return;
    }
    if (this.catalog.size === 0) await this.refreshInstruments();
    this.updateHealth({ status: 'connected', message: undefined });
  }

  async disconnect(): Promise<void> {
    this.socket?.close();
    this.socket = null;
    this.subscribedTokens.clear();
    this.updateHealth({ status: 'disconnected' });
  }

  health(): ProviderHealthStatus { return { ...this.healthState }; }
  onHealth(cb: (h: ProviderHealthStatus) => void): Unsubscribe { return this.health$.on(cb); }

  normalizeSymbol(input: string): string {
    if (input.startsWith('KITE:')) return input;
    const [exchange, raw] = input.split(':', 2);
    if (exchange && raw) return `KITE:${exchange.toUpperCase()}:${canonicalPart(raw)}`;
    const target = canonicalPart(input);
    const match = [...this.catalog.values()].find((row) => canonicalPart(row.tradingSymbol) === target);
    return match?.id ?? `KITE:NSE:${target}`;
  }

  async searchSymbols(query: string, limit = 50): Promise<MarketSymbol[]> {
    const q = canonicalPart(query);
    return [...this.catalog.values()]
      .filter((row) => !q || canonicalPart(row.tradingSymbol).includes(q) || canonicalPart(row.base).includes(q))
      .slice(0, limit);
  }

  async getSymbol(canonicalId: string): Promise<MarketSymbol | null> {
    return this.catalog.get(this.normalizeSymbol(canonicalId)) ?? null;
  }

  subscribeTrades(symbol: string, _cb: (t: TradeTick) => void): SubscriptionHandle {
    // Kite quote packets do not provide individual trade ids/aggressor side. Never invent them.
    return noopHandle(this.normalizeSymbol(symbol));
  }

  subscribeQuotes(symbol: string, cb: (q: QuoteTick) => void): SubscriptionHandle {
    const id = this.normalizeSymbol(symbol);
    const callbacks = this.quoteCallbacks.get(id) ?? new Set<(q: QuoteTick) => void>();
    callbacks.add(cb); this.quoteCallbacks.set(id, callbacks);
    void this.subscribeSymbol(id);
    return { symbol: id, unsubscribe: () => this.removeCallback(this.quoteCallbacks, id, cb) };
  }

  subscribeOrderBook(symbol: string, _depth: number, _cb: (d: OrderBookDelta) => void): SubscriptionHandle {
    return noopHandle(this.normalizeSymbol(symbol));
  }

  subscribeCandles(symbol: string, interval: Interval, cb: (c: Candle) => void): SubscriptionHandle {
    const id = this.normalizeSymbol(symbol);
    const key = `${id}:${interval}`;
    const callbacks = this.candleCallbacks.get(key) ?? new Set<(c: Candle) => void>();
    callbacks.add(cb); this.candleCallbacks.set(key, callbacks);
    void this.subscribeSymbol(id);
    return { symbol: id, unsubscribe: () => this.removeCallback(this.candleCallbacks, key, cb) };
  }

  async fetchHistoricalCandles(symbol: string, interval: Interval, from: number, to: number, limit?: number): Promise<Candle[]> {
    const id = this.normalizeSymbol(symbol);
    const instrument = this.catalog.get(id);
    if (!instrument) return [];
    const kiteInterval = INTERVAL_TO_KITE[interval];
    if (!kiteInterval) throw new Error(`Kite does not support interval ${interval}`);
    const path = `/instruments/historical/${instrument.instrumentToken}/${kiteInterval}`;
    const params = new URLSearchParams({ from: kiteDate(from), to: kiteDate(to) });
    const res = await this.request(`${path}?${params}`);
    if (!res.ok) throw new Error(`Kite historical candles failed: ${res.status}`);
    const json = (await res.json()) as { data?: { candles?: Array<[string, number, number, number, number, number, number?]> } };
    const step = INTERVAL_MS[interval];
    const rows = json.data?.candles ?? [];
    return rows.slice(limit ? -limit : undefined).map((row) => ({
      symbol: id, provider: 'kite', venue: VENUE, interval,
      openTime: Date.parse(row[0]), closeTime: Date.parse(row[0]) + step - 1,
      open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5], quoteVolume: 0,
      buyVolume: 0, sellVolume: 0, delta: 0, trades: 0, vwap: row[4], isClosed: true, volumeKind: 'real' as const,
    }));
  }

  assertSubscriptionCapacity(nextCount: number): void {
    if (nextCount > MAX_SUBSCRIPTIONS_PER_CONNECTION) throw new Error('live_capacity_reached');
  }

  private async subscribeSymbol(id: string): Promise<void> {
    const instrument = this.catalog.get(id);
    if (!instrument || this.subscribedTokens.has(instrument.instrumentToken)) return;
    this.assertSubscriptionCapacity(this.subscribedTokens.size + 1);
    await this.ensureSocket();
    this.subscribedTokens.add(instrument.instrumentToken);
    this.socket?.send(JSON.stringify({ a: 'subscribe', v: [instrument.instrumentToken] }));
    this.socket?.send(JSON.stringify({ a: 'mode', v: ['quote', [instrument.instrumentToken]] }));
    this.updateHealth({ subscriptions: this.subscribedTokens.size });
  }

  private async ensureSocket(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const url = new URL(this.wsEndpoint);
      url.searchParams.set('api_key', this.opts.apiKey); url.searchParams.set('access_token', this.opts.accessToken);
      const ws = new WebSocket(url);
      this.socket = ws;
      ws.once('open', () => { this.updateHealth({ status: 'connected' }); resolve(); });
      ws.once('error', (err) => { this.updateHealth({ status: 'error', message: String(err) }); reject(err); });
      ws.on('message', (data, isBinary) => { if (isBinary) this.handleFrame(Buffer.from(data as Buffer)); });
      ws.on('close', () => { this.socket = null; this.subscribedTokens.clear(); this.updateHealth({ status: 'disconnected', subscriptions: 0 }); });
    });
  }

  private handleFrame(frame: Buffer): void {
    if (frame.length <= 1) return;
    const count = frame.readUInt16BE(0); let offset = 2;
    for (let i = 0; i < count && offset + 2 <= frame.length; i += 1) {
      const length = frame.readUInt16BE(offset); offset += 2;
      if (offset + length > frame.length) break;
      const packet = frame.subarray(offset, offset + length); offset += length;
      if (packet.length < 8) continue;
      const token = packet.readUInt32BE(0); const price = packet.readInt32BE(4) / 100;
      const volume = packet.length >= 20 ? packet.readUInt32BE(16) : 0;
      this.handleQuote({ token, price, volume, eventTime: Date.now() });
    }
  }

  private handleQuote(tick: KiteQuote): void {
    const instrument = this.tokenToSymbol.get(tick.token); if (!instrument || !Number.isFinite(tick.price)) return;
    this.updateHealth({ lastMessageAt: tick.eventTime });
    const quote: QuoteTick = { provider: 'kite', venue: VENUE, symbol: instrument.id, eventTime: tick.eventTime, bid: tick.price, bidSize: 0, ask: tick.price, askSize: 0, mid: tick.price, spread: 0 };
    for (const cb of this.quoteCallbacks.get(instrument.id) ?? []) cb(quote);
    for (const [key, callbacks] of this.candleCallbacks) {
      const [symbol, interval] = splitCandleKey(key); if (symbol !== instrument.id) continue;
      const next = this.aggregateLiveCandle(instrument.id, interval, tick);
      for (const cb of callbacks) cb(next);
    }
  }

  private aggregateLiveCandle(symbol: string, interval: Interval, tick: KiteQuote): Candle {
    const step = INTERVAL_MS[interval] || 60_000; const openTime = Math.floor(tick.eventTime / step) * step;
    const key = `${symbol}:${interval}`; const prior = this.currentCandles.get(key);
    const priorVolume = this.lastDayVolume.get(tick.token) ?? tick.volume; const increment = Math.max(0, tick.volume - priorVolume);
    this.lastDayVolume.set(tick.token, tick.volume);
    const next = prior && prior.openTime === openTime ? { ...prior, high: Math.max(prior.high, tick.price), low: Math.min(prior.low, tick.price), close: tick.price, volume: prior.volume + increment, isClosed: false } : {
      symbol, provider: 'kite', venue: VENUE, interval, openTime, closeTime: openTime + step - 1,
      open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: increment, quoteVolume: 0,
      buyVolume: 0, sellVolume: 0, delta: 0, trades: 0, vwap: tick.price, isClosed: false, volumeKind: 'real' as const,
    };
    this.currentCandles.set(key, next); return next;
  }

  private async request(path: string): Promise<Response> {
    const pathname = path.split('?', 1)[0] ?? '';
    assertKiteReadOnlyPath(pathname);
    return this.fetchFn(new URL(path, this.restEndpoint).toString(), { headers: { 'X-Kite-Version': '3', Authorization: `token ${this.opts.apiKey}:${this.opts.accessToken}` } });
  }

  private removeCallback<T>(map: Map<string, Set<(value: T) => void>>, key: string, cb: (value: T) => void): void {
    const callbacks = map.get(key); if (!callbacks) return; callbacks.delete(cb); if (callbacks.size === 0) map.delete(key);
  }
  private updateHealth(change: Partial<ProviderHealthStatus>): void { this.healthState = { ...this.healthState, ...change }; this.health$.emit(this.health()); }
}

export function parseKiteInstrumentsCsv(csv: string): KiteInstrument[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/); if (!header) return [];
  const keys = parseCsvLine(header); const index = (name: string) => keys.indexOf(name);
  return lines.flatMap((line) => {
    const row = parseCsvLine(line); const token = Number(row[index('instrument_token')]); const exchange = row[index('exchange')]; const raw = row[index('tradingsymbol')];
    if (!Number.isFinite(token) || !exchange || !raw) return [];
    const type = row[index('instrument_type')] ?? ''; const segment = row[index('segment')] ?? '';
    const assetClass: AssetClass = segment === 'INDICES' ? 'index' : type === 'FUT' ? 'futures' : type === 'CE' || type === 'PE' ? 'options' : exchange === 'MCX' ? 'commodity' : 'stock';
    const id = `KITE:${exchange}:${canonicalPart(raw)}`;
    return [{ id, base: row[index('name')] || raw, quote: 'INR', venue: VENUE, provider: 'kite', assetClass, type: assetClass === 'options' ? 'option' : assetClass === 'futures' ? 'futures' : assetClass === 'commodity' ? 'commodity' : assetClass === 'index' ? 'index' : 'spot', tickSize: Number(row[index('tick_size')]) || 0.05, lotSize: Number(row[index('lot_size')]) || 1, pricePrecision: 2, quantityPrecision: 0, session: 'India market hours', timezone: 'Asia/Kolkata', rawSymbol: raw, status: 'trading', instrumentToken: token, exchangeToken: row[index('exchange_token')] ?? '', segment, tradingSymbol: raw, expiry: row[index('expiry')] || undefined, strike: row[index('strike')] ? Number(row[index('strike')]) : undefined }];
  });
}

function parseCsvLine(line: string): string[] { const out: string[] = []; let current = ''; let quoted = false; for (let i = 0; i < line.length; i += 1) { const ch = line[i]!; if (ch === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i += 1; } else quoted = !quoted; } else if (ch === ',' && !quoted) { out.push(current); current = ''; } else current += ch; } out.push(current); return out; }
function canonicalPart(value: string): string { return value.trim().toUpperCase().replace(/\s+/g, '_'); }
function kiteDate(time: number): string { const d = new Date(time); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:00`; }
function splitCandleKey(key: string): [string, Interval] { const at = key.lastIndexOf(':'); return [key.slice(0, at), key.slice(at + 1) as Interval]; }
function noopHandle(symbol: string): SubscriptionHandle { return { symbol, unsubscribe: () => {} }; }
