import type { Layer, RenderContext } from './types';

export interface DeepTradesLayerOptions {
  bubbleScale: number;
  /** Don't draw bubbles smaller than this. */
  minPxRadius: number;
  /** Cap bubble radius so giant prints don't dominate. */
  maxPxRadius: number;
}

export class DeepTradesLayer implements Layer {
  readonly id = 'deep-trades';
  readonly zIndex = 20;
  visible = true;
  options: DeepTradesLayerOptions;

  constructor(opts: Partial<DeepTradesLayerOptions> = {}) {
    this.options = { bubbleScale: 1, minPxRadius: 2.5, maxPxRadius: 26, ...opts };
  }

  render(ctx: RenderContext): void {
    const { ctx: c, theme, geometry, frame, timeScale, priceScale } = ctx;
    const { fromTime, toTime } = timeScale.visibleRange();
    c.save();
    for (const b of frame.deepTrades) {
      if (b.eventTime < fromTime || b.eventTime > toTime) continue;
      const x = timeScale.timeToX(b.eventTime);
      const y = priceScale.priceToY(b.price);
      if (y < geometry.pricePane.y || y > geometry.pricePane.y + geometry.pricePane.height) continue;
      const r = Math.min(
        this.options.maxPxRadius,
        Math.max(this.options.minPxRadius, Math.sqrt(b.intensity) * 18 * this.options.bubbleScale),
      );
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle =
        b.side === 'buyer'
          ? theme.bubble.buy
          : b.side === 'seller'
            ? theme.bubble.sell
            : theme.bubble.unknown;
      c.fill();
      c.strokeStyle = theme.bubble.stroke;
      c.lineWidth = 1;
      c.stroke();
      if (b.absorptionContext) {
        c.beginPath();
        c.arc(x, y, r + 2, 0, Math.PI * 2);
        c.strokeStyle = theme.poc;
        c.lineWidth = 1.5;
        c.stroke();
      }
    }
    c.restore();
  }
}
