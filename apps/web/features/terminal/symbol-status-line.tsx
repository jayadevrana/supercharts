'use client';

import type { Candle } from '@supercharts/types';
import { formatPrice, formatPercent } from '@/lib/format';

/**
 * TradingView-style symbol status line (parity INC-6). Sits top-left above the indicator legend
 * and shows the active bar's O/H/L/C + change — the crosshair candle when hovering, the latest
 * bar otherwise. Colour-keyed to the bar direction (close ≥ open = bull). Pure/presentational.
 */
export function SymbolStatusLine({
  candle,
  prevClose,
  atCrosshair,
  venue,
}: {
  candle: Candle | null;
  prevClose: number | null;
  atCrosshair: boolean;
  /** Data venue tag, TV-style ("Binance"). Omitted when unknown. */
  venue?: string;
}) {
  if (!candle) return null;
  const up = candle.close >= candle.open;
  const tone = up ? 'text-bull' : 'text-bear';
  const base = prevClose ?? candle.open;
  const change = candle.close - base;
  const pct = base ? (change / base) * 100 : 0;
  const a = Math.abs(candle.close);
  const dp = a >= 100 ? 2 : a >= 1 ? 4 : 6;
  const changeStr = `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(dp)}`;

  const Item = ({ label, value }: { label: string; value: number }) => (
    <span className="text-muted-foreground/80">
      {label}
      <span className={`ml-0.5 ${tone}`}>{formatPrice(value)}</span>
    </span>
  );

  return (
    <div
      className="pointer-events-auto flex items-center gap-1.5 rounded bg-surface/75 px-1.5 py-[3px] text-[11px] leading-none tabular-nums backdrop-blur-[1px]"
      title={atCrosshair ? 'Values at the crosshair bar' : 'Latest bar'}
    >
      {venue ? <span className="text-muted-foreground/60">{venue} ·</span> : null}
      <Item label="O" value={candle.open} />
      <Item label="H" value={candle.high} />
      <Item label="L" value={candle.low} />
      <Item label="C" value={candle.close} />
      <span className={tone}>
        {changeStr} ({formatPercent(pct)})
      </span>
    </div>
  );
}
