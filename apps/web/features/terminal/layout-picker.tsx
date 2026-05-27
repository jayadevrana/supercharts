'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { useTerminalStore } from './terminal-store';
import { groupLayoutsByCount, type PaneLayout } from './layouts';

const GROUPS = groupLayoutsByCount();

export function LayoutPicker() {
  const layoutId = useTerminalStore((s) => s.layoutId);
  const setLayout = useTerminalStore((s) => s.setLayout);
  const paneCount = useTerminalStore((s) => s.layout.paneCount);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <LayoutGrid className="h-3.5 w-3.5" />
          <span>
            {paneCount} pane{paneCount === 1 ? '' : 's'}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[440px] max-h-[80vh] overflow-y-auto scroll-thin p-0">
        <div className="sticky top-0 z-10 border-b border-border bg-surface-raised/95 px-3 py-2.5 backdrop-blur">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Pane layouts
          </div>
          <div className="text-[10px] text-muted-foreground/80">
            Single → 16 pane grids. Click any preview to apply.
          </div>
        </div>
        <TooltipProvider>
          <div className="divide-y divide-border/60">
            {GROUPS.map(({ count, layouts }) => (
              <div key={count} className="flex items-start gap-3 px-3 py-2.5">
                <span className="mt-1.5 w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {count}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {layouts.map((l) => (
                    <Tooltip key={l.id}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            setLayout(l.id);
                            setOpen(false);
                          }}
                          aria-label={describeLayout(l.id, l.paneCount)}
                          title={describeLayout(l.id, l.paneCount)}
                          className={cn(
                            'group relative grid h-9 w-10 place-items-center rounded-md border transition-colors',
                            l.id === layoutId
                              ? 'border-accent bg-accent/10 ring-1 ring-accent/40'
                              : 'border-border bg-surface hover:border-accent/60 hover:bg-surface-raised',
                          )}
                        >
                          <LayoutSvg layout={l} className="h-6 w-7" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <span className="text-[10px]">{describeLayout(l.id, l.paneCount)}</span>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}

/** Human label per layout id. Keep in sync with PANE_LAYOUTS. */
function describeLayout(id: string, paneCount: number): string {
  const map: Record<string, string> = {
    '1': 'Single pane',
    '2-cols': '2 columns side by side',
    '2-rows': '2 rows stacked',
    '3-cols': '3 columns',
    '3-rows': '3 rows',
    '3-1L+2R': '1 tall left + 2 stacked right',
    '3-2L+1R': '2 stacked left + 1 tall right',
    '3-1T+2B': '1 wide top + 2 columns bottom',
    '3-2T+1B': '2 columns top + 1 wide bottom',
    '4-grid': '2 × 2 grid',
    '4-cols': '4 columns',
    '4-rows': '4 rows',
    '4-1L+3R': '1 tall left + 3 stacked right',
    '4-3L+1R': '3 stacked left + 1 tall right',
    '4-1T+3B': '1 wide top + 3 columns bottom',
    '4-3T+1B': '3 columns top + 1 wide bottom',
    '4-1T+3rows': '1 wide top + 3 stacked',
    '4-1L-stack': '1 tall left + stacked variants',
    '4-2T+2B': '2 over 2 (wide)',
    '5-1L+4R': '1 tall left + 2 × 2 right',
    '5-cols': '5 columns',
    '5-rows': '5 rows',
    '5-1T+4B': '1 wide top + 4 columns bottom',
    '5-4T+1B': '4 columns top + 1 wide bottom',
    '5-2T+3B': '2 top + 3 bottom',
    '5-1L-stack4': '1 tall left + 4 stacked right',
    '5-grid-mix': '3 across top + mixed bottom',
    '6-grid': '3 × 2 grid',
    '6-cols': '6 columns',
    '6-rows': '6 rows',
    '6-2x3': '2 × 3 grid',
    '6-1L+5R-grid': '1 tall left + grid right',
    '7-1L+6R': '1 tall left + 6 right',
    '7-cols': '7 columns',
    '7-1T+2-rows-3-cols': '1 wide top + 2 × 3 grid',
    '8-4x2': '4 × 2 grid',
    '8-2x4': '2 × 4 grid',
    '8-cols': '8 columns',
    '8-1T+7B': '1 wide top + 7 columns',
    '9-3x3': '3 × 3 grid',
    '9-1T+8B-grid': '1 wide top + 2 × 4 grid',
    '9-cols': '9 columns',
    '9-1L+2x4': '1 tall left + 2 × 4 right',
    '9-1L+8R': '1 tall left + 2 × 4 right (wide)',
    '10-5x2': '5 × 2 grid',
    '10-2x5': '2 × 5 grid',
    '10-cols': '10 columns',
    '12-4x3': '4 × 3 grid',
    '12-6x2': '6 × 2 grid',
    '12-3x4': '3 × 4 grid',
    '14-7x2': '7 × 2 grid',
    '16-4x4': '4 × 4 grid',
    '16-8x2': '8 × 2 grid',
  };
  return map[id] ?? `${paneCount}-pane layout`;
}

/** Render a layout as a small SVG diagram (paneCount rectangles in their grid cells). */
export function LayoutSvg({ layout, className }: { layout: PaneLayout; className?: string }) {
  const w = 24;
  const h = 18;
  const colW = w / layout.cols;
  const rowH = h / layout.rows;
  const pad = 0.6;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      {layout.cells.map((c, i) => (
        <rect
          key={i}
          x={(c.col - 1) * colW + pad}
          y={(c.row - 1) * rowH + pad}
          width={c.colSpan * colW - pad * 2}
          height={c.rowSpan * rowH - pad * 2}
          rx={0.6}
          fill="currentColor"
          opacity={0.18}
          stroke="currentColor"
          strokeWidth={0.6}
        />
      ))}
    </svg>
  );
}
