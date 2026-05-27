import type {
  Candle,
  Interval,
  OrderBookDelta,
  ProviderHealthStatus,
  ProviderCapabilities,
  ProviderId,
  QuoteTick,
  Symbol as MarketSymbol,
  TradeTick,
} from '@supercharts/types';

/**
 * Adapter contract. Implementations live in `providers/`.
 * Every public-facing app component depends ONLY on this interface — never on a specific provider.
 */

export type Unsubscribe = () => void;

export interface SubscriptionHandle {
  symbol: string;
  unsubscribe: Unsubscribe;
}

export interface MarketDataProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;

  /** Open external WebSocket(s). Idempotent. */
  connect(): Promise<void>;
  /** Close all sockets and clear subscriptions. */
  disconnect(): Promise<void>;
  /** Current health snapshot. */
  health(): ProviderHealthStatus;
  /** Health change event subscription. */
  onHealth(cb: (h: ProviderHealthStatus) => void): Unsubscribe;

  /** Resolve a raw or canonical symbol to the provider's expected form. */
  normalizeSymbol(input: string): string;
  /** List/search symbols this provider serves. */
  searchSymbols(query: string, limit?: number): Promise<MarketSymbol[]>;
  /** Lookup a single symbol's metadata. */
  getSymbol(canonicalId: string): Promise<MarketSymbol | null>;

  subscribeTrades(symbol: string, cb: (t: TradeTick) => void): SubscriptionHandle;
  subscribeQuotes(symbol: string, cb: (q: QuoteTick) => void): SubscriptionHandle;
  subscribeOrderBook(symbol: string, depth: number, cb: (d: OrderBookDelta) => void): SubscriptionHandle;
  subscribeCandles(symbol: string, interval: Interval, cb: (c: Candle) => void): SubscriptionHandle;

  fetchHistoricalCandles(
    symbol: string,
    interval: Interval,
    from: number,
    to: number,
    limit?: number,
  ): Promise<Candle[]>;

  fetchHistoricalTrades?(symbol: string, from: number, to: number, limit?: number): Promise<TradeTick[]>;
}

/** Convenience: a tiny event emitter, no deps. */
export class TinyEmitter<T> {
  private listeners = new Set<(value: T) => void>();
  emit(value: T): void {
    for (const fn of this.listeners) {
      try {
        fn(value);
      } catch (err) {
        // Subscribers must not crash the emitter.
        // eslint-disable-next-line no-console
        console.error('[TinyEmitter] listener threw', err);
      }
    }
  }
  on(fn: (value: T) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  clear(): void {
    this.listeners.clear();
  }
  get size(): number {
    return this.listeners.size;
  }
}

/** Exponential backoff helper for provider reconnects. */
export function backoffDelayMs(attempt: number, baseMs = 500, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.random() * 0.3 * exp;
  return exp + jitter;
}
