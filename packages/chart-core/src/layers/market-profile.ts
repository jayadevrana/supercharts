import type { Candle } from '@supercharts/types';
import type { Layer, RenderContext } from './types';
import { buildMarketProfiles, type SessionProfile } from '../market-profile';

export interface MarketProfileLayerOptions {
  bins: number;
  valueAreaPercent: number;
  showPOC: boolean;
}

/**
 * Per-session Market Profile / TPO histogram, drawn as a translucent backdrop
 * behind the candles (one profile per UTC session, anchored at the session
 * open and growing right). Value-area rows are brighter, the POC row is a gold
 * line. Profiles are memoised on the candle set so pan/zoom doesn't recompute.
 */
export class MarketProfileLayer implements Layer {
  readonly id = 'market-profile';
  readonly zIndex = 4;
  visible = false;
  options: MarketProfileLayerOptions;

  private cache: SessionProfile[] = [];
  private cacheKey = '';

  constructor(opts: Partial<MarketProfileLayerOptions> = {}) {
    this.options = { bins: 40, valueAreaPercent: 0.7, showPOC: true, ...opts };
  }

  private profilesFor(candles: readonly Candle[]): SessionProfile[] {
    const key =
      candles.length === 0
        ? '0'
        : `${candles.length}:${candles[0]!.openTime}:${candles[candles.length - 1]!.openTime}:${this.options.bins}`;
    if (key !== this.cacheKey) {
      this.cache = buildMarketProfiles(candles, {
        bins: this.options.bins,
        valueAreaPercent: this.options.valueAreaPercent,
      });
      this.cacheKey = key;
    }
    return this.cache;
  }

  render(ctx: RenderContext): void {
    if (!this.visible) return;
    const candles = ctx.frame.candles;
    if (candles.length === 0) return;
    const { ctx: c, timeScale, priceScale, geometry } = ctx;
    const pane = geometry.pricePane;
    const profiles = this.profilesFor(candles);

    c.save();
    for (const p of profiles) {
      const x0 = timeScale.timeToX(p.startTime);
      const xEnd = timeScale.timeToX(p.endTime);
      if (xEnd < pane.x || x0 > pane.x + pane.width) continue; // off-screen session
      const sessionW = Math.max(8, xEnd - x0);
      // Pixel height of one price row (affine scale → offset-independent delta).
      const rowH = Math.max(1, Math.abs(priceScale.priceToY(0) - priceScale.priceToY(p.rowSize)));

      for (const row of p.rows) {
        const y = priceScale.priceToY(row.price);
        if (y < pane.y - rowH || y > pane.y + pane.height + rowH) continue;
        const w = (row.count / p.maxCount) * sessionW;
        const inVA = row.price >= p.val && row.price <= p.vah;
        c.fillStyle = inVA ? 'rgba(124,148,255,0.22)' : 'rgba(124,148,255,0.10)';
        c.fillRect(x0, y - rowH / 2, w, Math.max(1, rowH - 0.5));
      }

      if (this.options.showPOC) {
        const yp = priceScale.priceToY(p.poc);
        if (yp >= pane.y - rowH && yp <= pane.y + pane.height + rowH) {
          c.fillStyle = 'rgba(255,193,7,0.85)';
          c.fillRect(x0, yp - Math.max(0.6, rowH / 2), sessionW, Math.max(1.2, rowH));
        }
      }
    }
    c.restore();
  }
}
