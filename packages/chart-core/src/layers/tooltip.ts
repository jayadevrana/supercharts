import type { Candle } from '@supercharts/types';
import type { Layer, RenderContext } from './types';

/**
 * Tooltip layer.
 *
 * Always highlights the hovered candle's column. The floating OHLCV panel that chases
 * the cursor is opt-in (`options.showPanel`) — the fixed symbol status line is the
 * default OHLC reading surface (TV model), so the panel ships off.
 */
export class TooltipLayer implements Layer {
  readonly id = 'tooltip';
  readonly zIndex = 97;
  visible = true;
  options: { showPanel: boolean } = { showPanel: false };

  render(ctx: RenderContext): void {
    const { ctx: c, theme, crosshair, frame, geometry, timeScale } = ctx;
    if (!crosshair) return;
    const candle = findCandleAt(frame.candles, crosshair.time);
    if (!candle) return;

    // Subtle highlight on the hovered candle column — independent of the panel.
    c.save();
    const colCenter = Math.round(timeScale.timeToX((candle.openTime + candle.closeTime) / 2));
    const colHalfW = Math.max(2, timeScale.barPx() * 0.78) / 2;
    c.fillStyle = candle.close >= candle.open ? theme.bullDim : theme.bearDim;
    c.globalAlpha = 0.18;
    c.fillRect(colCenter - colHalfW, geometry.pricePane.y, colHalfW * 2, geometry.pricePane.height);
    c.restore();

    if (!this.options.showPanel) return;

    const lines: Array<[string, string, string?]> = [
      ['O', formatLoose(candle.open), theme.textMuted],
      ['H', formatLoose(candle.high), theme.bull],
      ['L', formatLoose(candle.low), theme.bear],
      ['C', formatLoose(candle.close), candle.close >= candle.open ? theme.bull : theme.bear],
      ['V', compact(candle.volume), theme.textMuted],
      ['Δ', `${candle.delta >= 0 ? '+' : ''}${compact(candle.delta)}`, candle.delta >= 0 ? theme.bull : theme.bear],
    ];

    const padding = 8;
    const lineH = theme.font.sizeTooltip + 4;
    const labelW = 18;
    const valueW = 80;
    const w = padding * 2 + labelW + valueW;
    const h = padding * 2 + lines.length * lineH;

    // Position to the right of crosshair, flipping when it would clip the axis.
    let x = crosshair.x + 14;
    let y = crosshair.y + 14;
    if (x + w > geometry.pricePane.x + geometry.pricePane.width) {
      x = crosshair.x - 14 - w;
    }
    if (y + h > geometry.pricePane.y + geometry.pricePane.height) {
      y = crosshair.y - 14 - h;
    }
    if (x < geometry.pricePane.x + 2) x = geometry.pricePane.x + 2;
    if (y < geometry.pricePane.y + 2) y = geometry.pricePane.y + 2;

    c.save();
    c.fillStyle = theme.surface;
    c.globalAlpha = 0.94;
    roundRect(c, x, y, w, h, 8);
    c.fill();
    c.globalAlpha = 1;
    c.strokeStyle = theme.border;
    c.lineWidth = 1;
    roundRect(c, x + 0.5, y + 0.5, w - 1, h - 1, 8);
    c.stroke();

    c.font = `${theme.font.sizeTooltip}px ${theme.font.family}`;
    c.textBaseline = 'middle';
    lines.forEach(([label, value, color], i) => {
      const ly = y + padding + lineH / 2 + i * lineH;
      c.fillStyle = theme.textMuted;
      c.textAlign = 'left';
      c.fillText(label, x + padding, ly);
      c.fillStyle = color ?? theme.text;
      c.textAlign = 'right';
      c.fillText(value, x + padding + labelW + valueW, ly);
    });

    // Time/date strip across the top
    c.fillStyle = theme.textMuted;
    c.textAlign = 'left';
    c.font = `600 ${theme.font.sizeAxis - 1}px ${theme.font.family}`;
    const dt = new Date(candle.openTime);
    const stamp = `${pad2(dt.getUTCMonth() + 1)}/${pad2(dt.getUTCDate())} ${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())} UTC`;
    c.fillText(stamp, x + padding, y - 4);

    c.restore();
  }
}

function findCandleAt(candles: ReadonlyArray<Candle>, time: number): Candle | undefined {
  if (candles.length === 0) return undefined;
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid]!.openTime <= time) lo = mid + 1;
    else hi = mid;
  }
  const idx = Math.max(0, lo - 1);
  const c = candles[idx];
  if (!c) return undefined;
  // require time to fall within the candle bucket
  if (time >= c.openTime && time <= c.closeTime) return c;
  // tolerate a half-bar of slack so the user doesn't lose the tooltip between bars
  const slack = (c.closeTime - c.openTime) / 2;
  if (time >= c.openTime - slack && time <= c.closeTime + slack) return c;
  return undefined;
}

function formatLoose(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(2);
  if (abs >= 1) return v.toFixed(4);
  if (abs >= 0.01) return v.toFixed(5);
  if (abs >= 0.0001) return v.toFixed(7);
  return v.toPrecision(4);
}

function compact(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}
