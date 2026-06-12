import type { Layer, RenderContext } from './types';

export class GridLayer implements Layer {
  readonly id = 'grid';
  readonly zIndex = 0;
  visible = true;

  render({ ctx, theme, geometry, priceScale, timeScale }: RenderContext): void {
    const { pricePane, volumePane } = geometry;
    ctx.save();
    ctx.strokeStyle = theme.gridLine;
    ctx.lineWidth = 1;

    // Horizontal price grid lines — density tracks the pane height (~1 tick / 55px).
    const priceLines = niceTicks(
      priceScale.state.priceMin,
      priceScale.state.priceMax,
      priceTickTarget(pricePane.height),
    );
    ctx.beginPath();
    for (const p of priceLines) {
      const y = Math.round(priceScale.priceToY(p)) + 0.5;
      ctx.moveTo(pricePane.x, y);
      ctx.lineTo(pricePane.x + pricePane.width, y);
    }
    ctx.stroke();

    // Volume pane grid — 2 light lines.
    if (volumePane.height > 0) {
      ctx.beginPath();
      const stepY = volumePane.height / 3;
      for (let i = 1; i < 3; i += 1) {
        const y = Math.round(volumePane.y + i * stepY) + 0.5;
        ctx.moveTo(volumePane.x, y);
        ctx.lineTo(volumePane.x + volumePane.width, y);
      }
      ctx.stroke();
    }

    // Vertical time grid — choose a step matching the bar duration.
    const { fromTime, toTime } = timeScale.visibleRange();
    const step = chooseTimeStep(toTime - fromTime, pricePane.width);
    const first = Math.ceil(fromTime / step) * step;
    ctx.strokeStyle = theme.gridLine;
    ctx.beginPath();
    for (let t = first; t <= toTime; t += step) {
      const x = Math.round(timeScale.timeToX(t)) + 0.5;
      ctx.moveTo(x, pricePane.y);
      ctx.lineTo(x, pricePane.y + pricePane.height + volumePane.height);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * How many price ticks a pane of this height should target — TV sits around one
 * gridline per ~50-60px, which keeps levels readable without turning into graph paper.
 */
export function priceTickTarget(paneHeightPx: number): number {
  return Math.max(6, Math.min(16, Math.round(paneHeightPx / 55)));
}

export function niceTicks(min: number, max: number, target: number): number[] {
  const span = Math.max(max - min, 1e-12);
  const step = niceStep(span / target);
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-12; v += step) {
    out.push(v);
  }
  return out;
}

export function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const exp = Math.floor(Math.log10(rough));
  const mag = Math.pow(10, exp);
  const norm = rough / mag;
  let nice: number;
  if (norm < 1.5) nice = 1;
  else if (norm < 3.5) nice = 2;
  else if (norm < 7.5) nice = 5;
  else nice = 10;
  return nice * mag;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const TIME_STEPS = [
  SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND,
  MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 2 * HOUR, 4 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 90 * DAY, 180 * DAY, 365 * DAY,
];

export function chooseTimeStep(spanMs: number, widthPx: number): number {
  const targetLines = Math.max(4, Math.min(14, widthPx / 90));
  const ideal = spanMs / targetLines;
  for (const step of TIME_STEPS) {
    if (step >= ideal) return step;
  }
  return TIME_STEPS[TIME_STEPS.length - 1]!;
}
