import type { Layer, RenderContext } from './types';

export interface VolumeProfileLayerOptions {
  /** Width of the profile zone as a fraction of pricePane.width (0..0.5). */
  widthFraction: number;
  /** Anchor — `right` overlays at right of pricePane; `left` at left. */
  anchor: 'right' | 'left';
  showPOC: boolean;
  showValueArea: boolean;
  showBuySellSplit: boolean;
}

export class VolumeProfileLayer implements Layer {
  readonly id = 'volume-profile';
  readonly zIndex = 4;
  visible = true;
  options: VolumeProfileLayerOptions;

  constructor(opts: Partial<VolumeProfileLayerOptions> = {}) {
    this.options = {
      widthFraction: 0.22,
      anchor: 'right',
      showPOC: true,
      showValueArea: true,
      showBuySellSplit: true,
      ...opts,
    };
  }

  render(ctx: RenderContext): void {
    const profile = ctx.frame.volumeProfile;
    if (!profile || profile.levels.length === 0) return;
    const { ctx: c, theme, geometry, priceScale } = ctx;
    const pane = geometry.pricePane;
    const w = pane.width * this.options.widthFraction;
    const baseX = this.options.anchor === 'right' ? pane.x + pane.width - w : pane.x;
    // Plain loop, never `Math.max(...spread)` — a large levels array would overflow the
    // call stack (RangeError) when spread as function arguments.
    let maxVol = 1;
    for (const l of profile.levels) if (l.totalVolume > maxVol) maxVol = l.totalVolume;

    c.save();
    // Optional value area shading.
    if (this.options.showValueArea) {
      const yTop = priceScale.priceToY(profile.vah);
      const yBot = priceScale.priceToY(profile.val);
      c.fillStyle = theme.valueArea;
      c.fillRect(pane.x, Math.min(yTop, yBot), pane.width, Math.abs(yBot - yTop));
    }

    const rowEstimate = profile.rowSize;
    const rowH = Math.max(1, Math.abs(priceScale.priceToY(0) - priceScale.priceToY(rowEstimate)));

    for (const level of profile.levels) {
      const y = priceScale.priceToY(level.priceLevel);
      if (y < pane.y - rowH || y > pane.y + pane.height + rowH) continue;
      const lengthTotal = (level.totalVolume / maxVol) * w;
      if (this.options.showBuySellSplit && level.totalVolume > 0) {
        const buyLen = (level.buyVolume / maxVol) * w;
        const sellLen = (level.sellVolume / maxVol) * w;
        const drawAt = this.options.anchor === 'right' ? baseX + w : baseX;
        c.fillStyle = theme.bullDim;
        if (this.options.anchor === 'right') c.fillRect(drawAt - buyLen, y - rowH / 2, buyLen, rowH);
        else c.fillRect(drawAt, y - rowH / 2, buyLen, rowH);
        c.fillStyle = theme.bearDim;
        if (this.options.anchor === 'right') c.fillRect(drawAt - buyLen - sellLen, y - rowH / 2, sellLen, rowH);
        else c.fillRect(drawAt + buyLen, y - rowH / 2, sellLen, rowH);
      } else {
        c.fillStyle = level.isPOC ? theme.poc : theme.accent;
        c.globalAlpha = 0.55;
        c.fillRect(
          this.options.anchor === 'right' ? baseX + w - lengthTotal : baseX,
          y - rowH / 2,
          lengthTotal,
          rowH,
        );
        c.globalAlpha = 1;
      }
    }

    if (this.options.showPOC) {
      const y = priceScale.priceToY(profile.poc);
      c.strokeStyle = theme.poc;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(baseX, Math.round(y) + 0.5);
      c.lineTo(baseX + w, Math.round(y) + 0.5);
      c.stroke();
    }
    c.restore();
  }
}

export { buildVisibleRangeProfile } from '../profile-builder';
