import type { Layer, RenderContext } from './types';
import type { SignalsTrendScoreFrame } from '../indicators/signals-trend-score';

export interface SignalsTrendScoreLayerOptions {
  enabled: boolean;
  showMaCloud: boolean;
  showAtrTrail: boolean;
  showSignals: boolean;
  showUpHighlight: boolean;
  showDownHighlight: boolean;
  showSlTp: boolean;
}

const DEFAULT_OPTS: SignalsTrendScoreLayerOptions = {
  enabled: false,
  showMaCloud: true,
  showAtrTrail: true,
  showSignals: true,
  showUpHighlight: false,
  showDownHighlight: false,
  showSlTp: true,
};

/**
 * Renders the Signals & Trend Score indicator's on-chart visuals:
 *   - MA cloud band (EMA-high ↕ EMA-low fill + center line)
 *   - ATR trail dotted line (green when bullish, red when bearish)
 *   - Buy / Sell labels at flips
 *   - Optional up/down background tint
 *   - SL / TP guide lines + chips after the most recent signal
 */
export class SignalsTrendScoreLayer implements Layer {
  readonly id = 'signals-trend-score';
  readonly zIndex = 15;
  visible = false;
  options: SignalsTrendScoreLayerOptions;
  /** Set by the consumer (chart-pane) every frame this needs to draw. */
  frame: SignalsTrendScoreFrame | null = null;
  /** Most-recent signal details for SL/TP drawing. */
  lastTrade: {
    side: 'long' | 'short';
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    entryTime: number;
  } | null = null;

  constructor(opts: Partial<SignalsTrendScoreLayerOptions> = {}) {
    this.options = { ...DEFAULT_OPTS, ...opts };
  }

  render(ctx: RenderContext): void {
    if (!this.options.enabled || !this.frame) return;
    const candles = ctx.frame.candles;
    if (candles.length === 0) return;
    const f = this.frame;
    const { ctx: c, theme, timeScale, priceScale, geometry } = ctx;

    // -------- Background tint (Up/Down highlight) --------
    if (this.options.showUpHighlight || this.options.showDownHighlight) {
      // Tint the slice of the chart where the indicator dir matches.
      c.save();
      for (let i = 0; i < candles.length; i += 1) {
        const dir = f.trendDir[i] ?? 0;
        if (dir === 0) continue;
        if (dir > 0 && !this.options.showUpHighlight) continue;
        if (dir < 0 && !this.options.showDownHighlight) continue;
        const k = candles[i]!;
        const x0 = timeScale.timeToX(k.openTime);
        const x1 = timeScale.timeToX(k.closeTime);
        c.fillStyle = dir > 0 ? withAlpha(theme.bull, 0.04) : withAlpha(theme.bear, 0.04);
        c.fillRect(x0, geometry.pricePane.y, Math.max(1, x1 - x0), geometry.pricePane.height);
      }
      c.restore();
    }

    // -------- MA cloud --------
    if (this.options.showMaCloud) {
      drawBand(c, candles, f.maHigh, f.maLow, theme.textMuted, timeScale, priceScale);
      drawLine(c, candles, f.maMid, '#bfbfbf', 1.8, timeScale, priceScale);
    }

    // -------- ATR trail (dotted) --------
    if (this.options.showAtrTrail) {
      drawTrailDots(c, candles, f.trail, f.trendDir, theme.bull, theme.bear, timeScale, priceScale);
    }

    // -------- Buy/Sell labels --------
    if (this.options.showSignals) {
      drawSignalLabels(c, candles, f, theme, timeScale, priceScale);
    }

    // -------- SL / TP lines for the most recent signal --------
    if (this.options.showSlTp && this.lastTrade) {
      drawSlTp(c, this.lastTrade, theme, timeScale, priceScale, geometry);
    }
  }
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function drawBand(
  c: CanvasRenderingContext2D,
  candles: ReadonlyArray<{ openTime: number; closeTime: number }>,
  upper: Float64Array,
  lower: Float64Array,
  baseColor: string,
  timeScale: { timeToX: (t: number) => number },
  priceScale: { priceToY: (p: number) => number },
): void {
  c.save();
  c.beginPath();
  for (let i = 0; i < candles.length; i += 1) {
    const k = candles[i]!;
    const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
    const y = priceScale.priceToY(upper[i] || 0);
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    const k = candles[i]!;
    const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
    const y = priceScale.priceToY(lower[i] || 0);
    c.lineTo(x, y);
  }
  c.closePath();
  c.fillStyle = withAlpha(baseColor, 0.18);
  c.fill();
  c.strokeStyle = withAlpha(baseColor, 0.55);
  c.lineWidth = 1;
  c.stroke();
  c.restore();
}

function drawLine(
  c: CanvasRenderingContext2D,
  candles: ReadonlyArray<{ openTime: number; closeTime: number }>,
  values: Float64Array,
  color: string,
  width: number,
  timeScale: { timeToX: (t: number) => number },
  priceScale: { priceToY: (p: number) => number },
): void {
  c.save();
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  let started = false;
  for (let i = 0; i < candles.length; i += 1) {
    const k = candles[i]!;
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
    const y = priceScale.priceToY(v);
    if (!started) {
      c.moveTo(x, y);
      started = true;
    } else {
      c.lineTo(x, y);
    }
  }
  c.stroke();
  c.restore();
}

function drawTrailDots(
  c: CanvasRenderingContext2D,
  candles: ReadonlyArray<{ openTime: number; closeTime: number }>,
  trail: Float64Array,
  trendDir: Int8Array,
  bullColor: string,
  bearColor: string,
  timeScale: { timeToX: (t: number) => number },
  priceScale: { priceToY: (p: number) => number },
): void {
  c.save();
  for (let i = 0; i < candles.length; i += 1) {
    const k = candles[i]!;
    const v = trail[i];
    const dir = trendDir[i];
    if (v == null || !Number.isFinite(v) || dir == null || dir === 0) continue;
    const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
    const y = priceScale.priceToY(v);
    c.fillStyle = dir > 0 ? bullColor : bearColor;
    c.beginPath();
    c.arc(x, y, 1.6, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

function drawSignalLabels(
  c: CanvasRenderingContext2D,
  candles: ReadonlyArray<{ openTime: number; closeTime: number; high: number; low: number }>,
  f: SignalsTrendScoreFrame,
  theme: { bull: string; bear: string; font: { family: string; sizeLabel: number } },
  timeScale: { timeToX: (t: number) => number },
  priceScale: { priceToY: (p: number) => number },
): void {
  c.save();
  c.font = `600 ${theme.font.sizeLabel + 1}px ${theme.font.family}`;
  for (let i = 0; i < candles.length; i += 1) {
    if (!f.buySignal[i] && !f.sellSignal[i]) continue;
    const k = candles[i]!;
    const isBuy = f.buySignal[i] === 1;
    const x = timeScale.timeToX((k.openTime + k.closeTime) / 2);
    const y = isBuy ? priceScale.priceToY(k.low) + 14 : priceScale.priceToY(k.high) - 14;
    const color = isBuy ? theme.bull : theme.bear;
    const text = isBuy ? 'Buy' : 'Sell';
    const padX = 6;
    const padY = 3;
    const tw = c.measureText(text).width;
    const w = tw + padX * 2;
    const h = theme.font.sizeLabel + padY * 2 + 2;
    const rx = x - w / 2;
    const ry = isBuy ? y : y - h;
    c.fillStyle = color;
    roundRect(c, rx, ry, w, h, 4);
    c.fill();
    c.fillStyle = '#ffffff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, x, ry + h / 2);
    // pointer triangle
    c.fillStyle = color;
    c.beginPath();
    if (isBuy) {
      c.moveTo(x - 4, ry);
      c.lineTo(x + 4, ry);
      c.lineTo(x, ry - 5);
    } else {
      c.moveTo(x - 4, ry + h);
      c.lineTo(x + 4, ry + h);
      c.lineTo(x, ry + h + 5);
    }
    c.closePath();
    c.fill();
  }
  c.restore();
}

function drawSlTp(
  c: CanvasRenderingContext2D,
  trade: {
    side: 'long' | 'short';
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    entryTime: number;
  },
  theme: { bull: string; bear: string; textMuted: string; text: string; font: { family: string; sizeLabel: number } },
  timeScale: { timeToX: (t: number) => number },
  priceScale: { priceToY: (p: number) => number },
  geometry: { pricePane: { x: number; width: number } },
): void {
  const x1 = timeScale.timeToX(trade.entryTime);
  const x2 = geometry.pricePane.x + geometry.pricePane.width - 4;
  if (x2 <= x1) return;
  const isLong = trade.side === 'long';
  const colorTp = theme.bull;
  const colorSl = theme.bear;

  c.save();
  c.lineWidth = 1.4;
  drawHLine(c, priceScale.priceToY(trade.entry), x1, x2, theme.textMuted, [4, 4]);
  drawHLine(c, priceScale.priceToY(trade.sl), x1, x2, colorSl, []);
  drawHLine(c, priceScale.priceToY(trade.tp1), x1, x2, colorTp, [3, 3]);
  drawHLine(c, priceScale.priceToY(trade.tp2), x1, x2, colorTp, [3, 3]);
  drawHLine(c, priceScale.priceToY(trade.tp3), x1, x2, colorTp, [3, 3]);

  // Chips
  drawChip(c, x2, priceScale.priceToY(trade.entry), `Entry ${trade.entry.toFixed(4)}`, theme.textMuted, theme.font);
  drawChip(c, x2, priceScale.priceToY(trade.sl), `SL ${trade.sl.toFixed(4)}`, colorSl, theme.font);
  drawChip(c, x2, priceScale.priceToY(trade.tp1), `TP1 ${trade.tp1.toFixed(4)}`, colorTp, theme.font);
  drawChip(c, x2, priceScale.priceToY(trade.tp2), `TP2 ${trade.tp2.toFixed(4)}`, colorTp, theme.font);
  drawChip(c, x2, priceScale.priceToY(trade.tp3), `TP3 ${trade.tp3.toFixed(4)}`, colorTp, theme.font);
  void isLong;
  c.restore();
}

function drawHLine(
  c: CanvasRenderingContext2D,
  y: number,
  x1: number,
  x2: number,
  color: string,
  dash: number[],
): void {
  c.strokeStyle = color;
  c.setLineDash(dash);
  c.beginPath();
  c.moveTo(x1, Math.round(y) + 0.5);
  c.lineTo(x2, Math.round(y) + 0.5);
  c.stroke();
  c.setLineDash([]);
}

function drawChip(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  font: { family: string; sizeLabel: number },
): void {
  c.font = `${font.sizeLabel}px ${font.family}`;
  const pad = 4;
  const tw = c.measureText(text).width + pad * 2;
  const th = font.sizeLabel + pad * 2;
  c.fillStyle = bg;
  roundRect(c, x - tw, y - th / 2, tw, th, 3);
  c.fill();
  c.fillStyle = '#ffffff';
  c.textBaseline = 'middle';
  c.textAlign = 'right';
  c.fillText(text, x - pad, y);
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

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('rgba')) return color.replace(/[\d.]+\)$/, `${alpha})`);
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}
