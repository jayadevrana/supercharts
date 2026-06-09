'use client';

import { useTerminalStore } from './terminal-store';
import { ChartPane } from './chart-pane';

export function ChartGrid() {
  const { panes, layout, activePaneId, setActivePane } = useTerminalStore();
  // Defensive: if the persisted/active id no longer matches any pane (e.g. after a layout
  // change), fall back to the first pane so EXACTLY ONE pane is always active. Otherwise
  // `getTool` / drawing would silently no-op with no active pane — looking like "drawing
  // tools don't work" even though the engine is fine.
  const activeId = panes.some((p) => p.id === activePaneId) ? activePaneId : panes[0]?.id;
  return (
    <div
      data-testid="chart-layout"
      data-layout-id={layout.id}
      className="grid h-full min-h-0 w-full gap-2 p-2"
      style={{
        gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
      }}
    >
      {panes.map((p, i) => {
        const cell = layout.cells[i];
        if (!cell) return null;
        return (
          <div
            key={p.id}
            data-testid="chart-panel"
            data-pane-id={p.id}
            // `h-full w-full` is defensive: grid tracks are usually definite, but if a
            // child overflows it can cause the cell box to grow beyond its track. The
            // min-* zeros prevent flex/grid children from forcing a minimum content size.
            className="h-full w-full"
            style={{
              gridColumn: `${cell.col} / span ${cell.colSpan}`,
              gridRow: `${cell.row} / span ${cell.rowSpan}`,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <ChartPane
              pane={p}
              active={p.id === activeId}
              onClick={() => setActivePane(p.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
