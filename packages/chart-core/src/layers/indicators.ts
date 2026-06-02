import type { Layer, RenderContext } from './types';

export interface IndicatorOverlayLine {
  /** Stable per-instance id used to render-diff. */
  id: string;
  /** Output channel of the indicator (e.g. `value`, `upper`). */
  channel: string;
  /** Y values for each candle index. NaN entries are skipped. */
  values: number[];
  color: string;
  lineWidth?: number;
  /** Optional dashed pattern. */
  dash?: [number, number];
}

export interface IndicatorOverlayBand {
  id: string;
  upper: number[];
  lower: number[];
  fillColor: string;
  borderColor?: string;
  borderWidth?: number;
}

export interface IndicatorOverlayDots {
  id: string;
  values: number[];
  color: string;
  radius?: number;
}

export interface IndicatorsLayerOptions {
  lines: IndicatorOverlayLine[];
  bands: IndicatorOverlayBand[];
  dots: IndicatorOverlayDots[];
}

/**
 * Generic line/band/dot renderer for classic TA indicators that live in
 * the price pane (SMA, EMA, Bollinger, Donchian, Keltner, PSAR, etc.).
 *
 * Sub-pane oscillators (RSI, MACD, Stoch, ...) render in a separate React
 * canvas below the main chart, NOT inside this layer.
 */
export class IndicatorsLayer implements Layer {
  readonly id: string;
  readonly zIndex: number;
  visible = true;
  options: IndicatorsLayerOptions = { lines: [], bands: [], dots: [] };

  /** A second instance (e.g. PulseScript output) registers under a distinct id/zIndex. */
  constructor(opts?: { id?: string; zIndex?: number }) {
    this.id = opts?.id ?? 'indicators';
    this.zIndex = opts?.zIndex ?? 12;
  }

  render(ctx: RenderContext): void {
    if (!this.visible) return;
    const candles = ctx.frame.candles;
    if (candles.length === 0) return;
    const { ctx: c, timeScale, priceScale } = ctx;

    // Bands first (lower z-order).
    for (const band of this.options.bands) {
      c.save();
      c.beginPath();
      let started = false;
      for (let i = 0; i < candles.length; i++) {
        const v = band.upper[i];
        if (v == null || Number.isNaN(v)) continue;
        const x = (timeScale.timeToX(candles[i]!.openTime) + timeScale.timeToX(candles[i]!.closeTime)) / 2;
        const y = priceScale.priceToY(v);
        if (!started) {
          c.moveTo(x, y);
          started = true;
        } else c.lineTo(x, y);
      }
      // walk back along the lower band
      for (let i = candles.length - 1; i >= 0; i--) {
        const v = band.lower[i];
        if (v == null || Number.isNaN(v)) continue;
        const x = (timeScale.timeToX(candles[i]!.openTime) + timeScale.timeToX(candles[i]!.closeTime)) / 2;
        const y = priceScale.priceToY(v);
        c.lineTo(x, y);
      }
      c.closePath();
      c.fillStyle = band.fillColor;
      c.fill();
      if (band.borderColor && band.borderWidth) {
        c.strokeStyle = band.borderColor;
        c.lineWidth = band.borderWidth;
        c.stroke();
      }
      c.restore();
    }

    // Lines
    for (const line of this.options.lines) {
      c.save();
      c.beginPath();
      c.strokeStyle = line.color;
      c.lineWidth = line.lineWidth ?? 1.5;
      if (line.dash && line.dash.length === 2) c.setLineDash(line.dash);
      let started = false;
      for (let i = 0; i < candles.length; i++) {
        const v = line.values[i];
        if (v == null || Number.isNaN(v)) {
          started = false;
          continue;
        }
        const x = (timeScale.timeToX(candles[i]!.openTime) + timeScale.timeToX(candles[i]!.closeTime)) / 2;
        const y = priceScale.priceToY(v);
        if (!started) {
          c.moveTo(x, y);
          started = true;
        } else c.lineTo(x, y);
      }
      c.stroke();
      c.restore();
    }

    // Dots (e.g. PSAR)
    for (const dot of this.options.dots) {
      c.save();
      c.fillStyle = dot.color;
      const r = dot.radius ?? 2;
      for (let i = 0; i < candles.length; i++) {
        const v = dot.values[i];
        if (v == null || Number.isNaN(v)) continue;
        const x = (timeScale.timeToX(candles[i]!.openTime) + timeScale.timeToX(candles[i]!.closeTime)) / 2;
        const y = priceScale.priceToY(v);
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
  }
}
