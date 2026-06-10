'use client';

import type { DrawingObject, DrawingType, ChartPoint, DrawingStyle } from '@supercharts/types';
import type { ChartCore, ChartPointerEvent } from '@supercharts/chart-core';
import { nanoid } from './nanoid';

export interface DrawingDraftHandler {
  /** Called when a new drawing is created and should be persisted. */
  onCreate(d: DrawingObject): void | Promise<void>;
  /** Called when the user updates an existing drawing (drag, edit). */
  onUpdate(d: DrawingObject): void | Promise<void>;
  /** Called when the user deletes a drawing. */
  onDelete(id: string): void | Promise<void>;
}

const TWO_POINT_TYPES = new Set<DrawingType>([
  'trend_line',
  'ray',
  'extended_line',
  'rectangle',
  'ellipse',
  'fib_retracement',
  'ruler',
  'arrow',
  'risk_reward_long',
  'risk_reward_short',
]);

const SINGLE_POINT_TYPES = new Set<DrawingType>([
  'horizontal_line',
  'vertical_line',
  'text',
  'emoji',
  'table',
  'callout',
]);

interface DraftState {
  type: DrawingType;
  points: ChartPoint[];
  style: DrawingStyle;
  textPrompt?: string;
  /** Pixel position of the first pointerdown — used to tell a click from a drag. */
  startX: number;
  startY: number;
  /** True once the first gesture ended as a CLICK: the draft stays live and follows the
   *  cursor until a second click finalizes it (TradingView click-move-click placement). */
  armed: boolean;
}

/** Pointer travel (px) below which a down→up gesture counts as a click, not a drag. */
const CLICK_TOLERANCE_PX = 6;

/**
 * Owns the drawing lifecycle on a ChartCore: creation by pointer, selection, drag, delete.
 *
 * Drawings are stored locally for instant feedback and synced through `handlers`.
 * The chart's frame.drawings is the authoritative render source.
 */
export class DrawingController {
  private draft: DraftState | null = null;
  private selectedId: string | null = null;
  private dragging: { id: string; pointIdx: number | 'all'; startTime: number; startPrice: number } | null = null;
  private drawings: DrawingObject[] = [];
  private userId: string;
  private symbol: string;
  private getTool: () => string | null;
  private clearTool: () => void;
  private core: ChartCore;
  private handlers: DrawingDraftHandler;
  private removeListener: (() => void) | null = null;

  constructor(args: {
    core: ChartCore;
    symbol: string;
    userId: string;
    getTool: () => string | null;
    clearTool: () => void;
    handlers: DrawingDraftHandler;
    initial: DrawingObject[];
  }) {
    this.core = args.core;
    this.symbol = args.symbol;
    this.userId = args.userId;
    this.getTool = args.getTool;
    this.clearTool = args.clearTool;
    this.handlers = args.handlers;
    this.drawings = args.initial.slice();
    this.core.setDrawings(this.drawings);
    this.attach();
  }

  destroy(): void {
    this.removeListener?.();
    this.removeListener = null;
  }

  /** Replace the drawing set, e.g. after a fresh server fetch. */
  setDrawings(drawings: DrawingObject[]): void {
    this.drawings = drawings.slice();
    this.core.setDrawings(this.drawings);
  }

  private attach(): void {
    // Hook into pointer events from ChartCore via options.
    // We re-wrap the core's onPointerEvent by replacing the option in place — ChartCore reads
    // this each event.
    const original = (this.core as unknown as { opts: { onPointerEvent?: (e: ChartPointerEvent) => void } }).opts.onPointerEvent;
    (this.core as unknown as { opts: { onPointerEvent?: (e: ChartPointerEvent) => void } }).opts.onPointerEvent = (e) => {
      original?.(e);
      this.handle(e);
    };
    this.removeListener = () => {
      (this.core as unknown as { opts: { onPointerEvent?: (e: ChartPointerEvent) => void } }).opts.onPointerEvent = original;
    };
  }

  private handle(e: ChartPointerEvent): void {
    const tool = this.getTool();
    if (tool && tool !== 'cursor' && tool !== 'crosshair') {
      this.handleCreate(tool as DrawingType, e);
      return;
    }
    if (e.type === 'pointerdown') {
      const hit = this.hitTest(e);
      if (hit) {
        this.selectedId = hit.id;
        this.dragging = { id: hit.id, pointIdx: hit.pointIdx, startTime: e.time, startPrice: e.price };
      } else {
        this.selectedId = null;
      }
    } else if (e.type === 'pointermove' && this.dragging) {
      const d = this.drawings.find((x) => x.id === this.dragging!.id);
      if (!d) return;
      const dt = e.time - this.dragging.startTime;
      const dp = e.price - this.dragging.startPrice;
      const updated: DrawingObject = {
        ...d,
        points:
          this.dragging.pointIdx === 'all'
            ? d.points.map((pt) => ({ time: pt.time + dt, price: pt.price + dp }))
            : d.points.map((pt, i) =>
                i === this.dragging!.pointIdx ? { time: e.time, price: e.price } : pt,
              ),
        updatedAt: Date.now(),
      };
      this.dragging.startTime = e.time;
      this.dragging.startPrice = e.price;
      this.replaceDrawing(updated);
    } else if (e.type === 'pointerup') {
      if (this.dragging) {
        const d = this.drawings.find((x) => x.id === this.dragging!.id);
        if (d) void this.handlers.onUpdate(d);
        this.dragging = null;
      }
    }
  }

  private handleCreate(type: DrawingType, e: ChartPointerEvent): void {
    if (e.type !== 'pointerdown' && e.type !== 'pointerup' && e.type !== 'pointermove') return;

    if (SINGLE_POINT_TYPES.has(type)) {
      if (e.type !== 'pointerdown') return;
      const text = type === 'text' || type === 'callout' || type === 'price_note'
        ? prompt('Label text', 'Note')?.trim() || 'Note'
        : undefined;
      const emoji = type === 'emoji' ? prompt('Emoji', '🔥')?.trim() || '🔥' : undefined;
      const table = type === 'table'
        ? {
            rows: 3,
            cols: 2,
            headerRow: true,
            headerCol: false,
            cells: [
              { row: 0, col: 0, text: 'Plan', bold: true },
              { row: 0, col: 1, text: 'Notes', bold: true },
              { row: 1, col: 0, text: 'Entry' },
              { row: 1, col: 1, text: '—' },
              { row: 2, col: 0, text: 'Stop' },
              { row: 2, col: 1, text: '—' },
            ],
          }
        : undefined;

      const drawing: DrawingObject = {
        id: nanoid(),
        userId: this.userId,
        symbol: this.symbol,
        type,
        points: [{ time: e.time, price: e.price }],
        style: defaultStyle(type),
        text,
        emoji,
        table,
        locked: false,
        visible: true,
        zIndex: this.drawings.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.drawings.push(drawing);
      this.core.setDrawings(this.drawings);
      void this.handlers.onCreate(drawing);
      this.clearTool();
      return;
    }

    if (TWO_POINT_TYPES.has(type)) {
      // Two placement gestures, both supported (TradingView accepts both):
      //   1. click-move-click — click anchors point A, the preview follows the cursor,
      //      a second click drops point B. This is the gesture TV users reach for first.
      //   2. press-drag-release — drag from A to B in one motion.
      // A down→up with < CLICK_TOLERANCE_PX of travel is a click; finalizing on it would
      // create an invisible zero-length drawing and silently eat the gesture (the original
      // bug: "drawing tools don't work" for anyone who clicks instead of drags).
      if (e.type === 'pointerdown') {
        if (this.draft?.armed) {
          // Second click — drop point B and finalize.
          this.draft.points[1] = { time: e.time, price: e.price };
          this.finalizeDraft();
          return;
        }
        this.draft = {
          type,
          points: [{ time: e.time, price: e.price }, { time: e.time, price: e.price }],
          style: defaultStyle(type),
          startX: e.x,
          startY: e.y,
          armed: false,
        };
      } else if (this.draft && e.type === 'pointermove') {
        this.draft.points[1] = { time: e.time, price: e.price };
        const provisional: DrawingObject = this.draftToDrawing(this.draft);
        this.core.setDrawings([...this.drawings, provisional]);
      } else if (this.draft && e.type === 'pointerup') {
        const travel = Math.hypot(e.x - this.draft.startX, e.y - this.draft.startY);
        if (travel < CLICK_TOLERANCE_PX) {
          // It was a click — arm the draft and keep following the cursor until click #2.
          this.draft.armed = true;
          return;
        }
        // It was a drag — finalize at the release point.
        this.draft.points[1] = { time: e.time, price: e.price };
        this.finalizeDraft();
      }
    }
  }

  private finalizeDraft(): void {
    if (!this.draft) return;
    const drawing = this.draftToDrawing(this.draft);
    this.drawings.push(drawing);
    this.core.setDrawings(this.drawings);
    void this.handlers.onCreate(drawing);
    this.draft = null;
    this.clearTool();
  }

  /** Public — abort an in-progress placement (Escape) and erase the preview. */
  cancelDraft(): void {
    if (!this.draft) return;
    this.draft = null;
    this.core.setDrawings(this.drawings);
  }

  private draftToDrawing(d: DraftState): DrawingObject {
    return {
      id: nanoid(),
      userId: this.userId,
      symbol: this.symbol,
      type: d.type,
      points: d.points.slice(),
      style: d.style,
      locked: false,
      visible: true,
      zIndex: this.drawings.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(d.type === 'fib_retracement'
        ? { fib: { levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1], showLabels: true, showPrices: true } }
        : {}),
    };
  }

  private replaceDrawing(d: DrawingObject): void {
    const idx = this.drawings.findIndex((x) => x.id === d.id);
    if (idx < 0) return;
    this.drawings[idx] = d;
    this.core.setDrawings(this.drawings);
  }

  private hitTest(e: ChartPointerEvent): { id: string; pointIdx: number | 'all' } | null {
    const TOL_TIME_MS = 60 * 1000; // 1 min tolerance at default zoom — chart converts back via scale
    for (let i = this.drawings.length - 1; i >= 0; i -= 1) {
      const d = this.drawings[i]!;
      if (d.locked) continue;
      // Check each point as a handle.
      for (let p = 0; p < d.points.length; p += 1) {
        const pt = d.points[p]!;
        if (Math.abs(pt.time - e.time) < TOL_TIME_MS && Math.abs(pt.price - e.price) < approxPriceTol(d, e)) {
          return { id: d.id, pointIdx: p };
        }
      }
      // Fallback: rough containing rectangle.
      if (d.points.length >= 2) {
        const minT = Math.min(d.points[0]!.time, d.points[1]!.time);
        const maxT = Math.max(d.points[0]!.time, d.points[1]!.time);
        const minP = Math.min(d.points[0]!.price, d.points[1]!.price);
        const maxP = Math.max(d.points[0]!.price, d.points[1]!.price);
        if (e.time >= minT && e.time <= maxT && e.price >= minP && e.price <= maxP) {
          return { id: d.id, pointIdx: 'all' };
        }
      }
    }
    return null;
  }

  /** Public — delete the currently selected drawing. */
  deleteSelected(): void {
    if (!this.selectedId) return;
    const id = this.selectedId;
    this.drawings = this.drawings.filter((d) => d.id !== id);
    this.core.setDrawings(this.drawings);
    this.selectedId = null;
    void this.handlers.onDelete(id);
  }
}

function approxPriceTol(d: DrawingObject, e: ChartPointerEvent): number {
  const span = Math.max(1e-9, (d.points[0]?.price ?? e.price) * 0.001);
  return span;
}

function defaultStyle(type: DrawingType): DrawingStyle {
  switch (type) {
    case 'risk_reward_long':
    case 'risk_reward_short':
      return { strokeColor: '#7c9cff', strokeWidth: 1.2, fillColor: '#7c9cff', fillOpacity: 0.12 };
    case 'rectangle':
      return { strokeColor: '#7c9cff', strokeWidth: 1.4, fillColor: '#7c9cff', fillOpacity: 0.12 };
    case 'horizontal_line':
      return { strokeColor: '#f0b429', strokeWidth: 1.2, strokeDash: '4 3' };
    case 'fib_retracement':
      return { strokeColor: '#7c9cff', strokeWidth: 1.2 };
    case 'text':
    case 'callout':
    case 'price_note':
      return { strokeColor: '#7c9cff', strokeWidth: 1, fontSize: 13, fontWeight: 500, textColor: '#e6edf3', fillColor: 'rgba(13,17,23,0.85)' };
    case 'emoji':
      return { strokeColor: 'transparent', strokeWidth: 0, fontSize: 28 };
    case 'table':
      return { strokeColor: '#7c9cff', strokeWidth: 1, fontSize: 11 };
    default:
      return { strokeColor: '#7c9cff', strokeWidth: 1.4 };
  }
}
