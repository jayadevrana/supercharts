'use client';

import { Eye, EyeOff, Settings2, X } from 'lucide-react';
import type { LegendRow } from './indicator-legend-util';

interface Props {
  rows: LegendRow[];
  /** Whether the crosshair is over a candle (the values reflect that bar, not the latest). */
  atCrosshair: boolean;
  onToggleVisible: (id: string) => void;
  onSettings: (id: string) => void;
  onRemove: (id: string) => void;
}

/**
 * On-chart indicator legend / status line (Mission M2). Sits top-left of the price pane, one row
 * per classic indicator: colour swatch · name · input summary · value at the crosshair candle
 * (latest when the crosshair is off). Controls (hide / settings / remove) reveal on hover. The
 * container is pointer-transparent so only the small rows intercept clicks — the chart stays draggable.
 */
export function IndicatorLegend({ rows, atCrosshair, onToggleVisible, onSettings, onRemove }: Props) {
  if (rows.length === 0) return null;
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[62%] flex-col items-start gap-0.5">
      {rows.map((r) => (
        <div
          key={r.id}
          className={`group pointer-events-auto flex items-center gap-1.5 rounded bg-surface/75 px-1.5 py-[3px] text-[11px] leading-none backdrop-blur-[1px] ${
            r.visible ? '' : 'opacity-50'
          }`}
        >
          <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: r.color }} aria-hidden />
          <span className="font-medium text-foreground">{r.name}</span>
          {r.summary ? <span className="text-muted-foreground">{r.summary}</span> : null}
          <span className={`tabular-nums ${atCrosshair ? 'text-accent' : 'text-foreground/90'}`}>{r.value}</span>
          <span className="ml-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              title={r.visible ? 'Hide' : 'Show'}
              aria-label={r.visible ? 'Hide indicator' : 'Show indicator'}
              onClick={() => onToggleVisible(r.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              {r.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
            <button
              type="button"
              title="Settings"
              aria-label="Indicator settings"
              onClick={() => onSettings(r.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              title="Remove"
              aria-label="Remove indicator"
              onClick={() => onRemove(r.id)}
              className="text-muted-foreground hover:text-bear"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
