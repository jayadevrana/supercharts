import type { ProviderId } from '@supercharts/types';
import type { MarketDataProvider } from './provider';

/**
 * Global provider registry. The ingestion service registers each configured provider
 * at startup; the API and chart engine resolve by id.
 */
export class ProviderRegistry {
  private providers = new Map<ProviderId, MarketDataProvider>();

  register(provider: MarketDataProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider ${provider.id} already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: ProviderId): MarketDataProvider | undefined {
    return this.providers.get(id);
  }

  require(id: ProviderId): MarketDataProvider {
    const p = this.providers.get(id);
    if (!p) throw new Error(`Provider ${id} not registered`);
    return p;
  }

  list(): MarketDataProvider[] {
    return [...this.providers.values()];
  }

  /** Resolve "VENUE:SYMBOL" → provider, by matching venue to provider id. */
  fromCanonical(canonical: string): MarketDataProvider | undefined {
    const venue = canonical.split(':')[0]?.toLowerCase();
    if (!venue) return undefined;
    // Map common venue → provider id.
    const map: Record<string, ProviderId> = {
      binance: 'binance',
      binancefutures: 'binance_futures',
      coinbase: 'coinbase',
      kraken: 'kraken',
      okx: 'okx',
      bybit: 'bybit',
      oanda: 'oanda',
      mock: 'mock',
    };
    const id = map[venue];
    if (!id) return undefined;
    return this.providers.get(id);
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.providers.values()].map((p) => p.disconnect()));
    this.providers.clear();
  }
}

export const globalRegistry = new ProviderRegistry();
