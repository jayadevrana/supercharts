import type { Layer, RenderContext } from './types';

/**
 * Liquidity heatmap layer.
 *
 * Renders one rectangle per `LiquidityHeatmapCell`. Cells are time-bucketed by the ingestion
 * service; the layer draws them in the price pane behind the candles.
 *
 * Color mixes from the theme's bid / ask anchor via `intensity` (0..1).
 */
export interface HeatmapLayerOptions {
  opacity: number;
  enabled: boolean;
}

export class LiquidityHeatmapLayer implements Layer {
  readonly id = 'heatmap';
  readonly zIndex = 3;
  visible = true;
  options: HeatmapLayerOptions;

  constructor(opts: Partial<HeatmapLayerOptions> = {}) {
    this.options = { opacity: 0.85, enabled: true, ...opts };
  }

  render(ctx: RenderContext): void {
    if (!this.options.enabled) return;
    const { ctx: c, theme, geometry, frame, timeScale, priceScale } = ctx;
    if (frame.heatmapCells.length === 0) return;
    const { fromTime, toTime } = timeScale.visibleRange();
    const visibleHeight = geometry.pricePane.height;
    const pxPerMs = timeScale.state.pxPerMs;

    c.save();
    c.globalAlpha = this.options.opacity;
    // Default cell width = bar width if we know the step, else a small fixed.
    for (const cell of frame.heatmapCells) {
      if (cell.timeBucket < fromTime - 60_000 || cell.timeBucket > toTime + 60_000) continue;
      const x = timeScale.timeToX(cell.timeBucket);
      const w = Math.max(1, pxPerMs * estimateBucketMs(frame.heatmapCells));
      const y = priceScale.priceToY(cell.priceLevel);
      if (y < -10 || y > visibleHeight + 10) continue;
      const intensity = clamp01(cell.intensity);
      const anchor = cell.side === 'ask' ? theme.heatmap.ask : theme.heatmap.bid;
      const bg = theme.heatmap.background;
      const r = Math.round(bg[0] + (anchor[0] - bg[0]) * intensity);
      const g = Math.round(bg[1] + (anchor[1] - bg[1]) * intensity);
      const b = Math.round(bg[2] + (anchor[2] - bg[2]) * intensity);
      c.fillStyle = `rgb(${r},${g},${b})`;
      const rowH = Math.max(1, estimatePriceRowHeight(frame.heatmapCells, priceScale));
      c.fillRect(x, y - rowH / 2, w, rowH);
    }
    c.restore();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function estimateBucketMs(cells: { timeBucket: number }[]): number {
  if (cells.length < 2) return 1000;
  // Use the modal delta among adjacent unique time buckets.
  const seen = new Set<number>();
  const sorted = cells
    .map((c) => c.timeBucket)
    .filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .sort((a, b) => a - b);
  if (sorted.length < 2) return 1000;
  // Sample up to first 5 deltas.
  const deltas: number[] = [];
  for (let i = 1; i < Math.min(sorted.length, 6); i += 1) {
    deltas.push(sorted[i]! - sorted[i - 1]!);
  }
  deltas.sort((a, b) => a - b);
  return Math.max(1, deltas[Math.floor(deltas.length / 2)] ?? 1000);
}

function estimatePriceRowHeight(
  cells: { priceLevel: number }[],
  priceScale: { priceToY: (p: number) => number; state: { priceMin: number; priceMax: number } },
): number {
  if (cells.length < 2) return 1;
  const sample = cells.slice(0, 50).map((c) => c.priceLevel);
  sample.sort((a, b) => a - b);
  // Take the median consecutive gap.
  const gaps: number[] = [];
  for (let i = 1; i < sample.length; i += 1) {
    const g = sample[i]! - sample[i - 1]!;
    if (g > 0) gaps.push(g);
  }
  if (gaps.length === 0) return 1;
  gaps.sort((a, b) => a - b);
  const medianStep = gaps[Math.floor(gaps.length / 2)] ?? 1;
  const yA = priceScale.priceToY(0 + medianStep);
  const yB = priceScale.priceToY(0);
  return Math.max(1, Math.abs(yA - yB));
}
