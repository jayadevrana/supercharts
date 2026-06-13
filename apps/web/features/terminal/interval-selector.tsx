'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Star } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Interval } from '@supercharts/types';

export interface IntervalMeta {
  value: Interval;
  label: string;
  group: 'seconds' | 'minutes' | 'hours' | 'days' | 'longer';
}

/** All resolutions the terminal can request, in ascending order. */
export const INTERVALS: IntervalMeta[] = [
  { value: '1s', label: '1s', group: 'seconds' },
  { value: '5s', label: '5s', group: 'seconds' },
  { value: '15s', label: '15s', group: 'seconds' },
  { value: '30s', label: '30s', group: 'seconds' },
  { value: '1m', label: '1m', group: 'minutes' },
  { value: '3m', label: '3m', group: 'minutes' },
  { value: '5m', label: '5m', group: 'minutes' },
  { value: '15m', label: '15m', group: 'minutes' },
  { value: '30m', label: '30m', group: 'minutes' },
  { value: '1h', label: '1h', group: 'hours' },
  { value: '2h', label: '2h', group: 'hours' },
  { value: '4h', label: '4h', group: 'hours' },
  { value: '6h', label: '6h', group: 'hours' },
  { value: '12h', label: '12h', group: 'hours' },
  { value: '1d', label: '1D', group: 'days' },
  { value: '1w', label: '1W', group: 'days' },
  { value: '1mo', label: '1M', group: 'longer' },
];

const GROUP_LABEL: Record<IntervalMeta['group'], string> = {
  seconds: 'Seconds',
  minutes: 'Minutes',
  hours: 'Hours',
  days: 'Days',
  longer: 'Months',
};

/** Which resolutions a venue actually serves — Binance/OANDA differ; everything else allows all. */
export function supportsInterval(symbol: string, interval: Interval): boolean {
  const venue = symbol.split(':')[0]?.toUpperCase();
  if (venue === 'BINANCE') {
    const ok = new Set<Interval>(['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1mo']);
    return ok.has(interval);
  }
  if (venue === 'OANDA') {
    const ok = new Set<Interval>(['5s', '15s', '30s', '1m', '5m', '15m', '30m', '1h', '2h', '4h', '12h', '1d', '1w', '1mo']);
    return ok.has(interval);
  }
  return true;
}

const FAVORITES_KEY = 'sc-interval-favorites';
const DEFAULT_FAVORITES: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

function readFavorites(): Interval[] {
  if (typeof window === 'undefined') return DEFAULT_FAVORITES;
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) return DEFAULT_FAVORITES;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_FAVORITES;
    const valid = new Set(INTERVALS.map((i) => i.value));
    const filtered = parsed.filter((v): v is Interval => typeof v === 'string' && valid.has(v as Interval));
    return filtered.length > 0 ? filtered : DEFAULT_FAVORITES;
  } catch {
    return DEFAULT_FAVORITES;
  }
}

function writeFavorites(favs: Interval[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  } catch {
    /* storage full / disabled — favorites just won't persist */
  }
}

/**
 * TradingView-style resolution selector: favorite timeframes shown as inline pills, plus a
 * dropdown listing every supported resolution grouped by unit, each star-toggleable into the
 * pill row (persisted to localStorage). The active resolution is always shown as a pill even
 * when it isn't a favorite.
 */
export function IntervalSelector({
  value,
  symbol,
  onChange,
}: {
  value: Interval;
  symbol: string;
  onChange: (v: Interval) => void;
}) {
  const [favorites, setFavorites] = useState<Interval[]>(DEFAULT_FAVORITES);
  const [open, setOpen] = useState(false);
  useEffect(() => setFavorites(readFavorites()), []);

  const toggleFavorite = (v: Interval): void => {
    setFavorites((prev) => {
      const next = prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v];
      // Keep favorites in canonical (ascending) order so the pill row never jumps around.
      const ordered = INTERVALS.filter((i) => next.includes(i.value)).map((i) => i.value);
      writeFavorites(ordered);
      return ordered;
    });
  };

  // Pills: supported favorites, with the active resolution force-included even if unfavorited.
  const pills = useMemo(() => {
    const out = INTERVALS.filter(
      (i) => supportsInterval(symbol, i.value) && (favorites.includes(i.value) || i.value === value),
    );
    return out;
  }, [favorites, symbol, value]);

  const supported = useMemo(() => INTERVALS.filter((i) => supportsInterval(symbol, i.value)), [symbol]);
  const groups = useMemo(() => {
    const m = new Map<IntervalMeta['group'], IntervalMeta[]>();
    for (const i of supported) {
      const arr = m.get(i.group) ?? [];
      arr.push(i);
      m.set(i.group, arr);
    }
    return [...m.entries()];
  }, [supported]);

  return (
    <div className="flex items-center gap-0.5">
      {pills.map((i) => (
        <button
          key={i.value}
          type="button"
          onClick={() => onChange(i.value)}
          title={`${i.label} resolution`}
          className={`min-w-[28px] rounded px-1.5 py-1 text-xs font-medium tabular-nums transition-colors ${
            value === i.value
              ? 'bg-accent/15 text-accent'
              : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground'
          }`}
        >
          {i.label}
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="All resolutions"
            aria-label="All resolutions"
            className="flex h-7 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-52 p-1.5">
          <div className="max-h-[60vh] overflow-auto scroll-thin">
            {groups.map(([group, items]) => (
              <div key={group} className="mb-1.5 last:mb-0">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {GROUP_LABEL[group]}
                </div>
                {items.map((i) => {
                  const fav = favorites.includes(i.value);
                  return (
                    <div
                      key={i.value}
                      className={`group flex items-center justify-between rounded-md pl-2 pr-1 ${
                        value === i.value ? 'bg-accent/10' : 'hover:bg-muted'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onChange(i.value);
                          setOpen(false);
                        }}
                        className={`flex-1 py-1.5 text-left text-sm tabular-nums ${
                          value === i.value ? 'text-accent' : 'text-foreground'
                        }`}
                      >
                        {i.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleFavorite(i.value)}
                        title={fav ? 'Remove from favorites' : 'Add to favorites'}
                        aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
                        className={`flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-surface-raised ${
                          fav ? 'text-accent' : 'text-muted-foreground/40 hover:text-muted-foreground'
                        }`}
                      >
                        <Star className={`h-3.5 w-3.5 ${fav ? 'fill-current' : ''}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
