'use client';

import { formatPrice } from '@supercharts/chart-core';
import { formatSpread } from './trade-buttons-util';

/**
 * TradingView-style on-chart trade buttons: [bid SELL] [spread] [ask BUY], top-left under
 * the symbol status line. Strictly real data — the host only renders this when a live
 * order-book feed is flowing (Binance), so the prices are the actual touch, never derived.
 * Clicking routes to the order panel with the side preselected; no order is ever sent
 * from here.
 */
export function TradeButtons({
  bid,
  ask,
  onSell,
  onBuy,
}: {
  bid: number;
  ask: number;
  onSell: () => void;
  onBuy: () => void;
}) {
  return (
    <div className="pointer-events-auto flex items-stretch overflow-hidden rounded-md border border-border/70 bg-surface/80 text-[11px] leading-none shadow-sm backdrop-blur-[2px]">
      <button
        type="button"
        title={`Sell at bid ${formatPrice(bid)} — opens the order ticket`}
        onClick={onSell}
        className="flex flex-col items-end gap-0.5 px-2 py-1 transition-colors hover:bg-bear/15"
      >
        <span className="tabular-nums font-medium text-bear">{formatPrice(bid)}</span>
        <span className="text-[8px] font-semibold uppercase tracking-[0.18em] text-bear/80">
          Sell
        </span>
      </button>
      <div
        title="Spread (ask − bid)"
        className="flex items-center border-x border-border/70 bg-surface-muted/60 px-1.5 text-[9px] tabular-nums text-muted-foreground"
      >
        {formatSpread(bid, ask)}
      </div>
      <button
        type="button"
        title={`Buy at ask ${formatPrice(ask)} — opens the order ticket`}
        onClick={onBuy}
        className="flex flex-col items-start gap-0.5 px-2 py-1 transition-colors hover:bg-accent/15"
      >
        <span className="tabular-nums font-medium text-accent">{formatPrice(ask)}</span>
        <span className="text-[8px] font-semibold uppercase tracking-[0.18em] text-accent/80">
          Buy
        </span>
      </button>
    </div>
  );
}
