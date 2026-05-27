import type { Layer, RenderContext } from './types';
import type {
  ZoneBox,
} from '../indicators/smc/shared';
import type { StructureEvent } from '../indicators/smc/market-structure';
import type { LiquidityLevel, LiquiditySweep } from '../indicators/smc/liquidity';
import type { AnchoredVwapResult } from '../indicators/smc/anchored-vwap';
import type { Divergence } from '../indicators/smc/cvd';
import type { SessionBlock } from '../indicators/smc/sessions';
import type { PremiumDiscountRange } from '../indicators/smc/premium-discount';
import type { HvnLvnResult } from '../indicators/smc/hvn-lvn';
import type { RegimeLabel } from '../indicators/smc/regime';
import { withAlpha } from '../indicators/smc/shared';

export interface SmcFrame {
  fvgs?: ZoneBox[];
  orderBlocks?: ZoneBox[];
  liquidityLevels?: LiquidityLevel[];
  liquiditySweeps?: LiquiditySweep[];
  structureEvents?: StructureEvent[];
  structureChips?: Array<{ pivotIndex: number; pivotTime: number; pivotPrice: number; label: string }>;
  premiumDiscount?: PremiumDiscountRange | null;
  anchoredVwap?: AnchoredVwapResult | null;
  cvdDivergences?: Divergence[];
  sessions?: SessionBlock[];
  hvnLvn?: HvnLvnResult | null;
  regimeLabel?: RegimeLabel | null;
}

export interface SmcLayerOptions {
  showFvg: boolean;
  showOrderBlocks: boolean;
  showLiquidity: boolean;
  showLiquiditySweeps: boolean;
  showMarketStructure: boolean;
  showPremiumDiscount: boolean;
  showAnchoredVwap: boolean;
  showCvdDivergence: boolean;
  showSessions: boolean;
  showHvnLvn: boolean;
  showRegimeBadge: boolean;
}

const DEFAULTS: SmcLayerOptions = {
  showFvg: false,
  showOrderBlocks: false,
  showLiquidity: false,
  showLiquiditySweeps: false,
  showMarketStructure: false,
  showPremiumDiscount: false,
  showAnchoredVwap: false,
  showCvdDivergence: false,
  showSessions: false,
  showHvnLvn: false,
  showRegimeBadge: false,
};

const COLORS = {
  fvgBull: '#2ecc71',
  fvgBear: '#e74c3c',
  ifvgBull: '#16a085',
  ifvgBear: '#c0392b',
  obBull: '#3498db',
  obBear: '#e67e22',
  obBreaker: '#9b59b6',
  liquidity: '#f1c40f',
  liquidityHi: '#e74c3c',
  liquidityLo: '#2ecc71',
  bos: '#7c9cff',
  choch: '#f39c12',
  premium: '#c0392b',
  discount: '#27ae60',
  eq: '#bdc3c7',
  ote: '#9b59b6',
  vwap: '#f1c40f',
  vwapBand1: '#e67e22',
  vwapBand2: '#e74c3c',
  vwapBand3: '#8e44ad',
  cvdBull: '#2ecc71',
  cvdBear: '#e74c3c',
  hvn: '#1abc9c',
  lvn: '#e67e22',
  poc: '#f1c40f',
};

/**
 * Renders the SMC / order-flow indicator suite from a `SmcFrame` produced by the chart-pane
 * compute layer. Each visualization is gated by an individual `options.*` flag so a single
 * layer covers all toggles. zIndex chosen so SMC sits above the candle series (10) but below
 * the crosshair / tooltip (90+).
 */
export class SmcLayer implements Layer {
  readonly id = 'smc';
  readonly zIndex = 18;
  visible = false;
  options: SmcLayerOptions = { ...DEFAULTS };
  frame: SmcFrame = {};

  render(ctx: RenderContext): void {
    if (!Object.values(this.options).some(Boolean)) return;
    if (this.options.showSessions) drawSessions(ctx, this.frame.sessions ?? []);
    if (this.options.showHvnLvn && this.frame.hvnLvn) drawHvnLvn(ctx, this.frame.hvnLvn);
    if (this.options.showPremiumDiscount && this.frame.premiumDiscount) drawPremiumDiscount(ctx, this.frame.premiumDiscount);
    if (this.options.showFvg) drawZones(ctx, this.frame.fvgs ?? [], 'fvg');
    if (this.options.showOrderBlocks) drawZones(ctx, this.frame.orderBlocks ?? [], 'ob');
    if (this.options.showLiquidity) drawLiquidity(ctx, this.frame.liquidityLevels ?? [], this.frame.liquiditySweeps ?? [], this.options.showLiquiditySweeps);
    if (this.options.showMarketStructure) drawStructure(ctx, this.frame.structureEvents ?? [], this.frame.structureChips ?? []);
    if (this.options.showAnchoredVwap && this.frame.anchoredVwap) drawAnchoredVwap(ctx, this.frame.anchoredVwap);
    if (this.options.showCvdDivergence) drawCvdDivergences(ctx, this.frame.cvdDivergences ?? []);
    if (this.options.showRegimeBadge && this.frame.regimeLabel) drawRegimeBadge(ctx, this.frame.regimeLabel);
  }
}

// -----------------------------------------------------------------------------

function drawZones(ctx: RenderContext, zones: ZoneBox[], kind: 'fvg' | 'ob'): void {
  const { ctx: c, timeScale, priceScale, geometry, theme } = ctx;
  c.save();
  for (const z of zones) {
    const xStart = timeScale.timeToX(z.startTime);
    const xEnd = z.endTime != null ? timeScale.timeToX(z.endTime) : geometry.pricePane.x + geometry.pricePane.width;
    if (xEnd < geometry.pricePane.x || xStart > geometry.pricePane.x + geometry.pricePane.width) continue;
    const yTop = priceScale.priceToY(z.top);
    const yBot = priceScale.priceToY(z.bottom);
    const isInverted = z.state === 'inverted';
    const isBreaker = z.state === 'breaker';
    const color =
      kind === 'fvg'
        ? z.side === 'bull'
          ? isInverted ? COLORS.ifvgBull : COLORS.fvgBull
          : isInverted ? COLORS.ifvgBear : COLORS.fvgBear
        : isBreaker
          ? COLORS.obBreaker
          : z.side === 'bull'
            ? COLORS.obBull
            : COLORS.obBear;
    c.fillStyle = withAlpha(color, z.state === 'mitigated' ? 0.08 : 0.16);
    c.fillRect(xStart, Math.min(yTop, yBot), Math.max(2, xEnd - xStart), Math.abs(yBot - yTop));
    c.strokeStyle = withAlpha(color, z.state === 'mitigated' ? 0.4 : 0.85);
    c.lineWidth = 1;
    if (isBreaker) c.setLineDash([4, 3]);
    c.strokeRect(xStart + 0.5, Math.min(yTop, yBot) + 0.5, Math.max(2, xEnd - xStart) - 1, Math.abs(yBot - yTop) - 1);
    c.setLineDash([]);
    if (z.label) {
      c.fillStyle = withAlpha(color, 0.95);
      c.font = `600 10px ${theme.font.family}`;
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.fillText(z.label + (isInverted ? ' (i)' : isBreaker ? ' BB' : ''), xStart + 4, Math.min(yTop, yBot) + 9);
    }
  }
  c.restore();
}

function drawLiquidity(
  ctx: RenderContext,
  levels: LiquidityLevel[],
  sweeps: LiquiditySweep[],
  showSweeps: boolean,
): void {
  const { ctx: c, timeScale, priceScale, geometry, theme } = ctx;
  c.save();
  c.font = `10px ${theme.font.family}`;
  for (const L of levels) {
    const xStart = timeScale.timeToX(L.firstTime);
    const xEnd = L.sweptTime ?? geometry.pricePane.x + geometry.pricePane.width;
    const xEndPx = typeof xEnd === 'number' && xEnd > 1e12 ? timeScale.timeToX(xEnd) : (xEnd as number);
    const y = priceScale.priceToY(L.price);
    c.strokeStyle = L.side === 'high' ? COLORS.liquidityHi : COLORS.liquidityLo;
    c.globalAlpha = L.state === 'pending' ? 0.85 : 0.35;
    c.lineWidth = L.touches > 2 ? 2 : 1;
    c.beginPath();
    c.moveTo(xStart, Math.round(y) + 0.5);
    c.lineTo(xEndPx, Math.round(y) + 0.5);
    c.stroke();
    c.globalAlpha = 1;
    c.fillStyle = c.strokeStyle;
    c.textBaseline = 'middle';
    c.textAlign = 'right';
    c.fillText(`${L.side === 'high' ? 'EQH' : 'EQL'}×${L.touches}`, xEndPx - 4, y);
  }
  if (showSweeps) {
    for (const s of sweeps) {
      const x = timeScale.timeToX(s.time);
      const y = priceScale.priceToY(s.level.price);
      c.fillStyle = s.side === 'BSL' ? COLORS.liquidityHi : COLORS.liquidityLo;
      c.beginPath();
      if (s.side === 'BSL') {
        c.moveTo(x, y - 12);
        c.lineTo(x - 5, y - 4);
        c.lineTo(x + 5, y - 4);
      } else {
        c.moveTo(x, y + 12);
        c.lineTo(x - 5, y + 4);
        c.lineTo(x + 5, y + 4);
      }
      c.closePath();
      c.fill();
    }
  }
  c.restore();
}

function drawStructure(
  ctx: RenderContext,
  events: StructureEvent[],
  chips: Array<{ pivotIndex: number; pivotTime: number; pivotPrice: number; label: string }>,
): void {
  const { ctx: c, timeScale, priceScale, theme } = ctx;
  c.save();
  c.font = `600 10px ${theme.font.family}`;
  for (const ev of events) {
    const xStart = timeScale.timeToX(ev.brokenTime);
    const xEnd = timeScale.timeToX(ev.time);
    const y = priceScale.priceToY(ev.brokenLevel);
    c.strokeStyle = ev.kind === 'BOS' ? COLORS.bos : COLORS.choch;
    c.setLineDash([5, 4]);
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(xStart, Math.round(y) + 0.5);
    c.lineTo(xEnd, Math.round(y) + 0.5);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = c.strokeStyle;
    c.textBaseline = 'bottom';
    c.textAlign = 'right';
    c.fillText(`${ev.kind} ${ev.side === 'bull' ? '▲' : '▼'}`, xEnd - 4, y - 4);
  }
  c.font = `9px ${theme.font.family}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const chip of chips) {
    const x = timeScale.timeToX(chip.pivotTime);
    const y = priceScale.priceToY(chip.pivotPrice);
    const offsetY = chip.label === 'HH' || chip.label === 'LH' ? -10 : 12;
    c.fillStyle = chip.label.endsWith('H') ? COLORS.fvgBear : COLORS.fvgBull;
    c.fillText(chip.label, x, y + offsetY);
  }
  c.restore();
}

function drawPremiumDiscount(ctx: RenderContext, range: PremiumDiscountRange): void {
  const { ctx: c, timeScale, priceScale, geometry, theme } = ctx;
  c.save();
  const x0 = timeScale.timeToX(range.startTime);
  const x1 = geometry.pricePane.x + geometry.pricePane.width;
  const yHi = priceScale.priceToY(range.high);
  const yEq = priceScale.priceToY(range.eq);
  const yLo = priceScale.priceToY(range.low);
  c.fillStyle = withAlpha(COLORS.premium, 0.05);
  c.fillRect(x0, yHi, x1 - x0, yEq - yHi);
  c.fillStyle = withAlpha(COLORS.discount, 0.05);
  c.fillRect(x0, yEq, x1 - x0, yLo - yEq);
  c.fillStyle = withAlpha(COLORS.ote, 0.12);
  const yOteHi = priceScale.priceToY(range.ote.high);
  const yOteLo = priceScale.priceToY(range.ote.low);
  c.fillRect(x0, Math.min(yOteHi, yOteLo), x1 - x0, Math.abs(yOteLo - yOteHi));
  c.strokeStyle = COLORS.eq;
  c.setLineDash([2, 3]);
  c.beginPath();
  c.moveTo(x0, Math.round(yEq) + 0.5);
  c.lineTo(x1, Math.round(yEq) + 0.5);
  c.stroke();
  c.setLineDash([]);
  c.fillStyle = COLORS.premium;
  c.font = `10px ${theme.font.family}`;
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.fillText('Premium', x0 + 4, yHi + 10);
  c.fillStyle = COLORS.discount;
  c.fillText('Discount', x0 + 4, yLo - 10);
  c.restore();
}

function drawAnchoredVwap(ctx: RenderContext, avwap: AnchoredVwapResult): void {
  const { ctx: c, timeScale, priceScale, frame } = ctx;
  const candles = frame.candles;
  if (candles.length === 0) return;
  c.save();
  c.lineWidth = 1.6;
  c.strokeStyle = COLORS.vwap;
  c.beginPath();
  let started = false;
  for (let i = 0; i < candles.length; i += 1) {
    const v = avwap.vwap[i];
    if (v == null || !Number.isFinite(v)) continue;
    const x = timeScale.timeToX((candles[i]!.openTime + candles[i]!.closeTime) / 2);
    const y = priceScale.priceToY(v);
    if (!started) {
      c.moveTo(x, y);
      started = true;
    } else c.lineTo(x, y);
  }
  c.stroke();
  const palette = [COLORS.vwapBand1, COLORS.vwapBand2, COLORS.vwapBand3];
  for (let k = 0; k < avwap.bandsUpper.length; k += 1) {
    const color = palette[k] ?? COLORS.vwapBand1;
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.globalAlpha = 0.6;
    drawBand(c, candles, avwap.bandsUpper[k]!, timeScale, priceScale);
    drawBand(c, candles, avwap.bandsLower[k]!, timeScale, priceScale);
  }
  c.globalAlpha = 1;
  c.restore();
}

function drawBand(
  c: CanvasRenderingContext2D,
  candles: Array<{ openTime: number; closeTime: number }>,
  series: Float64Array,
  timeScale: { timeToX: (t: number) => number },
  priceScale: { priceToY: (p: number) => number },
): void {
  c.beginPath();
  let started = false;
  for (let i = 0; i < candles.length; i += 1) {
    const v = series[i];
    if (v == null || !Number.isFinite(v)) continue;
    const x = timeScale.timeToX((candles[i]!.openTime + candles[i]!.closeTime) / 2);
    const y = priceScale.priceToY(v);
    if (!started) {
      c.moveTo(x, y);
      started = true;
    } else c.lineTo(x, y);
  }
  c.stroke();
}

function drawCvdDivergences(ctx: RenderContext, divs: Divergence[]): void {
  const { ctx: c, timeScale, priceScale, frame, theme } = ctx;
  const candles = frame.candles;
  c.save();
  c.font = `9px ${theme.font.family}`;
  for (const d of divs) {
    const a = candles[d.priceA];
    const b = candles[d.priceB];
    if (!a || !b) continue;
    const x1 = timeScale.timeToX((a.openTime + a.closeTime) / 2);
    const x2 = timeScale.timeToX((b.openTime + b.closeTime) / 2);
    const y1 = priceScale.priceToY(d.side === 'bullish' ? a.low : a.high);
    const y2 = priceScale.priceToY(d.side === 'bullish' ? b.low : b.high);
    c.strokeStyle = d.side === 'bullish' ? COLORS.cvdBull : COLORS.cvdBear;
    c.globalAlpha = d.hidden ? 0.4 : 0.95;
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    c.fillStyle = c.strokeStyle;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillText((d.hidden ? 'H' : 'R') + (d.side === 'bullish' ? ' Bull' : ' Bear') + ' Div', x2 + 4, y2);
    c.globalAlpha = 1;
  }
  c.restore();
}

function drawSessions(ctx: RenderContext, sessions: SessionBlock[]): void {
  const { ctx: c, timeScale, priceScale, geometry, theme } = ctx;
  c.save();
  c.font = `10px ${theme.font.family}`;
  for (const s of sessions) {
    const x0 = timeScale.timeToX(s.startTime);
    const x1 = timeScale.timeToX(s.endTime);
    if (x1 < geometry.pricePane.x || x0 > geometry.pricePane.x + geometry.pricePane.width) continue;
    c.fillStyle = s.killzoneColor;
    c.fillRect(x0, geometry.pricePane.y, Math.max(2, x1 - x0), geometry.pricePane.height);
    const yHi = priceScale.priceToY(s.high);
    const yLo = priceScale.priceToY(s.low);
    c.strokeStyle = withAlpha(s.color, 0.55);
    c.setLineDash([3, 3]);
    c.beginPath();
    c.moveTo(x0, Math.round(yHi) + 0.5);
    c.lineTo(x1, Math.round(yHi) + 0.5);
    c.moveTo(x0, Math.round(yLo) + 0.5);
    c.lineTo(x1, Math.round(yLo) + 0.5);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = withAlpha(s.color, 0.9);
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(s.name, x0 + 3, geometry.pricePane.y + 4);
  }
  c.restore();
}

function drawHvnLvn(ctx: RenderContext, hv: HvnLvnResult): void {
  const { ctx: c, timeScale, priceScale, geometry, theme } = ctx;
  c.save();
  const x1 = geometry.pricePane.x + geometry.pricePane.width;
  const x0 = x1 - 60;
  const maxVol = hv.profile.reduce((m, p) => (p.volume > m ? p.volume : m), 0);
  if (maxVol > 0) {
    for (const p of hv.profile) {
      const y = priceScale.priceToY(p.price);
      const w = (p.volume / maxVol) * 50;
      c.fillStyle = withAlpha(COLORS.hvn, 0.35);
      c.fillRect(x1 - w - 4, y - 1, w, 2);
    }
  }
  c.strokeStyle = COLORS.poc;
  c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(geometry.pricePane.x, Math.round(priceScale.priceToY(hv.poc)) + 0.5);
  c.lineTo(x1, Math.round(priceScale.priceToY(hv.poc)) + 0.5);
  c.stroke();
  c.fillStyle = COLORS.poc;
  c.font = `10px ${theme.font.family}`;
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  c.fillText('POC', x1 - 4, priceScale.priceToY(hv.poc));
  c.setLineDash([3, 3]);
  c.strokeStyle = COLORS.hvn;
  c.beginPath();
  c.moveTo(geometry.pricePane.x, Math.round(priceScale.priceToY(hv.vah)) + 0.5);
  c.lineTo(x1, Math.round(priceScale.priceToY(hv.vah)) + 0.5);
  c.moveTo(geometry.pricePane.x, Math.round(priceScale.priceToY(hv.val)) + 0.5);
  c.lineTo(x1, Math.round(priceScale.priceToY(hv.val)) + 0.5);
  c.stroke();
  c.setLineDash([]);
  for (const lv of hv.levels) {
    c.fillStyle = lv.kind === 'hvn' ? COLORS.hvn : COLORS.lvn;
    c.beginPath();
    c.arc(x0 - 8, priceScale.priceToY(lv.price), 2.5, 0, Math.PI * 2);
    c.fill();
  }
  void x0;
  c.restore();
}

function drawRegimeBadge(ctx: RenderContext, label: RegimeLabel): void {
  const { ctx: c, geometry, theme } = ctx;
  const text =
    label === 'strong_up'
      ? 'TREND ▲▲'
      : label === 'up'
        ? 'TREND ▲'
        : label === 'choppy'
          ? 'CHOPPY'
          : label === 'down'
            ? 'TREND ▼'
            : 'TREND ▼▼';
  const color =
    label === 'strong_up' || label === 'up'
      ? '#27ae60'
      : label === 'strong_down' || label === 'down'
        ? '#e74c3c'
        : '#f1c40f';
  c.save();
  c.font = `600 10px ${theme.font.family}`;
  const pad = 6;
  const tw = c.measureText(text).width + pad * 2;
  const x = geometry.pricePane.x + 12;
  const y = geometry.pricePane.y + 12;
  c.fillStyle = withAlpha(color, 0.85);
  roundRect(c, x, y, tw, 18, 4);
  c.fill();
  c.fillStyle = '#ffffff';
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.fillText(text, x + pad, y + 9);
  c.restore();
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
