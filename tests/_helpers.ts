/**
 * Test fixtures. Returns plain OHLCV objects shaped like `Candle`; types are stripped
 * at runtime by Vitest/esbuild, and the pure modules only read the OHLCV + volume fields.
 */
export function k(
  openTime: number,
  o: number,
  h: number,
  l: number,
  c: number,
  volume = 100,
  buyVolume = volume / 2,
) {
  return {
    symbol: 'TEST',
    provider: 'test',
    venue: 'TEST',
    interval: '1m',
    openTime,
    closeTime: openTime + 60_000,
    open: o,
    high: h,
    low: l,
    close: c,
    volume,
    quoteVolume: volume * c,
    buyVolume,
    sellVolume: volume - buyVolume,
    delta: buyVolume - (volume - buyVolume),
    trades: 10,
    vwap: (h + l + c) / 3,
    isClosed: true,
  };
}

/** Build a candle series from a list of closes (high/low ±0.5 around close). */
export function series(closes: number[], startMs = 0, stepMs = 60_000) {
  return closes.map((c, i) => k(startMs + i * stepMs, c, c + 0.5, c - 0.5, c));
}
