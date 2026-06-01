import type { Interval, ProviderHealthStatus } from '@supercharts/types';
import type { MarketDataProvider, SubscriptionHandle } from '@supercharts/market-data';
import { bus } from './event-bus';
import { candleStore } from './candle-store';
import { deepTradeDetector } from './deep-trade-detector';
import { heatmapAggregator } from './heatmap-aggregator';
import { footprintAggregator } from './footprint-aggregator';

/**
 * Tracks who is interested in what so we open one external subscription per (symbol, kind)
 * regardless of how many browser clients are watching.
 */
interface SubKey {
  symbol: string;
  kind: 'trades' | 'quotes' | 'orderbook' | 'candles';
  interval?: Interval;
}

interface SubRecord {
  refCount: number;
  handle: SubscriptionHandle;
}

function keyOf(k: SubKey): string {
  return `${k.kind}:${k.symbol}:${k.interval ?? ''}`;
}

export class SubscriptionManager {
  private records = new Map<string, SubRecord>();
  private healthCache = new Map<string, ProviderHealthStatus>();

  constructor(private providers: { [id: string]: MarketDataProvider }) {
    for (const provider of Object.values(providers)) {
      provider.onHealth((h) => {
        this.healthCache.set(h.provider, h);
        bus.emit({ type: 'health', data: h });
      });
    }
  }

  health(): ProviderHealthStatus[] {
    return [...this.healthCache.values()];
  }

  private resolveProvider(symbol: string): MarketDataProvider | null {
    const venue = symbol.split(':')[0]?.toLowerCase();
    if (!venue) return null;
    const map: Record<string, string> = {
      binance: 'binance',
      oanda: 'oanda',
      mock: 'mock',
    };
    const id = map[venue];
    if (!id) return null;
    return this.providers[id] ?? null;
  }

  acquire(key: SubKey): void {
    const id = keyOf(key);
    let rec = this.records.get(id);
    if (rec) {
      rec.refCount += 1;
      return;
    }
    const provider = this.resolveProvider(key.symbol);
    if (!provider) return;

    let handle: SubscriptionHandle;
    switch (key.kind) {
      case 'trades':
        handle = provider.subscribeTrades(key.symbol, (trade) => {
          bus.emit({ type: 'trade', symbol: trade.symbol, data: trade });
          deepTradeDetector.ingest(trade);
          footprintAggregator.ingest(trade);
        });
        break;
      case 'quotes':
        handle = provider.subscribeQuotes(key.symbol, (quote) => {
          bus.emit({ type: 'quote', symbol: quote.symbol, data: quote });
        });
        break;
      case 'orderbook':
        handle = provider.subscribeOrderBook(key.symbol, 20, (delta) => {
          bus.emit({ type: 'orderbook', symbol: delta.symbol, data: delta });
          heatmapAggregator.configure(delta.symbol, { bucketMs: 1000, priceGrouping: 1 });
          heatmapAggregator.ingest(delta);
        });
        break;
      case 'candles':
        if (!key.interval) throw new Error('candles subscription requires interval');
        footprintAggregator.track(key.symbol, key.interval);
        handle = provider.subscribeCandles(key.symbol, key.interval, (candle) => {
          candleStore.upsert(candle.symbol, candle.interval, candle);
          bus.emit({ type: 'candle', symbol: candle.symbol, interval: candle.interval, data: candle });
        });
        break;
    }
    rec = { refCount: 1, handle };
    this.records.set(id, rec);
  }

  release(key: SubKey): void {
    const id = keyOf(key);
    const rec = this.records.get(id);
    if (!rec) return;
    rec.refCount -= 1;
    if (rec.refCount <= 0) {
      rec.handle.unsubscribe();
      this.records.delete(id);
    }
  }
}
