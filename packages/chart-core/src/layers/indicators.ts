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
  /** Render as a stepped line (horizontal segments with vertical jumps between bars). */
  step?: boolean;
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

/** Filled area: a stroked line whose region down to the pane bottom is filled. */
export interface IndicatorOverlayArea {
  id: string;
  values: number[];
  color: string;
  fillColor: string;
  lineWidth?: number;
}

/** Histogram columns anchored at `base` (price units, default 0; clamped to the pane edge when off-screen). */
export interface IndicatorOverlayHist {
  id: string;
  values: number[];
  color: string;
  base?: number;
}

/** Constant horizontal reference line. */
export interface IndicatorOverlayLevel {
  id: string;
  y: number;
  color: string;
  dash?: [number, number];
  label?: string;
}

export type OverlayMarkerShape =
  | 'circle'
  | 'square'
  | 'diamond'
  | 'cross'
  | 'triangleUp'
  | 'triangleDown'
  | 'arrowUp'
  | 'arrowDown'
  | 'flag';

export interface IndicatorOverlayMarkerItem {
  /** Candle index. */
  index: number;
  shape: OverlayMarkerShape;
  /** Anchored over/under the bar's high/low unless an explicit `price` is set. */
  place: 'above' | 'below';
  price: number | null;
  color: string;
  text?: string | null;
  /** Half-size in px. */
  size: number;
}

export interface IndicatorOverlayMarkers {
  id: string;
  items: IndicatorOverlayMarkerItem[];
}

/** Per-candle translucent tint over the bar's high-low extent (script `paint candles`). */
export interface IndicatorOverlayTints {
  id: string;
  colors: (string | null)[];
}

export interface IndicatorsLayerOptions {
  lines: IndicatorOverlayLine[];
  bands: IndicatorOverlayBand[];
  dots: IndicatorOverlayDots[];
  areas?: IndicatorOverlayArea[];
  hists?: IndicatorOverlayHist[];
  levels?: IndicatorOverlayLevel[];
  markers?: IndicatorOverlayMarkers[];
  tints?: IndicatorOverlayTints[];
}

/**
 * Generic overlay renderer for indicator/script output in the price pane:
 * bands → areas → histograms → lines (straight or stepped) → dots → candle
 * tints → shape markers → reference levels (labels last so nothing covers them).
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
    const paneTop = ctx.geometry.pricePane.y;
    const paneBottom = ctx.geometry.pricePane.y + ctx.geometry.pricePane.height;
    const xMid = (i: number): number =>
      (timeScale.timeToX(candles[i]!.openTime) + timeScale.timeToX(candles[i]!.closeTime)) / 2;

    // Bands first (lower z-order).
    for (const band of this.options.bands) {
      c.save();
      c.beginPath();
      let started = false;
      for (let i = 0; i < candles.length; i++) {
        const v = band.upper[i];
        if (v == null || Number.isNaN(v)) continue;
        const y = priceScale.priceToY(v);
        if (!started) {
          c.moveTo(xMid(i), y);
          started = true;
        } else c.lineTo(xMid(i), y);
      }
      // walk back along the lower band
      for (let i = candles.length - 1; i >= 0; i--) {
        const v = band.lower[i];
        if (v == null || Number.isNaN(v)) continue;
        c.lineTo(xMid(i), priceScale.priceToY(v));
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

    // Areas — stroke + fill down to the pane bottom.
    for (const area of this.options.areas ?? []) {
      c.save();
      c.beginPath();
      let started = false;
      let firstX = 0;
      let lastX = 0;
      for (let i = 0; i < candles.length; i++) {
        const v = area.values[i];
        if (v == null || Number.isNaN(v)) continue;
        const x = xMid(i);
        const y = priceScale.priceToY(v);
        if (!started) {
          c.moveTo(x, y);
          firstX = x;
          started = true;
        } else c.lineTo(x, y);
        lastX = x;
      }
      if (!started) {
        c.restore();
        continue;
      }
      c.strokeStyle = area.color;
      c.lineWidth = area.lineWidth ?? 1.5;
      c.stroke();
      c.lineTo(lastX, paneBottom);
      c.lineTo(firstX, paneBottom);
      c.closePath();
      c.fillStyle = area.fillColor;
      c.fill();
      c.restore();
    }

    // Histogram columns from the base price (clamped to the pane when 0 is off-screen).
    for (const hist of this.options.hists ?? []) {
      c.save();
      c.fillStyle = hist.color;
      const baseY = Math.max(paneTop, Math.min(paneBottom, priceScale.priceToY(hist.base ?? 0)));
      for (let i = 0; i < candles.length; i++) {
        const v = hist.values[i];
        if (v == null || Number.isNaN(v)) continue;
        const xa = timeScale.timeToX(candles[i]!.openTime);
        const xb = timeScale.timeToX(candles[i]!.closeTime);
        const w = Math.max(1, (xb - xa) * 0.6);
        const x = (xa + xb) / 2 - w / 2;
        const y = priceScale.priceToY(v);
        c.fillRect(x, Math.min(y, baseY), w, Math.max(1, Math.abs(baseY - y)));
      }
      c.restore();
    }

    // Lines (straight or stepped)
    for (const line of this.options.lines) {
      c.save();
      c.beginPath();
      c.strokeStyle = line.color;
      c.lineWidth = line.lineWidth ?? 1.5;
      if (line.dash && line.dash.length === 2) c.setLineDash(line.dash);
      let started = false;
      let prevY = 0;
      for (let i = 0; i < candles.length; i++) {
        const v = line.values[i];
        if (v == null || Number.isNaN(v)) {
          started = false;
          continue;
        }
        const x = xMid(i);
        const y = priceScale.priceToY(v);
        if (!started) {
          c.moveTo(x, y);
          started = true;
        } else if (line.step) {
          c.lineTo(x, prevY);
          c.lineTo(x, y);
        } else c.lineTo(x, y);
        prevY = y;
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
        c.beginPath();
        c.arc(xMid(i), priceScale.priceToY(v), r, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    // Candle tints — translucent overlay across each painted bar's high-low box.
    for (const tint of this.options.tints ?? []) {
      c.save();
      for (let i = 0; i < candles.length && i < tint.colors.length; i++) {
        const color = tint.colors[i];
        if (!color) continue;
        const xa = timeScale.timeToX(candles[i]!.openTime);
        const xb = timeScale.timeToX(candles[i]!.closeTime);
        const yh = priceScale.priceToY(candles[i]!.high);
        const yl = priceScale.priceToY(candles[i]!.low);
        c.fillStyle = color;
        c.globalAlpha = 0.45;
        c.fillRect(xa + (xb - xa) * 0.15, yh - 1, (xb - xa) * 0.7, yl - yh + 2);
      }
      c.restore();
    }

    // Shape markers above/below bars (or at an explicit price).
    for (const group of this.options.markers ?? []) {
      for (const m of group.items) {
        const candle = candles[m.index];
        if (!candle) continue;
        const x = xMid(m.index);
        const pad = 6 + m.size;
        let y: number;
        if (m.price != null && Number.isFinite(m.price)) y = priceScale.priceToY(m.price);
        else if (m.place === 'above') y = priceScale.priceToY(candle.high) - pad;
        else y = priceScale.priceToY(candle.low) + pad;
        y = Math.max(paneTop + m.size, Math.min(paneBottom - m.size, y));
        this.drawShape(c, m.shape, x, y, m.size, m.color);
        if (m.text) {
          c.save();
          c.fillStyle = m.color;
          c.font = '10px ui-sans-serif, system-ui';
          c.textAlign = 'center';
          c.textBaseline = m.place === 'below' || (m.price != null && m.shape !== 'arrowUp') ? 'top' : 'bottom';
          const ty = c.textBaseline === 'top' ? y + m.size + 2 : y - m.size - 2;
          c.fillText(m.text, x, ty);
          c.restore();
        }
      }
    }

    // Reference levels last — full-width rules with a right-aligned label.
    for (const level of this.options.levels ?? []) {
      const y = priceScale.priceToY(level.y);
      if (!Number.isFinite(y) || y < paneTop || y > paneBottom) continue;
      c.save();
      c.strokeStyle = level.color;
      c.lineWidth = 1;
      if (level.dash) c.setLineDash(level.dash);
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(ctx.geometry.pricePane.width, y);
      c.stroke();
      if (level.label) {
        c.setLineDash([]);
        c.fillStyle = level.color;
        c.font = '10px ui-sans-serif, system-ui';
        c.textAlign = 'right';
        c.textBaseline = 'bottom';
        c.fillText(level.label, ctx.geometry.pricePane.width - 6, y - 2);
      }
      c.restore();
    }
  }

  private drawShape(
    c: CanvasRenderingContext2D,
    shape: OverlayMarkerShape,
    x: number,
    y: number,
    s: number,
    color: string,
  ): void {
    c.save();
    c.fillStyle = color;
    c.strokeStyle = color;
    c.lineWidth = Math.max(1.2, s / 3);
    c.beginPath();
    switch (shape) {
      case 'circle':
        c.arc(x, y, s, 0, Math.PI * 2);
        c.fill();
        break;
      case 'square':
        c.fillRect(x - s, y - s, s * 2, s * 2);
        break;
      case 'diamond':
        c.moveTo(x, y - s);
        c.lineTo(x + s, y);
        c.lineTo(x, y + s);
        c.lineTo(x - s, y);
        c.closePath();
        c.fill();
        break;
      case 'cross':
        c.moveTo(x - s, y - s);
        c.lineTo(x + s, y + s);
        c.moveTo(x + s, y - s);
        c.lineTo(x - s, y + s);
        c.stroke();
        break;
      case 'triangleUp':
        c.moveTo(x, y - s);
        c.lineTo(x + s, y + s);
        c.lineTo(x - s, y + s);
        c.closePath();
        c.fill();
        break;
      case 'triangleDown':
        c.moveTo(x, y + s);
        c.lineTo(x + s, y - s);
        c.lineTo(x - s, y - s);
        c.closePath();
        c.fill();
        break;
      case 'arrowUp':
        c.moveTo(x, y - s);
        c.lineTo(x + s, y);
        c.lineTo(x + s * 0.4, y);
        c.lineTo(x + s * 0.4, y + s);
        c.lineTo(x - s * 0.4, y + s);
        c.lineTo(x - s * 0.4, y);
        c.lineTo(x - s, y);
        c.closePath();
        c.fill();
        break;
      case 'arrowDown':
        c.moveTo(x, y + s);
        c.lineTo(x + s, y);
        c.lineTo(x + s * 0.4, y);
        c.lineTo(x + s * 0.4, y - s);
        c.lineTo(x - s * 0.4, y - s);
        c.lineTo(x - s * 0.4, y);
        c.lineTo(x - s, y);
        c.closePath();
        c.fill();
        break;
      case 'flag':
        c.moveTo(x - s * 0.6, y + s);
        c.lineTo(x - s * 0.6, y - s);
        c.lineTo(x + s, y - s * 0.55);
        c.lineTo(x - s * 0.6, y - s * 0.1);
        c.fill();
        c.beginPath();
        c.moveTo(x - s * 0.6, y + s);
        c.lineTo(x - s * 0.6, y - s);
        c.stroke();
        break;
    }
    c.restore();
  }
}

/**
 * Background shading behind the candles (script `paint bg`) — one translucent
 * vertical strip per painted candle slot. Registered below the price series.
 */
export class ShadeLayer implements Layer {
  readonly id: string;
  readonly zIndex: number;
  visible = true;
  options: { colors: (string | null)[] } = { colors: [] };

  constructor(opts?: { id?: string; zIndex?: number }) {
    this.id = opts?.id ?? 'pulse-bg';
    this.zIndex = opts?.zIndex ?? 2;
  }

  render(ctx: RenderContext): void {
    if (!this.visible) return;
    const candles = ctx.frame.candles;
    const colors = this.options.colors;
    if (candles.length === 0 || colors.length === 0) return;
    const { ctx: c, timeScale } = ctx;
    const top = ctx.geometry.pricePane.y;
    const h = ctx.geometry.pricePane.height;
    c.save();
    for (let i = 0; i < candles.length && i < colors.length; i++) {
      const color = colors[i];
      if (!color) continue;
      const xa = timeScale.timeToX(candles[i]!.openTime);
      const xb = timeScale.timeToX(candles[i]!.closeTime);
      c.fillStyle = color;
      c.fillRect(xa, top, Math.max(1, xb - xa), h);
    }
    c.restore();
  }
}
