'use client';

import { useState } from 'react';
import {
  Circle,
  Crosshair,
  Eye,
  EyeOff,
  Hash,
  Lock,
  LockOpen,
  Magnet,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Pin,
  Ruler,
  Smile,
  Square,
  Table as TableIcon,
  Trash2,
  TrendingUp,
  Type,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTerminalStore } from './terminal-store';

const TOOLS: Array<{ id: string; label: string; icon: React.ReactNode; group?: 'select' | 'lines' | 'shapes' | 'text' | 'measure' | 'risk' }> = [
  { id: 'cursor', label: 'Cursor', icon: <MousePointer2 className="h-4 w-4" />, group: 'select' },
  { id: 'crosshair', label: 'Crosshair', icon: <Crosshair className="h-4 w-4" />, group: 'select' },
  { id: 'trend_line', label: 'Trend line', icon: <TrendingUp className="h-4 w-4" />, group: 'lines' },
  { id: 'horizontal_line', label: 'Horizontal line', icon: <Pin className="h-4 w-4 rotate-90" />, group: 'lines' },
  { id: 'rectangle', label: 'Rectangle', icon: <Square className="h-4 w-4" />, group: 'shapes' },
  { id: 'ellipse', label: 'Ellipse', icon: <Circle className="h-4 w-4" />, group: 'shapes' },
  { id: 'fib_retracement', label: 'Fibonacci', icon: <Hash className="h-4 w-4" />, group: 'measure' },
  { id: 'ruler', label: 'Ruler', icon: <Ruler className="h-4 w-4" />, group: 'measure' },
  { id: 'risk_reward_long', label: 'Long R/R', icon: <Pencil className="h-4 w-4 text-bull" />, group: 'risk' },
  { id: 'risk_reward_short', label: 'Short R/R', icon: <Pencil className="h-4 w-4 text-bear" />, group: 'risk' },
  { id: 'text', label: 'Text', icon: <Type className="h-4 w-4" />, group: 'text' },
  { id: 'emoji', label: 'Emoji', icon: <Smile className="h-4 w-4" />, group: 'text' },
  { id: 'table', label: 'Table', icon: <TableIcon className="h-4 w-4" />, group: 'text' },
];

const GROUP_BREAKS = new Set(['lines', 'shapes', 'measure', 'risk', 'text']);

function RailButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={`relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground ${
            pressed ? 'bg-accent/15 text-accent' : ''
          }`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function LeftRail() {
  const drawTool = useTerminalStore((s) => s.drawTool);
  const setDrawTool = useTerminalStore((s) => s.setDrawTool);
  const magnetSnap = useTerminalStore((s) => s.magnetSnap);
  const toggleMagnetSnap = useTerminalStore((s) => s.toggleMagnetSnap);
  const drawingsLocked = useTerminalStore((s) => s.drawingsLocked);
  const toggleDrawingsLocked = useTerminalStore((s) => s.toggleDrawingsLocked);
  const drawingsHidden = useTerminalStore((s) => s.drawingsHidden);
  const toggleDrawingsHidden = useTerminalStore((s) => s.toggleDrawingsHidden);
  const requestClearDrawings = useTerminalStore((s) => s.requestClearDrawings);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <TooltipProvider>
      <aside className="absolute inset-y-0 left-0 z-30 flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-surface/95 py-3 lg:static lg:z-auto lg:overflow-visible lg:bg-surface/80">
        {TOOLS.map((tool, i) => {
          const showBreak = GROUP_BREAKS.has(tool.group ?? '') && TOOLS[i - 1]?.group !== tool.group;
          return (
            <div key={tool.id} className="contents">
              {showBreak ? <div className="my-1 h-px w-7 bg-border" /> : null}
              <RailButton
                label={tool.label}
                pressed={drawTool === tool.id}
                onClick={() => setDrawTool(drawTool === tool.id ? null : tool.id)}
              >
                {tool.icon}
              </RailButton>
            </div>
          );
        })}

        {/* Bottom cluster — drawing meta-modes (magnet / lock / hide) + overflow actions. */}
        <div className="mt-auto flex flex-col items-center gap-1">
          <div className="my-1 h-px w-7 bg-border" />
          <RailButton
            label={magnetSnap ? 'Magnet snap on — points snap to OHLC' : 'Magnet snap — snap drawing points to OHLC'}
            pressed={magnetSnap}
            onClick={toggleMagnetSnap}
          >
            <Magnet className="h-4 w-4" />
          </RailButton>
          <RailButton
            label={drawingsLocked ? 'Unlock all drawings' : 'Lock all drawings'}
            pressed={drawingsLocked}
            onClick={toggleDrawingsLocked}
          >
            {drawingsLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
          </RailButton>
          <RailButton
            label={drawingsHidden ? 'Show all drawings' : 'Hide all drawings'}
            pressed={drawingsHidden}
            onClick={toggleDrawingsHidden}
          >
            {drawingsHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </RailButton>
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                aria-label="More drawing actions"
                title="More drawing actions"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-raised hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" className="w-56 p-1">
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
                disabled={drawingsHidden}
                title={drawingsHidden ? 'Drawings are hidden — show them first' : undefined}
                onClick={() => {
                  setMenuOpen(false);
                  if (window.confirm('Remove ALL drawings on the active pane?\n\nThis deletes them from the server too.')) {
                    requestClearDrawings();
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-bear" aria-hidden="true" />
                Remove all drawings (active pane)
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </aside>
    </TooltipProvider>
  );
}
