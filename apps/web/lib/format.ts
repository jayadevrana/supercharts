export function formatPrice(value: number, precision = 2): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 100) return value.toFixed(precision);
  if (Math.abs(value) >= 1) return value.toFixed(Math.max(precision, 4));
  return value.toFixed(Math.max(precision, 6));
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(0);
}

export function formatPercent(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(fractionDigits)}%`;
}

export function formatRelativeTime(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 60_000) return `${Math.max(1, Math.floor(delta / 1000))}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export function formatSymbolLabel(symbolId: string): string {
  const [, raw] = symbolId.split(':');
  if (!raw) return symbolId;
  if (raw.includes('_')) return raw.replace('_', ' / ');
  // Crypto: split into BASE/QUOTE for common quote sizes.
  const quoteCandidates = ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH', 'EUR', 'GBP', 'JPY'];
  for (const q of quoteCandidates) {
    if (raw.endsWith(q)) return `${raw.slice(0, raw.length - q.length)} / ${q}`;
  }
  return raw;
}

export function shortVenue(symbolId: string): string {
  return symbolId.split(':')[0] ?? '';
}
