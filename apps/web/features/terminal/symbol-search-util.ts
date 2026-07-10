export interface RemoteSymbolResult {
  id: string;
  assetClass: string;
  venue: string;
  rawSymbol: string;
  segment?: string;
  expiry?: string;
}

export function symbolResultLabel(symbol: RemoteSymbolResult): string {
  const parts = symbol.id.split(':');
  if (symbol.venue === 'KITE' && parts.length >= 3) {
    const segment = symbol.segment?.split('-').at(-1) || symbol.assetClass.toUpperCase();
    return `${symbol.rawSymbol} · ${parts[1]} · ${segment}`;
  }
  return `${symbol.rawSymbol} · ${symbol.venue}`;
}

export function symbolResultTone(symbol: RemoteSymbolResult): 'accent' | 'warn' | 'muted' {
  if (symbol.venue === 'KITE') return 'warn';
  return symbol.assetClass === 'crypto' ? 'accent' : 'muted';
}
