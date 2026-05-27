import type { Layer, RenderContext } from './types';

export class CrosshairLayer implements Layer {
  readonly id = 'crosshair';
  readonly zIndex = 90;
  visible = true;

  render(ctx: RenderContext): void {
    const { crosshair, externalCrosshairTime, ctx: c, theme, geometry, timeScale } = ctx;

    // External (cross-pane) crosshair: soft vertical line + label, only when no local one.
    if (!crosshair && externalCrosshairTime != null) {
      const x = timeScale.timeToX(externalCrosshairTime);
      if (x >= geometry.pricePane.x && x <= geometry.pricePane.x + geometry.pricePane.width) {
        c.save();
        c.strokeStyle = theme.crosshair;
        c.globalAlpha = 0.6;
        c.lineWidth = 1;
        c.setLineDash([2, 4]);
        c.beginPath();
        c.moveTo(Math.round(x) + 0.5, geometry.pricePane.y);
        c.lineTo(
          Math.round(x) + 0.5,
          geometry.pricePane.y + geometry.pricePane.height + geometry.volumePane.height,
        );
        c.stroke();
        c.setLineDash([]);
        c.restore();
      }
    }

    if (!crosshair) return;
    const { x, y } = crosshair;
    c.save();
    c.strokeStyle = theme.crosshair;
    c.lineWidth = 1;
    c.setLineDash([3, 3]);
    c.beginPath();
    c.moveTo(geometry.pricePane.x, Math.round(y) + 0.5);
    c.lineTo(geometry.pricePane.x + geometry.pricePane.width, Math.round(y) + 0.5);
    c.moveTo(Math.round(x) + 0.5, geometry.pricePane.y);
    c.lineTo(
      Math.round(x) + 0.5,
      geometry.pricePane.y + geometry.pricePane.height + geometry.volumePane.height,
    );
    c.stroke();
    c.setLineDash([]);
    c.restore();
  }
}
