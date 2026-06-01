'use client';

export type Level = readonly [price: number, size: number];

function fmtPrice(p: number): string {
  // 2 decimals on high-priced symbols so adjacent book levels (e.g. BTC's 0.01 tick) stay distinct.
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(5);
}
function fmtQty(q: number): string {
  if (q >= 1000) return `${(q / 1000).toFixed(1)}K`;
  if (q >= 1) return q.toFixed(2);
  return q.toFixed(3);
}

function Row({ price, size, side, max }: { price: number; size: number; side: 'ask' | 'bid'; max: number }) {
  const pct = Math.max(2, Math.min(100, (size / max) * 100));
  const tone = side === 'ask' ? 'text-bear' : 'text-bull';
  const bar = side === 'ask' ? 'bg-bear/15' : 'bg-bull/15';
  return (
    <div className="relative flex items-center justify-between px-2 py-[1px] tabular-nums">
      <div className={`absolute inset-y-0 right-0 ${bar}`} style={{ width: `${pct}%` }} />
      <span className={`relative ${tone}`}>{fmtPrice(price)}</span>
      <span className="relative text-muted-foreground">{fmtQty(size)}</span>
    </div>
  );
}

/**
 * Live DOM ladder — top-of-book depth from the orderbook snapshot stream. Asks
 * above the spread (red), bids below (green); the per-row bar is sized by volume.
 * Crypto only — shows a "Binance only" note where there's no real book.
 */
export function DomLadderPanel({ bids, asks, hasData }: { bids: Level[]; asks: Level[]; hasData: boolean }) {
  const topAsks = asks.slice(0, 12);
  const topBids = bids.slice(0, 12);
  let max = 1;
  for (const [, s] of topAsks) if (s > max) max = s;
  for (const [, s] of topBids) if (s > max) max = s;
  const spread = topAsks.length > 0 && topBids.length > 0 ? topAsks[0]![0] - topBids[0]![0] : 0;

  return (
    <div className="pointer-events-auto absolute left-2 top-2 z-20 w-40 overflow-hidden rounded-md border border-border/60 bg-surface-raised/90 text-[10px] shadow-floating backdrop-blur">
      <div className="flex items-center justify-between border-b border-border/50 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>DOM Ladder</span>
        <span className="tabular-nums">{topAsks.length + topBids.length}</span>
      </div>
      {!hasData ? (
        <div className="px-2 py-3 text-center text-[9px] text-muted-foreground">
          Live depth — Binance crypto only.
        </div>
      ) : (
        <div className="max-h-72 overflow-hidden">
          {[...topAsks].reverse().map(([p, s]) => (
            <Row key={`a${p}`} price={p} size={s} side="ask" max={max} />
          ))}
          <div className="flex justify-between border-y border-border/40 bg-surface/60 px-2 py-[1px] text-[8px] uppercase tracking-wide text-muted-foreground/80">
            <span>Spread</span>
            <span className="tabular-nums">{fmtPrice(spread)}</span>
          </div>
          {topBids.map(([p, s]) => (
            <Row key={`b${p}`} price={p} size={s} side="bid" max={max} />
          ))}
        </div>
      )}
    </div>
  );
}
