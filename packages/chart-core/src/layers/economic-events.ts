import type { Layer, RenderContext } from './types';

/**
 * Economic calendar overlay (Phase 3 #13).
 *
 * Draws macro events as vertical markers on the price/volume panes: a faint impact-coloured
 * dashed line at the event time, a small currency tag near the time axis, and — when the
 * crosshair is near a marker — a compact tooltip with the title, forecast and previous reading.
 *
 * Data is pushed in via `options.events` (already fetched from the real calendar feed by the
 * web layer); this layer is purely presentational and never invents events.
 */

export type EconomicImpact = 'high' | 'medium' | 'low' | 'holiday';

export interface EconomicEventMarker {
  time: number;
  impact: EconomicImpact;
  currency: string;
  title: string;
  forecast?: string;
  previous?: string;
}

export interface EconomicEventsLayerOptions {
  events: EconomicEventMarker[];
  /** Lowest impact to draw. Default 'medium' (hide the long tail of low-impact prints). */
  minImpact: 'low' | 'medium' | 'high';
}

const RANK: Record<EconomicImpact, number> = { holiday: 0, low: 1, medium: 2, high: 3 };
const IMPACT_COLOR: Record<EconomicImpact, string> = {
  high: '#ef5350',
  medium: '#d9a441',
  low: '#8b95a7',
  holiday: '#6b7383',
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class EconomicEventsLayer implements Layer {
  readonly id = 'economic-events';
  // Above the candle series (10) so markers + tags are visible, below indicators/crosshair.
  readonly zIndex = 11;
  visible = false;
  options: EconomicEventsLayerOptions = { events: [], minImpact: 'medium' };

  render(rc: RenderContext): void {
    const { events, minImpact } = this.options;
    if (!this.visible || events.length === 0) return;

    const { ctx, timeScale, geometry, theme, crosshair } = rc;
    const minRank = RANK[minImpact] ?? 2;
    const { fromTime, toTime } = timeScale.visibleRange();
    const x0 = geometry.pricePane.x;
    const x1 = x0 + geometry.pricePane.width;
    const yTop = geometry.pricePane.y;
    const yBot = geometry.pricePane.y + geometry.pricePane.height + geometry.volumePane.height;

    ctx.save();
    ctx.font = `600 9px ${theme.font.family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let hovered: EconomicEventMarker | null = null;
    let hoveredX = 0;
    let hoveredDist = Infinity;

    for (const e of events) {
      if ((RANK[e.impact] ?? 0) < minRank) continue;
      if (e.time < fromTime || e.time > toTime) continue;
      const x = timeScale.timeToX(e.time);
      if (x < x0 || x > x1) continue;

      const color = IMPACT_COLOR[e.impact] ?? IMPACT_COLOR.low;
      const px = Math.round(x) + 0.5;

      // Faint dashed vertical line spanning price + volume panes.
      ctx.beginPath();
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.globalAlpha = e.impact === 'high' ? 0.5 : 0.3;
      ctx.strokeStyle = color;
      ctx.moveTo(px, yTop);
      ctx.lineTo(px, yBot);
      ctx.stroke();
      ctx.setLineDash([]);

      // Currency tag just above the time axis.
      const label = e.currency || '•';
      const tw = Math.max(18, ctx.measureText(label).width + 8);
      const th = 13;
      const tagX = Math.min(Math.max(x, x0 + tw / 2), x1 - tw / 2);
      const tagY = yBot - th - 2;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = color;
      roundRect(ctx, tagX - tw / 2, tagY, tw, th, 2);
      ctx.fill();
      ctx.fillStyle = theme.background;
      ctx.fillText(label, tagX, tagY + th / 2 + 0.5);
      ctx.globalAlpha = 1;

      if (crosshair) {
        const d = Math.abs(crosshair.x - x);
        if (d <= 5 && d < hoveredDist) {
          hoveredDist = d;
          hovered = e;
          hoveredX = x;
        }
      }
    }

    if (hovered) this.drawTooltip(ctx, theme, hovered, hoveredX, yTop, x0, x1);
    ctx.restore();
  }

  private drawTooltip(
    ctx: CanvasRenderingContext2D,
    theme: RenderContext['theme'],
    e: EconomicEventMarker,
    x: number,
    yTop: number,
    x0: number,
    x1: number,
  ): void {
    const color = IMPACT_COLOR[e.impact] ?? IMPACT_COLOR.low;
    const title = `${e.currency} · ${e.title}`;
    const detail =
      e.forecast || e.previous
        ? `Forecast ${e.forecast ?? '—'}   Prev ${e.previous ?? '—'}`
        : `${e.impact.toUpperCase()} impact`;

    ctx.font = `600 10px ${theme.font.family}`;
    const tWidth = ctx.measureText(title).width;
    ctx.font = `400 10px ${theme.font.family}`;
    const dWidth = ctx.measureText(detail).width;

    const pad = 7;
    const w = Math.min(260, Math.max(tWidth, dWidth) + pad * 2);
    const h = 34;
    let bx = x + 8;
    if (bx + w > x1) bx = x - w - 8;
    bx = Math.max(x0 + 2, Math.min(bx, x1 - w - 2));
    const by = yTop + 6;

    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.crosshairLabelBg;
    roundRect(ctx, bx, by, w, h, 4);
    ctx.fill();
    // Left impact accent bar.
    ctx.fillStyle = color;
    roundRect(ctx, bx, by, 3, h, 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.crosshairLabelText;
    ctx.font = `600 10px ${theme.font.family}`;
    ctx.fillText(this.clip(ctx, title, w - pad * 2), bx + pad, by + 11);
    ctx.fillStyle = theme.textMuted;
    ctx.font = `400 10px ${theme.font.family}`;
    ctx.fillText(this.clip(ctx, detail, w - pad * 2), bx + pad, by + 24);
  }

  private clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
    return `${s}…`;
  }
}
