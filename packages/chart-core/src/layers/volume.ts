import type { Layer, RenderContext } from './types';

export class VolumeLayer implements Layer {
  readonly id = 'volume';
  readonly zIndex = 5;
  visible = true;

  render(ctx: RenderContext): void {
    const { geometry, ctx: c, theme, timeScale, frame, volumeScale } = ctx;
    if (geometry.volumePane.height <= 0) return;
    const { fromTime, toTime } = timeScale.visibleRange();
    let maxVol = 0;
    for (const k of frame.candles) {
      if (k.openTime < fromTime || k.openTime > toTime) continue;
      if (k.volume > maxVol) maxVol = k.volume;
    }
    if (maxVol <= 0) return;
    volumeScale.state.priceMin = 0;
    volumeScale.state.priceMax = maxVol * 1.05;
    volumeScale.state.height = geometry.volumePane.height;

    const barW = Math.max(1, timeScale.barPx() * 0.78);
    const baselineY = geometry.volumePane.y + geometry.volumePane.height;
    c.save();
    for (const k of frame.candles) {
      if (k.openTime < fromTime || k.openTime > toTime) continue;
      const xCenter = Math.round(timeScale.timeToX((k.openTime + k.closeTime) / 2));
      const h = (k.volume / volumeScale.state.priceMax) * geometry.volumePane.height;
      c.fillStyle = k.close >= k.open ? theme.volumeBull : theme.volumeBear;
      c.fillRect(xCenter - barW / 2, baselineY - h, barW, h);
    }
    c.restore();
  }
}
