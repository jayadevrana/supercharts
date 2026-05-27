import type { Candle } from '@supercharts/types';
import type { ChartType } from '@supercharts/types';
import type { Layer, RenderContext } from './types';

export interface PriceSeriesOptions {
  chartType: ChartType;
  /** When zoomed out and visible candles > this count, decimate. */
  decimationThreshold: number;
}

const DEFAULT_OPTS: PriceSeriesOptions = {
  chartType: 'candlestick',
  decimationThreshold: 4000,
};

export class PriceSeriesLayer implements Layer {
  readonly id = 'price-series';
  readonly zIndex = 10;
  visible = true;
  options: PriceSeriesOptions;

  constructor(opts: Partial<PriceSeriesOptions> = {}) {
    this.options = { ...DEFAULT_OPTS, ...opts };
  }

  render(ctx: RenderContext): void {
    const candles = visibleSlice(ctx.frame.candles, ctx);
    if (candles.length === 0) return;

    switch (this.options.chartType) {
      case 'line':
        renderLine(ctx, candles, false, false);
        return;
      case 'line_markers':
        renderLine(ctx, candles, false, true);
        return;
      case 'area':
        renderLine(ctx, candles, true, false);
        return;
      case 'hlc_area':
        renderHlcArea(ctx, candles);
        return;
      case 'baseline':
        renderBaseline(ctx, candles);
        return;
      case 'bar':
      case 'ohlc':
        renderOHLC(ctx, candles);
        return;
      case 'hollow_candle':
        renderCandles(ctx, candles, true, false);
        return;
      case 'volume_candle':
        renderCandles(ctx, candles, false, true);
        return;
      case 'column':
        renderColumns(ctx, candles);
        return;
      case 'step_line':
        renderStepLine(ctx, candles);
        return;
      case 'hlc':
        renderHLC(ctx, candles);
        return;
      case 'high_low':
        renderHighLow(ctx, candles);
        return;
      case 'candlestick':
      case 'heikin_ashi':
      case 'renko':
      case 'range_bar':
      case 'tick_bar':
      case 'volume_bar':
      case 'dollar_bar':
      case 'delta_candle':
      case 'cvd_candle':
      case 'kagi':
      case 'point_and_figure':
      case 'line_break':
      case 'footprint':
      case 'tpo':
      case 'session_volume_profile':
      default:
        renderCandles(ctx, candles, false, false);
    }
  }
}

function visibleSlice(candles: Candle[], ctx: RenderContext): Candle[] {
  if (candles.length === 0) return candles;
  const { fromTime, toTime } = ctx.timeScale.visibleRange();
  // Binary search both ends.
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid]!.openTime < fromTime) lo = mid + 1;
    else hi = mid;
  }
  const start = Math.max(0, lo - 1);
  let endLo = start;
  let endHi = candles.length;
  while (endLo < endHi) {
    const mid = (endLo + endHi) >>> 1;
    if (candles[mid]!.openTime <= toTime) endLo = mid + 1;
    else endHi = mid;
  }
  return candles.slice(start, Math.min(candles.length, endLo + 1));
}

function renderCandles(
  ctx: RenderContext,
  candles: Candle[],
  hollow: boolean,
  volumeShaded: boolean,
): void {
  const { ctx: c, theme, timeScale, priceScale } = ctx;
  const barW = Math.max(1, timeScale.barPx() * 0.78);
  const halfW = barW / 2;

  // Volume normalization for `volume_candle` mode.
  let maxVol = 0;
  if (volumeShaded) {
    for (const k of candles) if (k.volume > maxVol) maxVol = k.volume;
  }

  c.save();
  c.lineWidth = 1;
  for (const k of candles) {
    const xCenter = Math.round(timeScale.timeToX((k.openTime + k.closeTime) / 2));
    const yOpen = priceScale.priceToY(k.open);
    const yClose = priceScale.priceToY(k.close);
    const yHigh = priceScale.priceToY(k.high);
    const yLow = priceScale.priceToY(k.low);
    const up = k.close >= k.open;
    const baseColor = up ? theme.bull : theme.bear;
    let fill = hollow && up ? theme.background : baseColor;
    let strokeWidth = 1;
    if (volumeShaded && maxVol > 0) {
      const ratio = Math.min(1, k.volume / maxVol);
      // Curve so the difference between quiet and explosive bars is unmistakable:
      // tiny volume → 18% body alpha, max volume → fully opaque body.
      const alpha = 0.18 + 0.82 * Math.pow(ratio, 0.55);
      fill = withAlpha(baseColor, alpha);
      // Top-quartile-volume bars get a heavy 2px outline so they jump out.
      strokeWidth = ratio > 0.75 ? 2 : 1;
    }

    // Wick
    c.strokeStyle = theme.wick;
    c.beginPath();
    c.moveTo(xCenter + 0.5, yHigh);
    c.lineTo(xCenter + 0.5, yLow);
    c.stroke();

    // Body
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(1, Math.abs(yClose - yOpen));
    c.fillStyle = fill;
    c.strokeStyle = baseColor;
    c.lineWidth = strokeWidth;
    if (hollow) {
      c.fillRect(xCenter - halfW, bodyTop, halfW * 2, bodyH);
      c.strokeRect(xCenter - halfW + 0.5, bodyTop + 0.5, halfW * 2 - 1, bodyH - 1);
    } else if (volumeShaded) {
      c.fillRect(xCenter - halfW, bodyTop, halfW * 2, bodyH);
      // Always outline volume candles so the body is visible at low alphas.
      c.strokeRect(xCenter - halfW + 0.5, bodyTop + 0.5, halfW * 2 - 1, bodyH - 1);
    } else {
      c.fillRect(xCenter - halfW, bodyTop, halfW * 2, bodyH);
    }
    c.lineWidth = 1;
  }
  c.restore();
}

/** High-low: a thin vertical bar between high and low with no body. */
function renderHighLow(ctx: RenderContext, candles: Candle[]): void {
  const { ctx: c, theme, timeScale, priceScale } = ctx;
  c.save();
  c.lineWidth = Math.max(1, timeScale.barPx() * 0.6);
  for (const k of candles) {
    const xCenter = Math.round(timeScale.timeToX((k.openTime + k.closeTime) / 2));
    const yHigh = priceScale.priceToY(k.high);
    const yLow = priceScale.priceToY(k.low);
    c.strokeStyle = k.close >= k.open ? theme.bull : theme.bear;
    c.beginPath();
    c.moveTo(xCenter + 0.5, yHigh);
    c.lineTo(xCenter + 0.5, yLow);
    c.stroke();
  }
  c.restore();
}

/** HLC area: shaded band between high and low, with the close drawn as a crisp line. */
function renderHlcArea(ctx: RenderContext, candles: Candle[]): void {
  const { ctx: c, theme, timeScale, priceScale } = ctx;
  if (candles.length === 0) return;
  c.save();
  // Top edge (highs) → bottom edge (lows) → fill.
  c.beginPath();
  candles.forEach((k, i) => {
    const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
    const y = priceScale.priceToY(k.high);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  });
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    const k = candles[i]!;
    const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
    const y = priceScale.priceToY(k.low);
    c.lineTo(x, y);
  }
  c.closePath();
  c.fillStyle = withAlpha(theme.accent, 0.16);
  c.fill();

  // Close line over the band
  c.beginPath();
  candles.forEach((k, i) => {
    const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
    const y = priceScale.priceToY(k.close);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  });
  c.strokeStyle = theme.accent;
  c.lineWidth = 1.6;
  c.stroke();
  c.restore();
}

function renderOHLC(ctx: RenderContext, candles: Candle[]): void {
  const { ctx: c, theme, timeScale, priceScale } = ctx;
  const barW = Math.max(1, timeScale.barPx() * 0.7);
  const halfW = barW / 2;
  c.save();
  c.lineWidth = 1;
  for (const k of candles) {
    const xCenter = Math.round(timeScale.timeToX((k.openTime + k.closeTime) / 2));
    const yOpen = priceScale.priceToY(k.open);
    const yClose = priceScale.priceToY(k.close);
    const yHigh = priceScale.priceToY(k.high);
    const yLow = priceScale.priceToY(k.low);
    c.strokeStyle = k.close >= k.open ? theme.bull : theme.bear;
    c.beginPath();
    c.moveTo(xCenter + 0.5, yHigh);
    c.lineTo(xCenter + 0.5, yLow);
    c.moveTo(xCenter - halfW, yOpen);
    c.lineTo(xCenter + 0.5, yOpen);
    c.moveTo(xCenter + 0.5, yClose);
    c.lineTo(xCenter + halfW, yClose);
    c.stroke();
  }
  c.restore();
}

function renderHLC(ctx: RenderContext, candles: Candle[]): void {
  const { ctx: c, theme, timeScale, priceScale } = ctx;
  const barW = Math.max(1, timeScale.barPx() * 0.7);
  const halfW = barW / 2;
  c.save();
  c.lineWidth = 1;
  for (const k of candles) {
    const xCenter = Math.round(timeScale.timeToX((k.openTime + k.closeTime) / 2));
    const yClose = priceScale.priceToY(k.close);
    const yHigh = priceScale.priceToY(k.high);
    const yLow = priceScale.priceToY(k.low);
    c.strokeStyle = k.close >= k.open ? theme.bull : theme.bear;
    c.beginPath();
    c.moveTo(xCenter + 0.5, yHigh);
    c.lineTo(xCenter + 0.5, yLow);
    c.moveTo(xCenter + 0.5, yClose);
    c.lineTo(xCenter + halfW, yClose);
    c.stroke();
  }
  c.restore();
}

function renderLine(
  ctx: RenderContext,
  candles: Candle[],
  fillArea: boolean,
  withMarkers: boolean,
): void {
  const { ctx: c, theme, timeScale, priceScale, geometry } = ctx;
  if (candles.length === 0) return;
  c.save();
  c.strokeStyle = theme.accent;
  c.lineWidth = 1.6;
  c.beginPath();
  candles.forEach((k, i) => {
    const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
    const y = priceScale.priceToY(k.close);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  });
  c.stroke();
  if (fillArea) {
    const last = candles[candles.length - 1]!;
    const first = candles[0]!;
    c.lineTo(timeScale.timeToX((last.openTime + last.closeTime) / 2), geometry.pricePane.y + geometry.pricePane.height);
    c.lineTo(timeScale.timeToX((first.openTime + first.closeTime) / 2), geometry.pricePane.y + geometry.pricePane.height);
    c.closePath();
    const grad = c.createLinearGradient(0, geometry.pricePane.y, 0, geometry.pricePane.y + geometry.pricePane.height);
    grad.addColorStop(0, withAlpha(theme.accent, 0.35));
    grad.addColorStop(1, withAlpha(theme.accent, 0.02));
    c.fillStyle = grad;
    c.fill();
  }
  if (withMarkers) {
    const barPx = timeScale.barPx();
    const r = Math.max(1.6, Math.min(3, barPx * 0.25));
    c.fillStyle = theme.accent;
    for (const k of candles) {
      const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
      const y = priceScale.priceToY(k.close);
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
}

function renderStepLine(ctx: RenderContext, candles: Candle[]): void {
  const { ctx: c, theme, timeScale, priceScale } = ctx;
  if (candles.length === 0) return;
  c.save();
  c.strokeStyle = theme.accent;
  c.lineWidth = 1.6;
  c.beginPath();
  candles.forEach((k, i) => {
    const xL = timeScale.timeToX(k.openTime);
    const xR = timeScale.timeToX(k.closeTime);
    const y = priceScale.priceToY(k.close);
    if (i === 0) c.moveTo(xL, y);
    else c.lineTo(xL, y);
    c.lineTo(xR, y);
  });
  c.stroke();
  c.restore();
}

function renderBaseline(ctx: RenderContext, candles: Candle[]): void {
  const { ctx: c, theme, timeScale, priceScale, geometry } = ctx;
  if (candles.length === 0) return;
  const base = candles[0]!.close;
  const yBase = priceScale.priceToY(base);
  c.save();
  c.strokeStyle = theme.textMuted;
  c.setLineDash([3, 4]);
  c.beginPath();
  c.moveTo(geometry.pricePane.x, yBase);
  c.lineTo(geometry.pricePane.x + geometry.pricePane.width, yBase);
  c.stroke();
  c.setLineDash([]);
  // Bull half (above base) filled with bull, bear half (below) bear.
  c.beginPath();
  candles.forEach((k, i) => {
    const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
    const y = priceScale.priceToY(k.close);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  });
  c.strokeStyle = theme.accent;
  c.lineWidth = 1.4;
  c.stroke();
  c.restore();
}

function renderColumns(ctx: RenderContext, candles: Candle[]): void {
  const { ctx: c, theme, timeScale, priceScale, geometry } = ctx;
  const barW = Math.max(1, timeScale.barPx() * 0.78);
  c.save();
  for (const k of candles) {
    const xCenter = Math.round(timeScale.timeToX((k.openTime + k.closeTime) / 2));
    const yClose = priceScale.priceToY(k.close);
    const yBase = geometry.pricePane.y + geometry.pricePane.height;
    c.fillStyle = k.close >= k.open ? theme.bull : theme.bear;
    c.fillRect(xCenter - barW / 2, yClose, barW, yBase - yClose);
  }
  c.restore();
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('rgba')) {
    return color.replace(/[\d.]+\)$/, `${alpha})`);
  }
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}
