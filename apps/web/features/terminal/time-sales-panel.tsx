'use client';

export interface TapeRow {
  id: string;
  price: number;
  qty: number;
  /** Quote-currency value of the print (≈ USD on USDT pairs) — drives whale highlighting. */
  notional: number;
  side: 'buy' | 'sell' | 'unknown';
  time: number;
}

/** Prints at or above this quote-value are flagged as block / "whale" trades. */
const WHALE_NOTIONAL = 50_000;

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function fmtPrice(p: number): string {
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(5);
}
function fmtQty(q: number): string {
  if (q >= 1000) return `${(q / 1000).toFixed(1)}K`;
  if (q >= 1) return q.toFixed(2);
  return q.toFixed(3);
}

/**
 * Live Time & Sales tape — a compact corner panel fed by the trade stream. Rows
 * are newest-first; green = buyer-aggressed (lifted the ask), red = seller. Shows
 * a "Binance crypto only" note on venues without a real trade feed (never faked).
 */
export function TimeSalesPanel({ rows, hasData }: { rows: TapeRow[]; hasData: boolean }) {
  return (
    <div className="pointer-events-auto absolute right-2 top-2 z-20 w-44 overflow-hidden rounded-md border border-border/60 bg-surface-raised/90 text-[10px] shadow-floating backdrop-blur">
      <div className="flex items-center justify-between border-b border-border/50 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Time &amp; Sales</span>
        <span className="tabular-nums">{rows.length}</span>
      </div>
      {!hasData ? (
        <div className="px-2 py-3 text-center text-[9px] text-muted-foreground">
          Live trades — Binance crypto only.
        </div>
      ) : (
        <div className="max-h-60 overflow-hidden">
          <div className="flex justify-between px-2 py-0.5 text-[8px] uppercase tracking-wide text-muted-foreground/70">
            <span>Time</span>
            <span>Price</span>
            <span>Size</span>
          </div>
          {rows.map((r) => {
            const tone = r.side === 'sell' ? 'text-bear' : 'text-bull';
            const whale = r.notional >= WHALE_NOTIONAL;
            const whaleBg = whale ? (r.side === 'sell' ? 'bg-bear/15 font-semibold' : 'bg-bull/15 font-semibold') : '';
            return (
              <div
                key={r.id}
                className={`flex items-center justify-between px-2 py-[1px] tabular-nums ${whaleBg}`}
                title={whale ? `Block: ${fmtQty(r.qty)} @ ${fmtPrice(r.price)}` : undefined}
              >
                <span className="flex items-center gap-1 text-muted-foreground/80">
                  {whale ? <span className={tone}>●</span> : null}
                  {fmtTime(r.time)}
                </span>
                <span className={tone}>{fmtPrice(r.price)}</span>
                <span className={tone}>{fmtQty(r.qty)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
