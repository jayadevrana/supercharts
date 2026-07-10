/**
 * Ensure a symbol has ≥ `want` bars of an interval in the candle store, backfilling from the
 * venue's provider when short — the proven alert-engine pattern (alert-engine.ts init paths),
 * extracted for the scanner WITHOUT touching the alert engine itself. Returns whatever the
 * store holds afterwards; callers surface short/empty results honestly, never fake bars.
 */

import type { IngestionContext } from '@supercharts/ingestion';
import type { Candle, Interval } from '@supercharts/types';
import { INTERVAL_MS } from '@supercharts/types';

function resolveProvider(ctx: IngestionContext, symbol: string) {
  const venue = symbol.split(':')[0]?.toLowerCase();
  if (venue === 'binance') return ctx.providers.binance;
  if (venue === 'oanda') return ctx.providers.oanda;
  if (venue === 'mock') return ctx.providers.mock;
  return null;
}

export async function ensureBars(
  ctx: IngestionContext,
  symbol: string,
  interval: Interval,
  want: number,
): Promise<Candle[]> {
  const have = ctx.candleStore.query(symbol, interval, undefined, undefined, want);
  if (have.length >= want) return have;
  const provider = resolveProvider(ctx, symbol);
  if (provider) {
    try {
      const now = Date.now();
      const stepMs = INTERVAL_MS[interval] || 60_000;
      const bars = await provider.fetchHistoricalCandles(symbol, interval, now - want * stepMs, now, want);
      for (const c of bars) ctx.candleStore.upsert(symbol, interval, c);
    } catch {
      // Backfill failure is not fatal — serve whatever the cache has, honestly short.
    }
  }
  return ctx.candleStore.query(symbol, interval, undefined, undefined, want);
}

/** Run `ensureBars` across many symbols with a concurrency cap (protects providers). */
export async function ensureBarsMany(
  ctx: IngestionContext,
  symbols: readonly string[],
  interval: Interval,
  want: number,
  concurrency = 6,
): Promise<Map<string, Candle[]>> {
  const out = new Map<string, Candle[]>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < symbols.length) {
      const sym = symbols[next++]!;
      out.set(sym, await ensureBars(ctx, sym, interval, want));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, worker));
  return out;
}
