/**
 * Server-side chart renderer for alert notifications.
 *
 * When an MA-cross alert fires we render a PNG of the *actual* candles + the two MA
 * lines + a BUY/SELL marker sitting exactly on the bar that crossed, then attach it to
 * the Telegram message. This makes every alert self-proving: the trader can see the
 * crossover that triggered it instead of trusting a bare text line.
 *
 * Why server-side canvas (not a headless browser screenshot):
 *   - Deterministic + fast (~10-30ms/chart) — 144 alerts can fire without launching
 *     Chromium per alert.
 *   - Uses the SAME `computeMaCross` math as the engine and the on-chart overlay, so the
 *     drawn line and the BUY/SELL chip are guaranteed to match what fired.
 *
 * Data integrity: we only ever draw candles handed to us from the live candleStore. No
 * synthetic bars, no smoothing — what you see is what crossed.
 */
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { Candle, Interval } from '@supercharts/types';
import { INTERVAL_MS } from '@supercharts/types';
import { computeMaCross, type MaCrossInputs } from '@supercharts/chart-core/pure';

const DAY_MS = 86_400_000;

export interface RenderMaCrossChartOptions {
  symbol: string;
  interval: Interval;
  candles: ReadonlyArray<Candle>;
  ma: MaCrossInputs;
  /** The fired cross: index into `candles`, side, and price. */
  cross: { index: number; side: 'buy' | 'sell'; price: number; time: number };
  labels: { buy: string; sell: string };
  rsiValue?: number;
  /** Number of bars to show (most-recent window). Default 90. */
  window?: number;
  /** Short provider/source note shown in the footer (e.g. "Binance" / "Yahoo"). */
  sourceNote?: string;
}

// ---- palette (matches the web terminal's dark theme) -----------------------
const C = {
  bg: '#0b0e16',
  headerBg: '#0e1320',
  grid: '#1a2030',
  axisText: '#8b93a7',
  title: '#e6e9f0',
  up: '#26a69a',
  down: '#ef5350',
  fast: '#eab308', // fast EMA — yellow
  slow: '#6e8bff', // slow EMA — periwinkle
  buy: '#22c55e',
  sell: '#ef4444',
} as const;

const BUY_GREEN = '#22c55e';
const SELL_RED = '#ef4444';

const W = 1000;
const H = 560;
const PAD = { top: 58, right: 96, bottom: 38, left: 14 };

function fmtPrice(p: number): string {
  const decimals = p >= 1000 ? 2 : p >= 100 ? 3 : p >= 1 ? 4 : 6;
  return p.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function prettySymbol(symbol: string): string {
  const raw = symbol.includes(':') ? symbol.split(':')[1]! : symbol;
  if (raw.includes('_')) return raw.replace('_', '/');
  // BTCUSDT → BTC/USDT, EURUSD → EUR/USD (best-effort split on common quotes)
  for (const q of ['USDT', 'USDC', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'BTC']) {
    if (raw.length > q.length && raw.endsWith(q)) return `${raw.slice(0, raw.length - q.length)}/${q}`;
  }
  return raw;
}

const INTERVAL_LABEL: Record<string, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '45m': '45m',
  '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '8h': '8h', '12h': '12h',
  '1d': '1D', '1w': '1W', '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y',
};

function maLabel(ma: MaCrossInputs): string {
  const t = ma.type.toUpperCase();
  if (ma.crossWith) return `${t}(${ma.length}) × ${ma.crossWith.type.toUpperCase()}(${ma.crossWith.length})`;
  return `${t}(${ma.length}) × price`;
}

function fmtTime(ms: number): string {
  // Compact UTC stamp, e.g. "2026-05-29 02:30 UTC"
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/**
 * Render the alert chart to a PNG buffer. Returns null if there isn't enough data to
 * draw something meaningful (caller falls back to a text-only Telegram message).
 */
export function renderMaCrossChart(opts: RenderMaCrossChartOptions): Buffer | null {
  const all = opts.candles;
  if (all.length < 3) return null;

  const window = Math.min(opts.window ?? 90, all.length);
  const start = Math.max(0, all.length - window);
  const view = all.slice(start);
  const crossIdxInView = opts.cross.index - start;

  // Recompute both MA legs over the FULL array (so the EMA is properly warmed), then
  // slice to the view — this matches the engine's fired values exactly.
  const { ma, maSlow } = computeMaCross(all, opts.ma);

  const n = view.length;
  const plotX = PAD.left;
  const plotY = PAD.top;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // ---- price range over the visible window (candles + both MA legs) ----------
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const c = view[i]!;
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
    const gi = start + i;
    for (const series of [ma, maSlow]) {
      const v = series?.[gi];
      if (v !== undefined && Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const padRange = (hi - lo) * 0.08;
  lo -= padRange;
  hi += padRange;
  const range = hi - lo;

  const xFor = (i: number) => plotX + ((i + 0.5) / n) * plotW;
  const yFor = (p: number) => plotY + (1 - (p - lo) / range) * plotH;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as SKRSContext2D;

  // ---- background ------------------------------------------------------------
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // ---- header ----------------------------------------------------------------
  ctx.fillStyle = C.headerBg;
  ctx.fillRect(0, 0, W, 46);
  const isBuy = opts.cross.side === 'buy';
  const sideColor = isBuy ? BUY_GREEN : SELL_RED;
  const sideText = isBuy ? opts.labels.buy : opts.labels.sell;

  ctx.textBaseline = 'middle';
  ctx.font = '700 20px sans-serif';
  ctx.fillStyle = C.title;
  const titleStr = `${prettySymbol(opts.symbol)}`;
  ctx.fillText(titleStr, 16, 23);
  const titleW = ctx.measureText(titleStr).width;

  ctx.font = '600 14px sans-serif';
  ctx.fillStyle = C.axisText;
  ctx.fillText(`${INTERVAL_LABEL[opts.interval] ?? opts.interval}  ·  ${maLabel(opts.ma)}`, 16 + titleW + 14, 24);

  // side badge (right of header)
  ctx.font = '700 15px sans-serif';
  const badgeText = `${sideText}`;
  const bw = ctx.measureText(badgeText).width + 26;
  const bx = W - PAD.right - bw + 8;
  ctx.fillStyle = sideColor;
  roundRect(ctx, bx, 11, bw, 24, 6);
  ctx.fill();
  ctx.fillStyle = '#0b0e16';
  ctx.fillText(badgeText, bx + 13, 24);

  // price + time under the badge area / left
  ctx.font = '600 13px sans-serif';
  ctx.fillStyle = C.title;
  ctx.fillText(`${fmtPrice(opts.cross.price)}`, 16, 52 - 12);
  ctx.fillStyle = C.axisText;
  const tStr = fmtTime(opts.cross.time);
  ctx.fillText(`  ·  ${tStr}${opts.rsiValue !== undefined ? `  ·  RSI ${opts.rsiValue.toFixed(1)}` : ''}`,
    16 + ctx.measureText(fmtPrice(opts.cross.price)).width, 52 - 12);

  // ---- gridlines + price axis ------------------------------------------------
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.font = '11px sans-serif';
  ctx.textBaseline = 'middle';
  const ROWS = 5;
  for (let r = 0; r <= ROWS; r += 1) {
    const p = lo + (range * r) / ROWS;
    const y = yFor(p);
    ctx.beginPath();
    ctx.moveTo(plotX, y);
    ctx.lineTo(plotX + plotW, y);
    ctx.stroke();
    ctx.fillStyle = C.axisText;
    ctx.fillText(fmtPrice(p), plotX + plotW + 8, y);
  }

  // ---- time axis (a few labels) ----------------------------------------------
  ctx.textBaseline = 'top';
  ctx.fillStyle = C.axisText;
  const ticks = 4;
  for (let t = 0; t <= ticks; t += 1) {
    const i = Math.round((t / ticks) * (n - 1));
    const c = view[i]!;
    const d = new Date(c.openTime);
    const p = (x: number) => String(x).padStart(2, '0');
    // Bars a day or longer: label with a date; intraday: label with a time.
    const showDate = (INTERVAL_MS[opts.interval] ?? 0) >= DAY_MS;
    const lbl = showDate
      ? `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
      : `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
    const x = xFor(i);
    ctx.textAlign = t === 0 ? 'left' : t === ticks ? 'right' : 'center';
    ctx.fillText(lbl, Math.min(Math.max(x, plotX), plotX + plotW), plotY + plotH + 8);
  }
  ctx.textAlign = 'left';

  // ---- candles ---------------------------------------------------------------
  const slot = plotW / n;
  const bodyW = Math.max(1.5, Math.min(slot * 0.62, 16));
  for (let i = 0; i < n; i += 1) {
    const c = view[i]!;
    const up = c.close >= c.open;
    const col = up ? C.up : C.down;
    const x = xFor(i);
    // wick
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yFor(c.high));
    ctx.lineTo(x, yFor(c.low));
    ctx.stroke();
    // body
    const yO = yFor(c.open);
    const yC = yFor(c.close);
    const top = Math.min(yO, yC);
    const hgt = Math.max(1, Math.abs(yC - yO));
    ctx.fillStyle = col;
    ctx.fillRect(x - bodyW / 2, top, bodyW, hgt);
  }

  // ---- MA lines --------------------------------------------------------------
  const drawSeries = (series: Float64Array | undefined, color: string) => {
    if (!series) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i += 1) {
      const v = series[start + i];
      if (v === undefined || !Number.isFinite(v)) continue;
      const x = xFor(i);
      const y = yFor(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  };
  drawSeries(maSlow, C.slow); // draw slow first so fast sits on top
  drawSeries(ma, C.fast);

  // ---- the cross marker ------------------------------------------------------
  if (crossIdxInView >= 0 && crossIdxInView < n) {
    const c = view[crossIdxInView]!;
    const x = xFor(crossIdxInView);
    const markColor = isBuy ? BUY_GREEN : SELL_RED;
    // vertical guide
    ctx.strokeStyle = markColor;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, plotY);
    ctx.lineTo(x, plotY + plotH);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // triangle + chip: BUY below the low (pointing up), SELL above the high (pointing down)
    const triH = 9;
    const gap = 10;
    ctx.fillStyle = markColor;
    if (isBuy) {
      const yBase = yFor(c.low) + gap;
      ctx.beginPath();
      ctx.moveTo(x, yBase);
      ctx.lineTo(x - 7, yBase + triH);
      ctx.lineTo(x + 7, yBase + triH);
      ctx.closePath();
      ctx.fill();
      drawChip(ctx, x, yBase + triH + 12, sideText, markColor, 'below');
    } else {
      const yBase = yFor(c.high) - gap;
      ctx.beginPath();
      ctx.moveTo(x, yBase);
      ctx.lineTo(x - 7, yBase - triH);
      ctx.lineTo(x + 7, yBase - triH);
      ctx.closePath();
      ctx.fill();
      drawChip(ctx, x, yBase - triH - 12, sideText, markColor, 'above');
    }
  }

  // ---- legend + watermark ----------------------------------------------------
  ctx.textBaseline = 'middle';
  ctx.font = '600 12px sans-serif';
  const legY = plotY + 12;
  let legX = plotX + 8;
  const legendItem = (label: string, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(legX, legY - 5, 18, 3);
    ctx.fillStyle = C.axisText;
    ctx.fillText(label, legX + 24, legY);
    legX += 28 + ctx.measureText(label).width + 16;
  };
  legendItem(`${opts.ma.type.toUpperCase()} ${opts.ma.length}`, C.fast);
  if (opts.ma.crossWith) legendItem(`${opts.ma.crossWith.type.toUpperCase()} ${opts.ma.crossWith.length}`, C.slow);

  ctx.font = '600 12px sans-serif';
  ctx.fillStyle = '#3a445c';
  ctx.textAlign = 'right';
  ctx.fillText(`SuperCharts${opts.sourceNote ? ` · ${opts.sourceNote}` : ''}`, plotX + plotW, plotY + plotH - 10);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawChip(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  text: string,
  color: string,
  _pos: 'above' | 'below',
): void {
  ctx.font = '700 13px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const padX = 8;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 20;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.fillStyle = '#0b0e16';
  ctx.fillText(text, x + padX, cy + 0.5);
}
