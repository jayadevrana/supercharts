'use client';

import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ArrowUp, ArrowDown, Eye, EyeOff, MoreHorizontal, RotateCcw, Settings2, Trash2, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { LegendRow } from './indicator-legend-util';

interface Props {
  rows: LegendRow[];
  /** Whether the crosshair is over a candle (the values reflect that bar, not the latest). */
  atCrosshair: boolean;
  onToggleVisible: (id: string) => void;
  onSettings: (id: string) => void;
  onRemove: (id: string) => void;
  /** Reorder this instance one slot up/down (z-order + Data Window order). */
  onReorder: (id: string, dir: 'up' | 'down') => void;
  /** Reset this instance's inputs + style back to the registry defaults. */
  onResetDefaults: (id: string) => void;
}

/**
 * On-chart indicator legend / status line. Sits top-left of the price pane, one row per classic
 * indicator: colour swatch · name · input summary · value at the crosshair candle (latest when the
 * crosshair is off). Controls reveal on hover — eye (hide), settings, a "⋯" overflow menu (parity
 * INC-13: move up/down · reset to defaults · remove), and a quick × . The container is
 * pointer-transparent so only the small rows intercept clicks — the chart stays draggable.
 */
export function IndicatorLegend(props: Props) {
  if (props.rows.length === 0) return null;
  return (
    <div className="pointer-events-none flex flex-col items-start gap-0.5">
      {props.rows.map((r) => (
        <LegendRowItem key={r.id} row={r} {...props} />
      ))}
    </div>
  );
}

function LegendRowItem({
  row: r,
  atCrosshair,
  onToggleVisible,
  onSettings,
  onRemove,
  onReorder,
  onResetDefaults,
}: { row: LegendRow } & Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const stop = (fn: () => void) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    fn();
  };
  // A menu action: run it and close the popover.
  const act = (fn: () => void) => () => {
    fn();
    setMenuOpen(false);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      title="Double-click to open settings"
      onDoubleClick={() => onSettings(r.id)}
      className={`group pointer-events-auto flex cursor-default items-center gap-1.5 rounded bg-surface/75 px-1.5 py-[3px] text-[11px] leading-none backdrop-blur-[1px] ${
        r.visible ? '' : 'opacity-50'
      }`}
    >
      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: r.color }} aria-hidden />
      <span className="font-medium text-foreground">{r.name}</span>
      {r.summary ? <span className="text-muted-foreground">{r.summary}</span> : null}
      <span className={`tabular-nums ${atCrosshair ? 'text-accent' : 'text-foreground/90'}`}>{r.value}</span>
      <span
        className={`ml-0.5 flex items-center gap-0.5 transition-opacity group-hover:opacity-100 ${
          menuOpen ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          type="button"
          title={r.visible ? 'Hide' : 'Show'}
          aria-label={r.visible ? 'Hide indicator' : 'Show indicator'}
          onClick={stop(() => onToggleVisible(r.id))}
          className="text-muted-foreground hover:text-foreground"
        >
          {r.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </button>
        <button
          type="button"
          title="Settings"
          aria-label="Indicator settings"
          onClick={stop(() => onSettings(r.id))}
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="h-3 w-3" />
        </button>
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="More"
              aria-label="More actions"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="min-w-[168px] text-xs">
            <MenuItem icon={<Settings2 className="h-3.5 w-3.5" />} label="Settings" onClick={act(() => onSettings(r.id))} />
            <MenuItem icon={<ArrowUp className="h-3.5 w-3.5" />} label="Move up" onClick={act(() => onReorder(r.id, 'up'))} />
            <MenuItem icon={<ArrowDown className="h-3.5 w-3.5" />} label="Move down" onClick={act(() => onReorder(r.id, 'down'))} />
            <MenuItem icon={<RotateCcw className="h-3.5 w-3.5" />} label="Reset to defaults" onClick={act(() => onResetDefaults(r.id))} />
            <div className="my-1 h-px bg-border" />
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Remove"
              tone="bear"
              onClick={act(() => onRemove(r.id))}
            />
          </PopoverContent>
        </Popover>
        <button
          type="button"
          title="Remove"
          aria-label="Remove indicator"
          onClick={stop(() => onRemove(r.id))}
          className="text-muted-foreground hover:text-bear"
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'bear';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted ${
        tone === 'bear' ? 'text-bear/90 hover:text-bear' : 'text-foreground'
      }`}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      {label}
    </button>
  );
}
