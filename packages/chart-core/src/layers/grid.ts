import type { Layer, RenderContext } from './types';
import type { PriceScaleState } from '../scale';

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
    // Mode-aware: log space gets decade/mantissa ticks, percent gets round-% steps —
    // the SAME positions the axis labels use, so lines and labels always align.
    const priceLines = priceTickValues(
      priceScale.state,
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

/**
 * Mode-aware tick POSITIONS (prices) for the vertical scale. Label formatting stays with
 * the axis layer; the grid only needs positions, and sharing this function guarantees
 * gridlines and axis labels never drift apart.
 *
 * - linear  → the classic 1-2-5 nice ticks.
 * - log     → round prices laid out per decade (1-2-5 mantissas, density-scaled); narrow
 *             ranges (< one octave) fall back to linear ticks, which read fine in log space.
 * - percent → round percent steps relative to `baseline`, mapped back to prices.
 */
export function priceTickValues(
  state: Pick<PriceScaleState, 'priceMin' | 'priceMax' | 'mode' | 'baseline'>,
  target: number,
): number[] {
  const { priceMin: min, priceMax: max, mode } = state;
  if (!(max > min)) return [];
  if (mode === 'log') return logTicks(min, max, target);
  if (mode === 'percent' && state.baseline !== undefined && state.baseline > 0) {
    const b = state.baseline;
    const pMin = (min / b - 1) * 100;
    const pMax = (max / b - 1) * 100;
    return niceTicks(pMin, pMax, target).map((p) => b * (1 + p / 100));
  }
  return niceTicks(min, max, target);
}

/** Log-spaced round-price ticks: every decade crossed gets the same mantissa pattern. */
export function logTicks(min: number, max: number, target: number): number[] {
  const lo = Math.max(min, 1e-12);
  const hi = Math.max(max, lo * 1.0001);
  const decades = Math.log10(hi / lo);
  // Less than ~2× of range: linear nice ticks are indistinguishable from log ticks
  // and avoid awkward 1-2-5-only jumps on intraday charts.
  if (decades < 0.30103) return niceTicks(lo, hi, target);
  const MANTISSA_SETS: ReadonlyArray<ReadonlyArray<number>> = [
    [1],
    [1, 3],
    [1, 2, 5],
    [1, 1.5, 2, 3, 4, 5, 7],
  ];
  let chosen: ReadonlyArray<number> = MANTISSA_SETS[0]!;
  for (const set of MANTISSA_SETS) {
    if (set.length * decades <= target) chosen = set;
  }
  const out: number[] = [];
  const kLo = Math.floor(Math.log10(lo)) - 1;
  const kHi = Math.ceil(Math.log10(hi)) + 1;
  for (let k = kLo; k <= kHi; k += 1) {
    const mag = Math.pow(10, k);
    for (const m of chosen) {
      const v = m * mag;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out.sort((a, b) => a - b);
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
