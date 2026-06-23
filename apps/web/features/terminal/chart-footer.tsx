'use client';

import { useEffect, useState } from 'react';
import type { Interval } from '@supercharts/types';
import { SlidersHorizontal } from 'lucide-react';

/**
 * TradingView-style chart footer: range presets on the left (each = a resolution + a
 * visible span), live UTC clock + price-scale toggles (% · log · auto) on the right.
 * Pure presentational — all behavior comes in through callbacks.
 */
export interface RangePreset {
  label: string;
  interval: Interval;
  /** Visible span in ms; 'ytd' = since Jan 1 UTC; 'all' = every loaded candle. */
  span: number | 'ytd' | 'all';
  hint: string;
}

const DAY = 24 * 3600_000;

export const RANGE_PRESETS: RangePreset[] = [
  { label: '1D', interval: '5m', span: DAY, hint: '1 day · 5m bars' },
  { label: '5D', interval: '15m', span: 5 * DAY, hint: '5 days · 15m bars' },
  { label: '1M', interval: '1h', span: 30 * DAY, hint: '1 month · 1h bars' },
  { label: '3M', interval: '4h', span: 90 * DAY, hint: '3 months · 4h bars' },
  { label: '6M', interval: '12h', span: 180 * DAY, hint: '6 months · 12h bars' },
  { label: 'YTD', interval: '1d', span: 'ytd', hint: 'Year to date · 1d bars' },
  { label: '1Y', interval: '1d', span: 365 * DAY, hint: '1 year · 1d bars' },
  { label: '5Y', interval: '1w', span: 5 * 365 * DAY, hint: '5 years · 1w bars' },
  { label: 'All', interval: '1mo', span: 'all', hint: 'All available · monthly bars' },
];

/** Resolve a preset's span to concrete ms (undefined = fit everything). */
export function resolvePresetSpan(span: RangePreset['span'], nowMs: number): number | undefined {
  if (span === 'all') return undefined;
  if (span === 'ytd') {
    const startOfYear = Date.UTC(new Date(nowMs).getUTCFullYear(), 0, 1);
    return Math.max(nowMs - startOfYear, DAY);
  }
  return span;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function ChartFooter({
  activeLabel,
  onPreset,
  mode,
  auto,
  onToggleLog,
  onTogglePercent,
  onAutoFit,
}: {
  activeLabel: string | null;
  onPreset: (preset: RangePreset) => void;
  mode: 'linear' | 'log' | 'percent';
  auto: boolean;
  onToggleLog: () => void;
  onTogglePercent: () => void;
  onAutoFit: () => void;
}) {
  // Live UTC clock — null until mounted so SSR markup never carries a stale time.
  const [clock, setClock] = useState<string | null>(null);
  useEffect(() => {
    const fmt = (): string => {
      const d = new Date();
      return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
    };
    setClock(fmt());
    const t = setInterval(() => setClock(fmt()), 1000);
    return () => clearInterval(t);
  }, []);

  const toggleCls = (active: boolean): string =>
    `rounded px-1.5 py-[2px] tabular-nums transition-colors ${
      active
        ? 'bg-accent/20 text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`;

  return (
    <div className="scroll-thin flex h-[26px] shrink-0 items-center justify-between gap-3 overflow-x-auto overflow-y-hidden border-t border-border/60 px-2 text-[11px] leading-none">
      <div className="flex shrink-0 items-center gap-0.5">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            title={p.hint}
            onClick={() => onPreset(p)}
            className={`rounded px-1.5 py-[2px] tabular-nums transition-colors ${
              activeLabel === p.label
                ? 'bg-accent/20 text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="tabular-nums text-muted-foreground" title="Exchange-agnostic UTC clock">
          {clock ? `${clock} UTC` : '—'}
        </span>
        <span className="h-3 w-px bg-border" />
        <div
          className="flex items-center gap-0.5 rounded border border-border/70 bg-surface/65 px-1 py-0.5"
          title="Price scale controls"
        >
          <SlidersHorizontal className="h-3 w-3 text-muted-foreground" aria-hidden />
          <span className="px-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Scale
          </span>
          <button
            type="button"
            title="Percent scale — % change vs the first visible bar"
            aria-pressed={mode === 'percent'}
            onClick={onTogglePercent}
            className={toggleCls(mode === 'percent')}
          >
            %
          </button>
          <button
            type="button"
            title="Logarithmic price scale"
            aria-pressed={mode === 'log'}
            onClick={onToggleLog}
            className={toggleCls(mode === 'log')}
          >
            log
          </button>
          <button
            type="button"
            title="Auto-fit the price scale to visible data (double-click the chart does the same)"
            aria-pressed={auto}
            onClick={onAutoFit}
            className={toggleCls(auto)}
          >
            auto
          </button>
        </div>
      </div>
    </div>
  );
}
