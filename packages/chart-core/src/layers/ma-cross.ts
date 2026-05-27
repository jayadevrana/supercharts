import type { Layer, RenderContext } from './types';
import type { MaCrossResult } from '../indicators/ma-cross';

export interface MaCrossLayerOptions {
  enabled: boolean;
  /** Color of the fast / primary MA. */
  lineColor: string;
  /** Color of the slow MA (only used in dual-MA mode). */
  slowLineColor: string;
  lineWidth: number;
  buyColor: string;
  sellColor: string;
  buyLabel: string;
  sellLabel: string;
}

export const DEFAULT_MA_CROSS_LAYER_OPTIONS: MaCrossLayerOptions = {
  enabled: false,
  lineColor: '#f5d524',
  slowLineColor: '#7c9cff',
  lineWidth: 1.6,
  buyColor: '#22c55e',
  sellColor: '#ef4444',
  buyLabel: 'BUY',
  sellLabel: 'SELL',
};

/**
 * Renders the MA line plus a BUY/SELL chip at each crossover bar.
 *
 * Design notes:
 *   - Labels are anchored to the bar's openTime midpoint, NOT clamped to viewport
 *     edges. When the user pans far off-screen the chip simply disappears rather than
 *     sliding along the edge — that would mislead the eye into thinking a fresh signal
 *     fired at the visible bar.
 *   - BUY chips sit below the bar's low; SELL chips sit above the bar's high. This
 *     mirrors how TradingView places the "▲" / "▼" markers and avoids the chips
 *     overlapping the candle body in tight trends.
 */
export class MaCrossLayer implements Layer {
  readonly id = 'ma-cross';
  readonly zIndex = 18;
  visible = false;
  options: MaCrossLayerOptions;
  frame: MaCrossResult | null = null;

  constructor(opts: Partial<MaCrossLayerOptions> = {}) {
    this.options = { ...DEFAULT_MA_CROSS_LAYER_OPTIONS, ...opts };
    this.visible = this.options.enabled;
  }

  setOptions(opts: Partial<MaCrossLayerOptions>): void {
    this.options = { ...this.options, ...opts };
    this.visible = this.options.enabled;
  }

  setFrame(frame: MaCrossResult | null): void {
    this.frame = frame;
  }

  render(rc: RenderContext): void {
    if (!this.visible || !this.frame || this.frame.ma.length === 0) return;
    const { ctx, frame, timeScale, priceScale, geometry, theme } = rc;
    const candles = frame.candles;
    if (candles.length === 0) return;

    ctx.save();
    // Clip to the price pane so the line doesn't bleed into the axis area.
    ctx.beginPath();
    ctx.rect(
      geometry.pricePane.x,
      geometry.pricePane.y,
      geometry.pricePane.width,
      geometry.pricePane.height,
    );
    ctx.clip();

    // ─── Slow MA line (dual-MA mode only) ───
    // Drawn first so the fast MA paints on top — easier to read the crossover.
    const maSlow = this.frame.maSlow;
    if (maSlow) {
      ctx.strokeStyle = this.options.slowLineColor;
      ctx.lineWidth = this.options.lineWidth;
      ctx.beginPath();
      let startedSlow = false;
      for (let i = 0; i < candles.length; i += 1) {
        const v = maSlow[i];
        if (!Number.isFinite(v!)) continue;
        const x = timeScale.timeToX((candles[i]!.openTime + candles[i]!.closeTime) / 2);
        const y = priceScale.priceToY(v!);
        if (!startedSlow) {
          ctx.moveTo(x, y);
          startedSlow = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    // ─── Fast MA line ───
    ctx.strokeStyle = this.options.lineColor;
    ctx.lineWidth = this.options.lineWidth;
    ctx.beginPath();
    let started = false;
    const ma = this.frame.ma;
    for (let i = 0; i < candles.length; i += 1) {
      const v = ma[i];
      if (!Number.isFinite(v!)) continue;
      const x = timeScale.timeToX((candles[i]!.openTime + candles[i]!.closeTime) / 2);
      const y = priceScale.priceToY(v!);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // ─── BUY / SELL chips at each crossover ───
    ctx.font = `600 10px ${theme.font.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of this.frame.crosses) {
      const candle = candles[c.index];
      if (!candle) continue;
      const x = timeScale.timeToX((candle.openTime + candle.closeTime) / 2);
      if (x < geometry.pricePane.x - 30 || x > geometry.pricePane.x + geometry.pricePane.width + 30) {
        continue;
      }
      const isBuy = c.side === 'buy';
      const text = isBuy ? this.options.buyLabel : this.options.sellLabel;
      const color = isBuy ? this.options.buyColor : this.options.sellColor;
      const y = isBuy
        ? priceScale.priceToY(candle.low) + 12
        : priceScale.priceToY(candle.high) - 12;

      const pad = 4;
      const tw = ctx.measureText(text).width + pad * 2;
      const th = 14;
      ctx.fillStyle = color;
      roundRect(ctx, x - tw / 2, y - th / 2, tw, th, 3);
      ctx.fill();
      // Pointer triangle so chip "anchors" to the bar.
      ctx.beginPath();
      if (isBuy) {
        ctx.moveTo(x, y - th / 2 - 4);
        ctx.lineTo(x - 4, y - th / 2);
        ctx.lineTo(x + 4, y - th / 2);
      } else {
        ctx.moveTo(x, y + th / 2 + 4);
        ctx.lineTo(x - 4, y + th / 2);
        ctx.lineTo(x + 4, y + th / 2);
      }
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x, y);
    }

    ctx.restore();
  }
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}
