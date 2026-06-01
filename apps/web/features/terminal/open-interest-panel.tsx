'use client';

export interface OIPoint {
  time: number;
  openInterest: number;
}
export interface OIData {
  available: boolean;
  openInterest: number | null;
  history: OIPoint[];
}

function fmtOI(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(2);
}

/** Sparkline polyline points for an SVG of width×height. */
function spark(history: OIPoint[], w: number, h: number): string {
  if (history.length < 2) return '';
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of history) {
    if (p.openInterest < lo) lo = p.openInterest;
    if (p.openInterest > hi) hi = p.openInterest;
  }
  const span = hi - lo || 1;
  const step = w / (history.length - 1);
  return history
    .map((p, i) => `${(i * step).toFixed(1)},${(h - ((p.openInterest - lo) / span) * h).toFixed(1)}`)
    .join(' ');
}

/**
 * Open Interest panel — current Binance USD-M futures OI for the symbol, the
 * change across the loaded window, and a sparkline of the trend. Real fapi data
 * (proxied + cached server-side); shows a "no perp" note where there's no
 * futures market (FX/metals, or a coin without a USD-M contract).
 */
export function OpenInterestPanel({ data, loading }: { data: OIData | null; loading: boolean }) {
  const oi = data?.openInterest ?? null;
  const hist = data?.history ?? [];
  const first = hist.length > 0 ? hist[0]!.openInterest : null;
  const changePct = oi != null && first != null && first > 0 ? ((oi - first) / first) * 100 : null;
  const up = (changePct ?? 0) >= 0;
  const noData = !loading && (!data || !data.available);

  return (
    <div className="pointer-events-auto absolute bottom-2 left-2 z-20 w-48 overflow-hidden rounded-md border border-border/60 bg-surface-raised/90 text-[10px] shadow-floating backdrop-blur">
      <div className="flex items-center justify-between border-b border-border/50 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Open Interest</span>
        <span className="text-[8px] normal-case text-muted-foreground/70">USD-M futures</span>
      </div>
      {noData ? (
        <div className="px-2 py-3 text-center text-[9px] text-muted-foreground">
          No futures market for this symbol.
        </div>
      ) : (
        <div className="px-2 py-1.5">
          <div className="flex items-end justify-between">
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {oi != null ? fmtOI(oi) : loading ? '…' : '—'}
            </span>
            {changePct != null ? (
              <span className={`tabular-nums ${up ? 'text-bull' : 'text-bear'}`}>
                {up ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
              </span>
            ) : null}
          </div>
          {hist.length >= 2 ? (
            <svg viewBox="0 0 168 28" preserveAspectRatio="none" className="mt-1 h-7 w-full">
              <polyline
                points={spark(hist, 168, 28)}
                fill="none"
                stroke={up ? 'hsl(var(--bull))' : 'hsl(var(--bear))'}
                strokeWidth="1.25"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          ) : null}
        </div>
      )}
    </div>
  );
}
