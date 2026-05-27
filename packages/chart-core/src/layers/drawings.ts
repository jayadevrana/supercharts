import type { DrawingObject } from '@supercharts/types';
import type { Layer, RenderContext } from './types';

/**
 * Drawing renderer.
 *
 * Drawings are stored in chart-space (time, price). The layer projects each draw on every
 * frame so they survive zoom and pan without re-saving anything.
 */
export class DrawingLayer implements Layer {
  readonly id = 'drawings';
  readonly zIndex = 50;
  visible = true;

  render(ctx: RenderContext): void {
    const drawings = ctx.frame.drawings.filter((d) => d.visible);
    drawings.sort((a, b) => a.zIndex - b.zIndex);
    for (const d of drawings) {
      this.drawOne(ctx, d);
    }
  }

  private drawOne(ctx: RenderContext, d: DrawingObject): void {
    const { ctx: c, timeScale, priceScale, theme, geometry } = ctx;
    const pts = d.points.map((p) => ({
      x: timeScale.timeToX(p.time),
      y: priceScale.priceToY(p.price),
    }));
    c.save();
    c.strokeStyle = d.style.strokeColor || theme.accent;
    c.lineWidth = d.style.strokeWidth ?? 1.4;
    c.fillStyle = d.style.fillColor || 'transparent';
    if (d.style.strokeDash) {
      const dash = d.style.strokeDash
        .split(/[ ,]+/)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n));
      c.setLineDash(dash);
    }

    switch (d.type) {
      case 'horizontal_line': {
        const p0 = pts[0];
        if (!p0) break;
        c.beginPath();
        c.moveTo(geometry.pricePane.x, p0.y);
        c.lineTo(geometry.pricePane.x + geometry.pricePane.width, p0.y);
        c.stroke();
        if (d.text) {
          c.fillStyle = d.style.textColor || theme.text;
          c.font = `${d.style.fontSize ?? 11}px ${theme.font.family}`;
          c.textBaseline = 'bottom';
          c.fillText(d.text, geometry.pricePane.x + 6, p0.y - 2);
        }
        break;
      }
      case 'vertical_line': {
        const p0 = pts[0];
        if (!p0) break;
        c.beginPath();
        c.moveTo(p0.x, geometry.pricePane.y);
        c.lineTo(p0.x, geometry.pricePane.y + geometry.pricePane.height + geometry.volumePane.height);
        c.stroke();
        break;
      }
      case 'trend_line':
      case 'ray':
      case 'extended_line': {
        if (pts.length < 2) break;
        const [a, b] = pts;
        c.beginPath();
        if (d.type === 'trend_line') {
          c.moveTo(a!.x, a!.y);
          c.lineTo(b!.x, b!.y);
        } else {
          // Extend or ray: parametric line over the pane.
          const dx = b!.x - a!.x;
          const dy = b!.y - a!.y;
          const tMin = d.type === 'extended_line' ? -1e6 : 0;
          const tMax = 1e6;
          c.moveTo(a!.x + dx * tMin, a!.y + dy * tMin);
          c.lineTo(a!.x + dx * tMax, a!.y + dy * tMax);
        }
        c.stroke();
        break;
      }
      case 'rectangle': {
        if (pts.length < 2) break;
        const [a, b] = pts;
        const x = Math.min(a!.x, b!.x);
        const y = Math.min(a!.y, b!.y);
        const w = Math.abs(b!.x - a!.x);
        const h = Math.abs(b!.y - a!.y);
        if (d.style.fillColor && d.style.fillOpacity !== 0) {
          c.globalAlpha = d.style.fillOpacity ?? 0.18;
          c.fillStyle = d.style.fillColor;
          c.fillRect(x, y, w, h);
          c.globalAlpha = 1;
        }
        c.strokeRect(x, y, w, h);
        break;
      }
      case 'ellipse':
      case 'circle': {
        if (pts.length < 2) break;
        const [a, b] = pts;
        const cx = (a!.x + b!.x) / 2;
        const cy = (a!.y + b!.y) / 2;
        const rx = Math.abs(b!.x - a!.x) / 2;
        const ry = d.type === 'circle' ? rx : Math.abs(b!.y - a!.y) / 2;
        c.beginPath();
        c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        if (d.style.fillColor) {
          c.globalAlpha = d.style.fillOpacity ?? 0.15;
          c.fillStyle = d.style.fillColor;
          c.fill();
          c.globalAlpha = 1;
        }
        c.stroke();
        break;
      }
      case 'arrow':
      case 'double_arrow': {
        if (pts.length < 2) break;
        const [a, b] = pts;
        c.beginPath();
        c.moveTo(a!.x, a!.y);
        c.lineTo(b!.x, b!.y);
        c.stroke();
        drawArrowHead(c, b!.x, b!.y, a!.x, a!.y, d.style.arrowSize ?? 8);
        if (d.type === 'double_arrow') drawArrowHead(c, a!.x, a!.y, b!.x, b!.y, d.style.arrowSize ?? 8);
        break;
      }
      case 'text':
      case 'callout':
      case 'price_note': {
        const p0 = pts[0];
        if (!p0 || !d.text) break;
        c.fillStyle = d.style.textColor || theme.text;
        c.font = `${d.style.fontWeight ?? 500} ${d.style.fontSize ?? 13}px ${theme.font.family}`;
        c.textBaseline = 'middle';
        c.textAlign = d.style.textAlign ?? 'left';
        // Background pill for callouts
        if (d.type !== 'text') {
          const padding = 6;
          const metrics = c.measureText(d.text);
          const w = metrics.width + padding * 2;
          const h = (d.style.fontSize ?? 13) + padding * 2;
          c.fillStyle = d.style.fillColor || theme.surface;
          roundRect(c, p0.x - padding, p0.y - h / 2, w, h, d.style.cornerRadius ?? 6);
          c.fill();
          c.fillStyle = d.style.textColor || theme.text;
        }
        c.fillText(d.text, p0.x, p0.y);
        break;
      }
      case 'emoji': {
        const p0 = pts[0];
        if (!p0 || !d.emoji) break;
        const size = d.style.fontSize ?? 22;
        c.font = `${size}px ${theme.font.family}`;
        c.textBaseline = 'middle';
        c.textAlign = 'center';
        c.fillText(d.emoji, p0.x, p0.y);
        break;
      }
      case 'table': {
        if (!d.table || pts.length < 1) break;
        renderTable(c, theme, d, pts[0]!);
        break;
      }
      case 'risk_reward_long':
      case 'risk_reward_short': {
        if (pts.length < 2) break;
        const isLong = d.type === 'risk_reward_long';
        const [a, b] = pts;
        const entry = d.riskReward?.entry ?? (a!.y + b!.y) / 2;
        const stop = d.riskReward?.stop ?? (isLong ? Math.max(a!.y, b!.y) : Math.min(a!.y, b!.y));
        const target = d.riskReward?.target ?? (isLong ? Math.min(a!.y, b!.y) : Math.max(a!.y, b!.y));
        const x0 = Math.min(a!.x, b!.x);
        const xWidth = Math.abs(b!.x - a!.x);
        const yEntry = ctx.priceScale.priceToY(entry);
        const yStop = ctx.priceScale.priceToY(stop);
        const yTarget = ctx.priceScale.priceToY(target);
        // Risk zone (entry → stop) red, reward zone (entry → target) green.
        c.fillStyle = isLong ? theme.bullDim : theme.bearDim;
        c.fillRect(x0, Math.min(yEntry, yTarget), xWidth, Math.abs(yTarget - yEntry));
        c.fillStyle = isLong ? theme.bearDim : theme.bullDim;
        c.fillRect(x0, Math.min(yEntry, yStop), xWidth, Math.abs(yStop - yEntry));
        c.strokeStyle = theme.accent;
        c.beginPath();
        c.moveTo(x0, yEntry);
        c.lineTo(x0 + xWidth, yEntry);
        c.stroke();
        break;
      }
      case 'ruler':
      case 'date_range':
      case 'price_range': {
        if (pts.length < 2) break;
        const [a, b] = pts;
        c.strokeStyle = theme.accent;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.moveTo(a!.x, a!.y);
        c.lineTo(b!.x, b!.y);
        c.stroke();
        c.setLineDash([]);
        const pA = d.points[0]!.price;
        const pB = d.points[1]!.price;
        const pctChange = pA === 0 ? 0 : ((pB - pA) / pA) * 100;
        const ms = Math.abs(d.points[1]!.time - d.points[0]!.time);
        const minutes = Math.round(ms / 60_000);
        const label = `${(pB - pA).toFixed(4)} (${pctChange.toFixed(2)}%) · ${minutes}m`;
        c.font = `${theme.font.sizeLabel}px ${theme.font.family}`;
        c.fillStyle = theme.text;
        c.textBaseline = 'bottom';
        c.fillText(label, (a!.x + b!.x) / 2, Math.min(a!.y, b!.y) - 4);
        break;
      }
      case 'fib_retracement': {
        if (pts.length < 2) break;
        const fibLevels = d.fib?.levels ?? [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const p0 = d.points[0]!;
        const p1 = d.points[1]!;
        const range = p1.price - p0.price;
        for (const lev of fibLevels) {
          const price = p0.price + range * lev;
          const y = ctx.priceScale.priceToY(price);
          c.strokeStyle = theme.accent;
          c.beginPath();
          c.moveTo(Math.min(pts[0]!.x, pts[1]!.x), y);
          c.lineTo(Math.max(pts[0]!.x, pts[1]!.x), y);
          c.stroke();
          if (d.fib?.showLabels !== false) {
            c.font = `${theme.font.sizeLabel}px ${theme.font.family}`;
            c.fillStyle = theme.textMuted;
            c.textBaseline = 'middle';
            c.fillText(`${(lev * 100).toFixed(1)}%  ${price.toFixed(2)}`, Math.max(pts[0]!.x, pts[1]!.x) + 4, y);
          }
        }
        break;
      }
      default: {
        if (pts.length >= 2) {
          c.beginPath();
          c.moveTo(pts[0]!.x, pts[0]!.y);
          for (let i = 1; i < pts.length; i += 1) c.lineTo(pts[i]!.x, pts[i]!.y);
          c.stroke();
        }
      }
    }
    c.restore();
  }
}

function drawArrowHead(
  c: CanvasRenderingContext2D,
  toX: number,
  toY: number,
  fromX: number,
  fromY: number,
  size: number,
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  c.beginPath();
  c.moveTo(toX, toY);
  c.lineTo(toX - size * Math.cos(angle - Math.PI / 6), toY - size * Math.sin(angle - Math.PI / 6));
  c.lineTo(toX - size * Math.cos(angle + Math.PI / 6), toY - size * Math.sin(angle + Math.PI / 6));
  c.closePath();
  c.fillStyle = c.strokeStyle;
  c.fill();
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

function renderTable(
  c: CanvasRenderingContext2D,
  theme: { surface: string; text: string; border: string; font: { family: string; sizeLabel: number } },
  d: DrawingObject,
  origin: { x: number; y: number },
): void {
  const table = d.table!;
  const cellW = 90;
  const cellH = 22;
  const w = table.cols * cellW;
  const h = table.rows * cellH;
  c.fillStyle = theme.surface;
  c.fillRect(origin.x, origin.y, w, h);
  c.strokeStyle = theme.border;
  c.lineWidth = 1;
  c.strokeRect(origin.x + 0.5, origin.y + 0.5, w - 1, h - 1);
  for (let r = 1; r < table.rows; r += 1) {
    c.beginPath();
    c.moveTo(origin.x, origin.y + r * cellH + 0.5);
    c.lineTo(origin.x + w, origin.y + r * cellH + 0.5);
    c.stroke();
  }
  for (let col = 1; col < table.cols; col += 1) {
    c.beginPath();
    c.moveTo(origin.x + col * cellW + 0.5, origin.y);
    c.lineTo(origin.x + col * cellW + 0.5, origin.y + h);
    c.stroke();
  }
  c.font = `${theme.font.sizeLabel}px ${theme.font.family}`;
  c.textBaseline = 'middle';
  for (const cell of table.cells) {
    const cx = origin.x + cell.col * cellW + 6;
    const cy = origin.y + cell.row * cellH + cellH / 2;
    if (cell.backgroundColor) {
      c.fillStyle = cell.backgroundColor;
      c.fillRect(origin.x + cell.col * cellW, origin.y + cell.row * cellH, cellW, cellH);
    }
    c.fillStyle = cell.color || theme.text;
    c.font = `${cell.bold ? '600 ' : ''}${theme.font.sizeLabel}px ${theme.font.family}`;
    c.fillText(cell.text, cx, cy);
  }
}
