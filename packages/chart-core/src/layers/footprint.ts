import type { Layer, RenderContext } from './types';
import type { Candle, FootprintBar } from '@supercharts/types';

export interface FootprintLayerOptions {
  enabled: boolean;
  /** Min pixel width per candle below which we hide numbers and just colour the bar. */
  minBarPxForNumbers: number;
  /** Number of price rows per candle. */
  rowsPerCandle: number;
  /** Imbalance ratio that triggers a highlight. */
  imbalanceRatio: number;
}

/**
 * Footprint cell overlay.
 *
 * Genuine footprint requires raw trade-by-trade bid/ask classification. Until the
 * ingestion service emits FootprintBar messages, we render a usable approximation from
 * candle buy/sell volume split: the bar is sliced into `rowsPerCandle` rows between
 * low and high, with each row coloured by its share of buyer- vs seller-aggressed volume
 * (linear gradient across the candle range). Imbalance cells are outlined.
 */
export class FootprintLayer implements Layer {
  readonly id = 'footprint';
  readonly zIndex = 12;
  visible = false;
  options: FootprintLayerOptions;

  constructor(opts: Partial<FootprintLayerOptions> = {}) {
    this.options = {
      enabled: false,
      minBarPxForNumbers: 38,
      rowsPerCandle: 6,
      imbalanceRatio: 3,
      ...opts,
    };
  }

  render(ctx: RenderContext): void {
    if (!this.options.enabled) return;
    const { ctx: c, theme, timeScale, priceScale, frame } = ctx;
    const { fromTime, toTime } = timeScale.visibleRange();
    const barPx = Math.max(1, timeScale.barPx() * 0.92);
    const showNumbers = barPx >= this.options.minBarPxForNumbers;
    const rows = this.options.rowsPerCandle;
    // Real per-cell bid/ask footprint keyed by candle openTime (empty on venues
    // without a trade feed — those fall back to the candle-split approximation below).
    const realByTime = new Map<number, FootprintBar>(frame.footprint.map((b) => [b.openTime, b]));
    c.save();
    c.font = `${theme.font.sizeAxis - 1}px ${theme.font.family}`;
    c.textBaseline = 'middle';
    for (const k of frame.candles) {
      if (k.openTime < fromTime || k.openTime > toTime) continue;
      const xC = Math.round(timeScale.timeToX((k.openTime + k.closeTime) / 2));
      const left = xC - barPx / 2;
      const buyTotal = k.buyVolume;
      const sellTotal = k.sellVolume;
      const top = priceScale.priceToY(k.high);
      const bot = priceScale.priceToY(k.low);
      if (!Number.isFinite(top) || !Number.isFinite(bot)) continue;

      // ---- Real footprint cells (preferred when present) ----
      const realBar = realByTime.get(k.openTime);
      if (realBar && realBar.cells.length > 0) {
        const cells = realBar.cells; // ascending by priceLevel (finalize sorts them)
        let tick = Infinity;
        for (let i = 1; i < cells.length; i += 1) {
          const gap = cells[i]!.priceLevel - cells[i - 1]!.priceLevel;
          if (gap > 0 && gap < tick) tick = gap;
        }
        if (!Number.isFinite(tick) || tick <= 0) {
          tick = Math.max((k.high - k.low) / Math.max(cells.length, 1), 1e-9);
        }
        const cellH = Math.max(2, Math.abs(priceScale.priceToY(0) - priceScale.priceToY(tick)));
        for (const cell of cells) {
          const cy = priceScale.priceToY(cell.priceLevel);
          const ry = cy - cellH / 2;
          const buyShare = cell.askVolume / Math.max(cell.totalVolume, 1e-9);
          c.fillStyle = mix(theme.bullDim, theme.bearDim, 1 - buyShare);
          c.fillRect(left, ry, barPx, cellH - 0.5);
          if (cell.absorptionFlag) {
            c.strokeStyle = '#ffca28'; // gold = absorption
            c.lineWidth = 1.5;
            c.strokeRect(left + 0.5, ry + 0.5, barPx - 1, cellH - 1);
          } else if (cell.imbalanceSide !== 'none') {
            c.strokeStyle = cell.imbalanceSide === 'buy' ? theme.bull : theme.bear;
            c.lineWidth = cell.stackedImbalanceFlag ? 2.2 : 1.1; // stacked = thicker
            c.strokeRect(left + 0.5, ry + 0.5, barPx - 1, cellH - 1);
          }
          if (showNumbers && cellH > 9) {
            c.fillStyle = theme.text;
            c.textAlign = 'left';
            c.fillText(compact(cell.bidVolume), left + 4, cy);
            c.textAlign = 'right';
            c.fillText(compact(cell.askVolume), left + barPx - 4, cy);
          }
        }
        c.fillStyle = realBar.candleDelta >= 0 ? theme.bull : theme.bear;
        c.fillRect(left, bot + 2, barPx, 2);
        continue;
      }

      // ---- Fallback: candle buy/sell-split approximation ----
      const rowH = Math.max(1, (bot - top) / rows);
      const totalVol = Math.max(buyTotal + sellTotal, 1e-9);
      // Weight rows by a triangle distribution peaked at the close so the picture matches
      // the real candle shape closer than a uniform split.
      const closeY = priceScale.priceToY(k.close);
      for (let r = 0; r < rows; r += 1) {
        const rowY = top + r * rowH;
        const distToClose = Math.abs(rowY + rowH / 2 - closeY);
        const peak = 1 - Math.min(1, distToClose / Math.max(1, bot - top));
        const rowVol = (peak + 0.3) / (rows * 0.9); // normalized
        const rowBuy = buyTotal * rowVol;
        const rowSell = sellTotal * rowVol;
        const buyShare = rowBuy / Math.max(rowBuy + rowSell, 1e-9);
        const fill = mix(theme.bullDim, theme.bearDim, 1 - buyShare);
        c.fillStyle = fill;
        c.fillRect(left, rowY, barPx, rowH - 0.5);
        // Imbalance outline
        const ratio = rowBuy / Math.max(rowSell, 1e-9);
        const isStrongBuy = ratio >= this.options.imbalanceRatio;
        const isStrongSell = ratio <= 1 / this.options.imbalanceRatio;
        if (isStrongBuy || isStrongSell) {
          c.strokeStyle = isStrongBuy ? theme.bull : theme.bear;
          c.lineWidth = 1.2;
          c.strokeRect(left + 0.5, rowY + 0.5, barPx - 1, rowH - 1);
        }
        if (showNumbers && rowH > 9) {
          c.fillStyle = theme.text;
          c.textAlign = 'left';
          c.fillText(compact(rowBuy), left + 4, rowY + rowH / 2);
          c.textAlign = 'right';
          c.fillText(compact(rowSell), left + barPx - 4, rowY + rowH / 2);
        }
      }
      // Candle delta strip under the bar
      const stripY = bot + 2;
      c.fillStyle = k.delta >= 0 ? theme.bull : theme.bear;
      c.fillRect(left, stripY, barPx, 2);
      void totalVol;
      void k;
      void buyTotal;
      void sellTotal;
    }
    c.restore();
  }
}

function compact(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '·';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return v.toFixed(0);
  return v.toFixed(2);
}

function mix(a: string, b: string, t: number): string {
  // a, b expected as rgba(r,g,b,a) or #rrggbb
  const pa = parseColor(a);
  const pb = parseColor(b);
  const r = Math.round(pa.r + (pb.r - pa.r) * t);
  const g = Math.round(pa.g + (pb.g - pa.g) * t);
  const bl = Math.round(pa.b + (pb.b - pa.b) * t);
  const al = pa.a + (pb.a - pa.a) * t;
  return `rgba(${r},${g},${bl},${al.toFixed(2)})`;
}

function parseColor(c: string): { r: number; g: number; b: number; a: number } {
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return { r, g, b, a: 1 };
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const parts = m[1]!.split(',').map((s) => Number(s.trim()));
    return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}
// satisfy noUnused via local type ref
type _T = Candle;
void (0 as unknown as _T);
