import type { Layer, RenderContext } from './types';
import { chooseTimeStep, niceTicks } from './grid';

export class AxisLayer implements Layer {
  readonly id = 'axis';
  readonly zIndex = 95;
  visible = true;

  render(ctx: RenderContext): void {
    const { ctx: c, theme, geometry, priceScale, timeScale, crosshair, frame } = ctx;
    c.save();
    c.fillStyle = theme.surface;
    c.fillRect(geometry.axisPane.x, geometry.axisPane.y, geometry.axisPane.width, geometry.axisPane.height);
    c.fillRect(geometry.timeAxisPane.x, geometry.timeAxisPane.y, geometry.timeAxisPane.width, geometry.timeAxisPane.height);

    c.fillStyle = theme.textAxis;
    c.font = `${theme.font.sizeAxis}px ${theme.font.family}`;
    c.textBaseline = 'middle';
    c.textAlign = 'left';

    const priceTicks = niceTicks(priceScale.state.priceMin, priceScale.state.priceMax, 8);
    for (const p of priceTicks) {
      const y = priceScale.priceToY(p);
      if (y < 0 || y > geometry.pricePane.y + geometry.pricePane.height) continue;
      c.fillText(formatPrice(p), geometry.axisPane.x + 6, y);
    }

    // Time axis ticks
    const { fromTime, toTime } = timeScale.visibleRange();
    const step = chooseTimeStep(toTime - fromTime, geometry.pricePane.width);
    const first = Math.ceil(fromTime / step) * step;
    c.textAlign = 'center';
    for (let t = first; t <= toTime; t += step) {
      const x = timeScale.timeToX(t);
      c.fillText(formatTime(t, step), x, geometry.timeAxisPane.y + geometry.timeAxisPane.height / 2);
    }

    // Last price line
    const last = frame.candles[frame.candles.length - 1];
    if (last) {
      const y = priceScale.priceToY(last.close);
      const up = last.close >= last.open;
      c.strokeStyle = up ? theme.bull : theme.bear;
      c.setLineDash([2, 2]);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(geometry.pricePane.x, Math.round(y) + 0.5);
      c.lineTo(geometry.pricePane.x + geometry.pricePane.width, Math.round(y) + 0.5);
      c.stroke();
      c.setLineDash([]);

      // Price label tag on axis
      const label = formatPrice(last.close);
      const padding = 4;
      const tw = c.measureText(label).width + padding * 2;
      const th = theme.font.sizeAxis + 6;
      c.fillStyle = up ? theme.bull : theme.bear;
      c.fillRect(geometry.axisPane.x + 1, y - th / 2, tw, th);
      c.fillStyle = '#0a0c10';
      c.textAlign = 'left';
      c.fillText(label, geometry.axisPane.x + 1 + padding, y);
    }

    // Crosshair labels
    if (crosshair) {
      const label = formatPrice(crosshair.price);
      const padding = 4;
      const tw = c.measureText(label).width + padding * 2;
      const th = theme.font.sizeAxis + 6;
      c.fillStyle = theme.crosshairLabelBg;
      c.fillRect(geometry.axisPane.x + 1, crosshair.y - th / 2, tw, th);
      c.fillStyle = theme.crosshairLabelText;
      c.textAlign = 'left';
      c.fillText(label, geometry.axisPane.x + 1 + padding, crosshair.y);

      const tStep = chooseTimeStep(toTime - fromTime, geometry.pricePane.width);
      const timeLabel = formatTime(crosshair.time, tStep, true);
      const ttw = c.measureText(timeLabel).width + padding * 2;
      const tth = th;
      c.fillStyle = theme.crosshairLabelBg;
      c.fillRect(crosshair.x - ttw / 2, geometry.timeAxisPane.y + 2, ttw, tth);
      c.fillStyle = theme.crosshairLabelText;
      c.textAlign = 'center';
      c.fillText(timeLabel, crosshair.x, geometry.timeAxisPane.y + 2 + tth / 2);
    }

    c.restore();
  }
}

export function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return '-';
  const abs = Math.abs(p);
  if (abs >= 1000) return p.toFixed(2);
  if (abs >= 1) return p.toFixed(4);
  if (abs >= 0.01) return p.toFixed(5);
  if (abs >= 0.0001) return p.toFixed(7);
  // Sub-fraction assets like SHIB / PEPE — show enough decimals to distinguish ticks.
  return p.toPrecision(4);
}

export function formatTime(t: number, step: number, includeSeconds = false): string {
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  if (step >= 30 * 24 * 3600_000) return `${yyyy}-${mm}`;
  if (step >= 24 * 3600_000) return `${mm}-${dd}`;
  if (step >= 3600_000) {
    // Show date once per day on the hour axis so users don't lose track when scrolling across days.
    if (hh === '00') return `${mm}-${dd}`;
    return `${hh}:${mi}`;
  }
  if (step >= 60_000) return includeSeconds ? `${hh}:${mi}:${ss}` : `${hh}:${mi}`;
  return `${hh}:${mi}:${ss}`;
}
