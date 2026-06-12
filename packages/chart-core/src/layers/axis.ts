import type { Layer, RenderContext } from './types';
import { chooseTimeStep, niceTicks, priceTickTarget } from './grid';

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

    const priceTicks = niceTicks(
      priceScale.state.priceMin,
      priceScale.state.priceMax,
      priceTickTarget(geometry.pricePane.height),
    );
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
      // Keep tick labels inside the plot — a centered label at the right edge would
      // spill under the price gutter and collide with the crosshair/time tags.
      if (x > geometry.pricePane.width - 6) continue;
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

      // Price label tag on axis — with an optional bar-close countdown row (live bars only).
      const label = formatPrice(last.close);
      const countdown = barCloseCountdown(last.closeTime, Date.now());
      const padding = 4;
      const rowH = theme.font.sizeAxis + 6;
      const th = countdown ? rowH * 2 - 2 : rowH;
      const tw = Math.max(
        c.measureText(label).width,
        countdown ? c.measureText(countdown).width : 0,
      ) + padding * 2;
      const tagY = clamp(y, th / 2, Math.max(th / 2, geometry.axisPane.height - th / 2));
      c.fillStyle = up ? theme.bull : theme.bear;
      c.fillRect(geometry.axisPane.x + 1, tagY - th / 2, tw, th);
      c.fillStyle = '#0a0c10';
      c.textAlign = 'left';
      if (countdown) {
        c.fillText(label, geometry.axisPane.x + 1 + padding, tagY - th / 2 + rowH / 2);
        c.globalAlpha = 0.78;
        c.fillText(countdown, geometry.axisPane.x + 1 + padding, tagY + th / 2 - rowH / 2 + 1);
        c.globalAlpha = 1;
      } else {
        c.fillText(label, geometry.axisPane.x + 1 + padding, tagY);
      }
    }

    // Crosshair labels
    if (crosshair) {
      const label = formatPrice(crosshair.price);
      const padding = 4;
      const tw = c.measureText(label).width + padding * 2;
      const th = theme.font.sizeAxis + 6;
      // Clamp inside the axis pane so the tag never clips at the top/bottom edge.
      const labelY = clamp(crosshair.y, th / 2, Math.max(th / 2, geometry.axisPane.height - th / 2));
      c.fillStyle = theme.crosshairLabelBg;
      c.fillRect(geometry.axisPane.x + 1, labelY - th / 2, tw, th);
      c.fillStyle = theme.crosshairLabelText;
      c.textAlign = 'left';
      c.fillText(label, geometry.axisPane.x + 1 + padding, labelY);

      // Full date+time tag (TV-style "Fri 12 Jun '26 14:30") — the axis ticks only show
      // the short form, so the crosshair is where the user reads the exact bar identity.
      // Bar durations come off real exchange candles (Binance 1m = 59,999ms), so round
      // to whole seconds before classifying the interval.
      const barSec = Math.round(timeScale.state.barDurationMs / 1000);
      const timeLabel = formatFullTime(crosshair.time, {
        includeSeconds: barSec > 0 && barSec < 60,
        includeTime: barSec < 24 * 3600,
      });
      const ttw = c.measureText(timeLabel).width + padding * 2;
      const tth = th;
      const tagX = clamp(crosshair.x, ttw / 2, Math.max(ttw / 2, geometry.width - ttw / 2 - 1));
      c.fillStyle = theme.crosshairLabelBg;
      c.fillRect(tagX - ttw / 2, geometry.timeAxisPane.y + 2, ttw, tth);
      c.fillStyle = theme.crosshairLabelText;
      c.textAlign = 'center';
      c.fillText(timeLabel, tagX, geometry.timeAxisPane.y + 2 + tth / 2);
    }

    c.restore();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * "mm:ss" (or "h:mm:ss") until the live bar closes — empty string once it's closed
 * (historical bars / static datasets must not show a frozen countdown).
 */
export function barCloseCountdown(closeTime: number, nowMs: number): string {
  const left = closeTime - nowMs;
  if (left <= 0 || !Number.isFinite(left)) return '';
  const totalSec = Math.floor(left / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return '-';
  const abs = Math.abs(p);
  if (abs >= 1000) return groupThousands(p.toFixed(2));
  if (abs >= 1) return p.toFixed(4);
  if (abs >= 0.01) return p.toFixed(5);
  if (abs >= 0.0001) return p.toFixed(7);
  // Sub-fraction assets like SHIB / PEPE — show enough decimals to distinguish ticks.
  return p.toPrecision(4);
}

/** "63796.48" → "63,796.48" (sign-safe). Only the integer part is grouped. */
export function groupThousands(fixed: string): string {
  const neg = fixed.startsWith('-');
  const body = neg ? fixed.slice(1) : fixed;
  const dot = body.indexOf('.');
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? '' : body.slice(dot);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + frac;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * TradingView-style full timestamp for the crosshair tag: "Fri 12 Jun '26 14:30".
 * Seconds appended for sub-minute bars; clock omitted entirely for daily+ bars.
 */
export function formatFullTime(
  t: number,
  opts: { includeSeconds?: boolean; includeTime?: boolean } = {},
): string {
  const d = new Date(t);
  const date = `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${
    MONTHS[d.getUTCMonth()]
  } '${String(d.getUTCFullYear() % 100).padStart(2, '0')}`;
  if (opts.includeTime === false) return date;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return opts.includeSeconds ? `${date} ${hh}:${mi}:${ss}` : `${date} ${hh}:${mi}`;
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
