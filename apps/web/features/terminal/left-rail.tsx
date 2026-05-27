'use client';

import {
  Circle,
  Crosshair,
  Hash,
  Lock,
  Magnet,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Pin,
  Ruler,
  Smile,
  Square,
  Table as TableIcon,
  TrendingUp,
  Type,
  X,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useTerminalStore } from './terminal-store';

const TOOLS: Array<{ id: string; label: string; icon: React.ReactNode; group?: 'select' | 'lines' | 'shapes' | 'text' | 'measure' | 'risk' | 'meta' }> = [
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
  { id: 'magnet', label: 'Magnet snap', icon: <Magnet className="h-4 w-4" />, group: 'meta' },
  { id: 'lock_all', label: 'Lock all', icon: <Lock className="h-4 w-4" />, group: 'meta' },
  { id: 'hide_all', label: 'Hide all', icon: <X className="h-4 w-4" />, group: 'meta' },
];

const GROUP_BREAKS = new Set(['lines', 'shapes', 'measure', 'risk', 'text', 'meta']);

export function LeftRail() {
  const { drawTool, setDrawTool } = useTerminalStore();
  return (
    <TooltipProvider>
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface/80 py-3">
        {TOOLS.map((tool, i) => {
          const showBreak = GROUP_BREAKS.has(tool.group ?? '') && TOOLS[i - 1]?.group !== tool.group;
          return (
            <div key={tool.id} className="contents">
              {showBreak ? <div className="my-1 h-px w-7 bg-border" /> : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setDrawTool(drawTool === tool.id ? null : tool.id)}
                    className={`relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground ${
                      drawTool === tool.id ? 'bg-accent/15 text-accent' : ''
                    }`}
                  >
                    {tool.icon}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{tool.label}</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
        <button className="mt-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-raised hover:text-foreground">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </aside>
    </TooltipProvider>
  );
}
