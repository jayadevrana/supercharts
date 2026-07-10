import type { Interval } from '@supercharts/types';

/** Which resolutions a venue actually serves; unsupported choices are hidden from the terminal. */
export function supportsInterval(symbol: string, interval: Interval): boolean {
  const venue = symbol.split(':')[0]?.toUpperCase();
  if (venue === 'BINANCE') {
    return new Set<Interval>(['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1mo']).has(interval);
  }
  if (venue === 'OANDA') {
    return new Set<Interval>(['5s', '15s', '30s', '1m', '5m', '15m', '30m', '1h', '2h', '4h', '12h', '1d', '1w', '1mo']).has(interval);
  }
  if (venue === 'KITE') {
    return new Set<Interval>(['1m', '3m', '5m', '15m', '30m', '1h', '1d']).has(interval);
  }
  return true;
}
