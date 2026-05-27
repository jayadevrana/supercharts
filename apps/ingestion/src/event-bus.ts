import type {
  Candle,
  DeepTradeBubble,
  LiquidityHeatmapCell,
  OrderBookDelta,
  QuoteTick,
  TradeTick,
  ProviderHealthStatus,
} from '@supercharts/types';
import { EventEmitter } from 'node:events';

/**
 * In-memory pub/sub. Lightweight, dependency-free, handles 100k+ events/s for our scale.
 * When Redis is configured, IngestionBus mirrors events to Redis channels for cross-process fanout.
 */
export type BusEvent =
  | { type: 'trade'; symbol: string; data: TradeTick }
  | { type: 'quote'; symbol: string; data: QuoteTick }
  | { type: 'orderbook'; symbol: string; data: OrderBookDelta }
  | { type: 'candle'; symbol: string; interval: string; data: Candle }
  | { type: 'deep_trade'; symbol: string; data: DeepTradeBubble }
  | { type: 'heatmap'; symbol: string; data: LiquidityHeatmapCell[] }
  | { type: 'health'; data: ProviderHealthStatus };

export class IngestionBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  emit(event: BusEvent): void {
    this.emitter.emit(event.type, event);
    if (event.type === 'trade' || event.type === 'quote' || event.type === 'orderbook' || event.type === 'candle' || event.type === 'deep_trade' || event.type === 'heatmap') {
      this.emitter.emit(`${event.type}:${event.symbol}`, event);
    }
  }

  on<E extends BusEvent['type']>(
    type: E,
    cb: (e: Extract<BusEvent, { type: E }>) => void,
  ): () => void {
    const fn = (e: BusEvent) => cb(e as Extract<BusEvent, { type: E }>);
    this.emitter.on(type, fn);
    return () => this.emitter.off(type, fn);
  }

  onSymbol<E extends 'trade' | 'quote' | 'orderbook' | 'candle' | 'deep_trade' | 'heatmap'>(
    type: E,
    symbol: string,
    cb: (e: Extract<BusEvent, { type: E }>) => void,
  ): () => void {
    const fn = (e: BusEvent) => cb(e as Extract<BusEvent, { type: E }>);
    this.emitter.on(`${type}:${symbol}`, fn);
    return () => this.emitter.off(`${type}:${symbol}`, fn);
  }
}

/** Singleton — every ingestion-side aggregator and the API's WS gateway share it. */
export const bus = new IngestionBus();
