import type { Candle, DrawingObject, DeepTradeBubble, FootprintBar, LiquidityHeatmapCell, VolumeProfile } from '@supercharts/types';
import { PriceScale, TimeScale } from './scale';
import { computeGeometry, type ChartGeometry } from './viewport';
import { DARK_THEME, type ChartTheme } from './theme';
import type { Layer, RenderContext, ChartFrame } from './layers/types';
import { GridLayer } from './layers/grid';
import { AxisLayer } from './layers/axis';
import { PriceSeriesLayer } from './layers/price-series';
import { VolumeLayer } from './layers/volume';
import { CrosshairLayer } from './layers/crosshair';
import { LiquidityHeatmapLayer } from './layers/heatmap';
import { DeepTradesLayer } from './layers/deep-trades';
import { VolumeProfileLayer } from './layers/volume-profile';
import { MarketProfileLayer } from './layers/market-profile';
import { DrawingLayer } from './layers/drawings';
import { TooltipLayer } from './layers/tooltip';
import { FootprintLayer } from './layers/footprint';
import { SignalsTrendScoreLayer } from './layers/signals-trend-score';
import { SmcLayer } from './layers/smc';
import { IndicatorsLayer } from './layers/indicators';
import { MaCrossLayer } from './layers/ma-cross';

export interface ChartCoreOptions {
  canvas: HTMLCanvasElement;
  theme?: ChartTheme;
  initialBarWidth?: number;
  initialBarDurationMs?: number;
  showVolumePane?: boolean;
  /** Called whenever the visible range changes (debounced). Use to fetch historical data. */
  onVisibleRangeChange?: (range: { fromTime: number; toTime: number }) => void;
  /** Called when the user clicks a price/time location (e.g. while a draw tool is active). */
  onPointerEvent?: (event: ChartPointerEvent) => void;
  /**
   * Optional drag suppression. Return true while the consumer is interpreting the pointer
   * stream itself (drawing creation, selection, etc.) so the chart engine does not also pan.
   */
  shouldSuppressPan?: () => boolean;
}

export interface ChartPointerEvent {
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'click' | 'doubleclick' | 'contextmenu';
  x: number;
  y: number;
  time: number;
  price: number;
  buttons: number;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export class ChartCore {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  theme: ChartTheme;
  timeScale: TimeScale;
  priceScale: PriceScale;
  volumeScale: PriceScale;
  geometry: ChartGeometry;
  layers: Layer[] = [];

  private frame: ChartFrame = {
    candles: [],
    heatmapCells: [],
    deepTrades: [],
    volumeProfile: null,
    footprint: [],
    drawings: [],
  };
  private crosshair: RenderContext['crosshair'] = null;
  /** Time mirrored from another pane (for cross-pane crosshair sync). */
  private externalTime: number | null = null;
  private rafId = 0;
  private dirty = true;
  private dpr = 1;
  private resizeObserver?: ResizeObserver;
  /** Deferred follow-up resize when the first measurement yields a zero-sized box. */
  private firstLayoutRafId = 0;
  private removeListeners: Array<() => void> = [];
  private autoFollow = true;
  private rangeChangeTimer: ReturnType<typeof setTimeout> | null = null;
  private opts: ChartCoreOptions;

  constructor(opts: ChartCoreOptions) {
    this.opts = opts;
    this.canvas = opts.canvas;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.theme = opts.theme ?? DARK_THEME;
    // Prefer the parent box for the initial measurement — the canvas is CSS-positioned
    // to fill its parent, so the parent's reflowed size is the source of truth. If the
    // parent hasn't laid out yet, the follow-up RAF and the ResizeObserver attached in
    // `attachResize()` will reissue resize() once the browser commits layout.
    const initParent = this.canvas.parentElement;
    const rect = initParent
      ? initParent.getBoundingClientRect()
      : this.canvas.getBoundingClientRect();
    const w = Math.max(100, rect.width);
    const h = Math.max(100, rect.height);
    this.dpr = window.devicePixelRatio || 1;
    this.geometry = computeGeometry(w, h, { showVolumePane: opts.showVolumePane ?? true });
    const barDur = opts.initialBarDurationMs ?? 60_000;
    const barW = opts.initialBarWidth ?? 8;
    this.timeScale = new TimeScale({
      width: this.geometry.pricePane.width,
      rightTime: Date.now() + barDur * 6, // leave a little space on the right
      pxPerMs: barW / barDur,
      barWidth: barW,
      barDurationMs: barDur,
    });
    this.priceScale = new PriceScale({
      height: this.geometry.pricePane.height,
      priceMin: 0,
      priceMax: 100,
      mode: 'linear',
      inverted: false,
    });
    this.volumeScale = new PriceScale({
      height: this.geometry.volumePane.height,
      priceMin: 0,
      priceMax: 1,
      mode: 'linear',
      inverted: false,
    });

    this.registerDefaultLayers();
    this.attachInteractions();
    this.attachResize();
    this.resize();
    this.loop();
  }

  destroy(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.firstLayoutRafId) cancelAnimationFrame(this.firstLayoutRafId);
    this.resizeObserver?.disconnect();
    for (const off of this.removeListeners) off();
    this.removeListeners = [];
  }

  setTheme(theme: ChartTheme): void {
    this.theme = theme;
    this.markDirty();
  }

  registerLayer(layer: Layer): void {
    this.layers.push(layer);
    this.layers.sort((a, b) => a.zIndex - b.zIndex);
    this.markDirty();
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
    this.markDirty();
  }

  getLayer<T extends Layer = Layer>(id: string): T | undefined {
    return this.layers.find((l) => l.id === id) as T | undefined;
  }

  setCandles(candles: Candle[]): void {
    this.frame.candles = candles;
    if (candles.length > 0) {
      this.fitPriceScaleToVisible();
      if (this.autoFollow) {
        const last = candles[candles.length - 1]!;
        const barDur = last.closeTime - last.openTime || this.timeScale.state.barDurationMs;
        const prevBarDur = this.timeScale.state.barDurationMs;
        // When the bar duration changes (timeframe switch), rescale `pxPerMs` so each bar
        // keeps roughly the same on-screen width. Without this, switching 1m → 1h with the
        // old pxPerMs would space bars 60× wider on screen while leaving the candle body
        // width unchanged — producing the thin-stick rendering bug.
        if (barDur > 0 && prevBarDur > 0 && barDur !== prevBarDur) {
          const desiredBarWidth = this.timeScale.state.barWidth || 8;
          this.timeScale.state.pxPerMs = desiredBarWidth / barDur;
        }
        this.timeScale.state.barDurationMs = barDur;
        // Recompute barWidth from pxPerMs in case zoom drifted.
        this.timeScale.state.barWidth = Math.max(1, barDur * this.timeScale.state.pxPerMs);
        this.timeScale.state.rightTime = last.closeTime + barDur * 6;
      }
    }
    this.markDirty();
  }

  /** Append or replace the last candle (live update). Returns true if the bar advanced. */
  upsertCandle(c: Candle): boolean {
    const arr = this.frame.candles;
    const last = arr[arr.length - 1];
    if (!last) {
      arr.push(c);
      this.markDirty();
      return true;
    }
    if (c.openTime === last.openTime) {
      arr[arr.length - 1] = c;
      this.markDirty();
      return false;
    }
    if (c.openTime > last.openTime) {
      arr.push(c);
      if (this.autoFollow) {
        const barDur = c.closeTime - c.openTime || this.timeScale.state.barDurationMs;
        this.timeScale.state.rightTime = c.closeTime + barDur * 6;
      }
      this.markDirty();
      return true;
    }
    // out-of-order — ignore
    return false;
  }

  setHeatmapCells(cells: LiquidityHeatmapCell[]): void {
    this.frame.heatmapCells = cells;
    this.markDirty();
  }

  setDeepTrades(bubbles: DeepTradeBubble[]): void {
    this.frame.deepTrades = bubbles;
    this.markDirty();
  }

  setVolumeProfile(profile: VolumeProfile | null): void {
    this.frame.volumeProfile = profile;
    this.markDirty();
  }

  setFootprint(bars: FootprintBar[]): void {
    this.frame.footprint = bars;
    this.markDirty();
  }

  setDrawings(drawings: DrawingObject[]): void {
    this.frame.drawings = drawings;
    this.markDirty();
  }

  getVisibleRange(): { fromTime: number; toTime: number } {
    return this.timeScale.visibleRange();
  }

  /**
   * Sync a crosshair time from an external pane. The chart draws a soft vertical line
   * at this time as long as there is no local crosshair.
   */
  setExternalCrosshairTime(time: number | null): void {
    this.externalTime = time;
    this.markDirty();
  }

  /** Allow external code (e.g. ChartPane) to listen to crosshair changes for cross-pane sync. */
  onCrosshair(cb: (state: { time: number | null }) => void): () => void {
    this.crosshairListeners.add(cb);
    return () => this.crosshairListeners.delete(cb);
  }

  private crosshairListeners = new Set<(s: { time: number | null }) => void>();
  private emitCrosshair(): void {
    const t = this.crosshair?.time ?? null;
    for (const cb of this.crosshairListeners) cb({ time: t });
  }

  // -------- internals --------

  private registerDefaultLayers(): void {
    this.registerLayer(new GridLayer());
    this.registerLayer(new LiquidityHeatmapLayer({ enabled: false }));
    this.registerLayer(new VolumeProfileLayer());
    this.registerLayer(new MarketProfileLayer());
    this.registerLayer(new FootprintLayer({ enabled: false }));
    this.registerLayer(new VolumeLayer());
    this.registerLayer(new PriceSeriesLayer({ chartType: 'candlestick' }));
    this.registerLayer(new DeepTradesLayer());
    this.registerLayer(new SignalsTrendScoreLayer());
    this.registerLayer(new SmcLayer());
    this.registerLayer(new IndicatorsLayer());
    // PulseScript user-script output (draw line/band → lines/bands, mark → dots), above the
    // classic indicators layer so script overlays sit on top.
    this.registerLayer(new IndicatorsLayer({ id: 'pulse-script', zIndex: 13 }));
    this.registerLayer(new MaCrossLayer());
    this.registerLayer(new DrawingLayer());
    this.registerLayer(new CrosshairLayer());
    this.registerLayer(new TooltipLayer());
    this.registerLayer(new AxisLayer());
  }

  private attachResize(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      // Observe BOTH the canvas (for direct size changes) and its parent (for layout
      // changes that propagate via CSS h-full/w-full). Observing only the canvas is
      // unsafe if anything ever inlines an explicit width/height on it, because the
      // observer then stops firing when the parent reflows.
      this.resizeObserver.observe(this.canvas);
      const parent = this.canvas.parentElement;
      if (parent) this.resizeObserver.observe(parent);
    } else {
      const fn = () => this.resize();
      window.addEventListener('resize', fn);
      this.removeListeners.push(() => window.removeEventListener('resize', fn));
    }

    // The first getBoundingClientRect() in the constructor can return 0×0 when the
    // chart is mounted inside a freshly-created grid track (e.g. user just switched to
    // a 2-pane layout). Schedule a follow-up resize once the browser has committed
    // layout so we don't render against the 100×100 fallback floor forever.
    if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
      this.firstLayoutRafId = window.requestAnimationFrame(() => {
        this.firstLayoutRafId = 0;
        this.resize();
      });
    }
  }

  private resize(): void {
    // Prefer the parent's content box — the canvas itself is CSS-sized to
    // `absolute inset-0 h-full w-full`, so the parent owns the real layout box.
    // Falling back to the canvas's own rect handles the rare case where the canvas
    // has no parent yet (e.g. mid-teardown).
    const parent = this.canvas.parentElement;
    const rect = parent
      ? parent.getBoundingClientRect()
      : this.canvas.getBoundingClientRect();
    // Skip work if the container isn't on screen yet — a follow-up RAF / ResizeObserver
    // will retry once layout settles. We still update the bitmap min-floor so the chart
    // is not literally zero-sized in memory.
    const measuredW = Math.floor(rect.width);
    const measuredH = Math.floor(rect.height);
    if (measuredW <= 0 || measuredH <= 0) {
      this.markDirty();
      return;
    }
    const w = Math.max(100, measuredW);
    const h = Math.max(100, measuredH);
    this.dpr = window.devicePixelRatio || 1;
    const bitmapW = Math.floor(w * this.dpr);
    const bitmapH = Math.floor(h * this.dpr);
    // Only mutate the bitmap. Do NOT touch canvas.style.width / canvas.style.height —
    // the host element keeps the canvas sized via CSS (`absolute inset-0 h-full w-full`),
    // and pinning an inline pixel size here would override those rules and break the
    // observer-driven resize loop on subsequent layout changes.
    if (this.canvas.width !== bitmapW) this.canvas.width = bitmapW;
    if (this.canvas.height !== bitmapH) this.canvas.height = bitmapH;
    this.geometry = computeGeometry(w, h, { showVolumePane: this.opts.showVolumePane ?? true });
    this.timeScale.state.width = this.geometry.pricePane.width;
    this.priceScale.state.height = this.geometry.pricePane.height;
    this.volumeScale.state.height = this.geometry.volumePane.height;
    this.fitPriceScaleToVisible();
    this.markDirty();
  }

  private attachInteractions(): void {
    const cvs = this.canvas;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let priceAxisDrag = false;
    let timeAxisDrag = false;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cvs.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      this.timeScale.zoomAroundX(x, factor);
      this.fitPriceScaleToVisible();
      this.autoFollow = false;
      this.scheduleRangeChange();
      this.markDirty();
    };

    const onPointerDown = (e: PointerEvent) => {
      cvs.setPointerCapture(e.pointerId);
      const rect = cvs.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const suppressed = this.opts.shouldSuppressPan?.() ?? false;
      if (x >= this.geometry.axisPane.x) priceAxisDrag = true;
      else if (y >= this.geometry.timeAxisPane.y) timeAxisDrag = true;
      else if (!suppressed) dragging = true;
      lastX = x;
      lastY = y;
      this.opts.onPointerEvent?.(this.toPointerEvent('pointerdown', e, x, y));
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = cvs.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (dragging) {
        this.timeScale.pan(x - lastX);
        this.priceScale.pan(y - lastY);
        this.autoFollow = false;
        this.scheduleRangeChange();
      } else if (priceAxisDrag) {
        // Drag stretches the price range.
        const factor = 1 + (y - lastY) * 0.005;
        this.priceScale.zoomAroundY(this.geometry.pricePane.height / 2, factor);
      } else if (timeAxisDrag) {
        const factor = 1 + (x - lastX) * 0.005;
        this.timeScale.zoomAroundX(this.geometry.pricePane.width / 2, factor);
        this.scheduleRangeChange();
      } else {
        // Hover → crosshair update.
        if (x >= 0 && x <= this.geometry.pricePane.width && y >= 0 && y <= this.geometry.pricePane.height + this.geometry.volumePane.height) {
          const time = this.timeScale.xToTime(x);
          const price = this.priceScale.yToPrice(y);
          this.crosshair = { x, y, time, price };
        } else {
          this.crosshair = null;
        }
        this.emitCrosshair();
      }
      lastX = x;
      lastY = y;
      this.markDirty();
      this.opts.onPointerEvent?.(this.toPointerEvent('pointermove', e, x, y));
    };

    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      priceAxisDrag = false;
      timeAxisDrag = false;
      try {
        cvs.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const rect = cvs.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.opts.onPointerEvent?.(this.toPointerEvent('pointerup', e, x, y));
    };

    const onLeave = () => {
      this.crosshair = null;
      this.emitCrosshair();
      this.markDirty();
    };

    const onDblClick = () => {
      // Reset auto-follow and fit to data.
      this.autoFollow = true;
      const candles = this.frame.candles;
      if (candles.length > 0) {
        const last = candles[candles.length - 1]!;
        const barDur = last.closeTime - last.openTime || this.timeScale.state.barDurationMs;
        this.timeScale.state.rightTime = last.closeTime + barDur * 6;
        // 120 bars default span
        this.timeScale.state.pxPerMs = this.timeScale.state.width / Math.max(1, 120 * barDur);
        this.timeScale.state.barWidth = barDur * this.timeScale.state.pxPerMs;
        this.fitPriceScaleToVisible();
        this.scheduleRangeChange();
        this.markDirty();
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const rect = cvs.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.opts.onPointerEvent?.({
        type: 'contextmenu',
        x,
        y,
        time: this.timeScale.xToTime(x),
        price: this.priceScale.yToPrice(y),
        buttons: e.buttons,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      });
    };

    cvs.addEventListener('wheel', onWheel, { passive: false });
    cvs.addEventListener('pointerdown', onPointerDown);
    cvs.addEventListener('pointermove', onPointerMove);
    cvs.addEventListener('pointerup', onPointerUp);
    cvs.addEventListener('pointerleave', onLeave);
    cvs.addEventListener('dblclick', onDblClick);
    cvs.addEventListener('contextmenu', onContextMenu);
    this.removeListeners.push(() => cvs.removeEventListener('contextmenu', onContextMenu));
    this.removeListeners.push(
      () => cvs.removeEventListener('wheel', onWheel),
      () => cvs.removeEventListener('pointerdown', onPointerDown),
      () => cvs.removeEventListener('pointermove', onPointerMove),
      () => cvs.removeEventListener('pointerup', onPointerUp),
      () => cvs.removeEventListener('pointerleave', onLeave),
      () => cvs.removeEventListener('dblclick', onDblClick),
    );
  }

  private toPointerEvent(
    type: ChartPointerEvent['type'],
    e: PointerEvent,
    x: number,
    y: number,
  ): ChartPointerEvent {
    return {
      type,
      x,
      y,
      time: this.timeScale.xToTime(x),
      price: this.priceScale.yToPrice(y),
      buttons: e.buttons,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
    };
  }

  private fitPriceScaleToVisible(): void {
    const { fromTime, toTime } = this.timeScale.visibleRange();
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of this.frame.candles) {
      if (k.openTime < fromTime || k.openTime > toTime) continue;
      if (k.low < lo) lo = k.low;
      if (k.high > hi) hi = k.high;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return;
    this.priceScale.fit(lo, hi, 0.08);
  }

  private scheduleRangeChange(): void {
    if (this.rangeChangeTimer) clearTimeout(this.rangeChangeTimer);
    this.rangeChangeTimer = setTimeout(() => {
      this.rangeChangeTimer = null;
      this.opts.onVisibleRangeChange?.(this.timeScale.visibleRange());
    }, 120);
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private loop = (): void => {
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private render(): void {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Background
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, canvas.width / this.dpr, canvas.height / this.dpr);

    const renderCtx: RenderContext = {
      ctx,
      theme: this.theme,
      timeScale: this.timeScale,
      priceScale: this.priceScale,
      volumeScale: this.volumeScale,
      geometry: this.geometry,
      frame: this.frame,
      crosshair: this.crosshair,
      externalCrosshairTime: this.externalTime,
      dpr: this.dpr,
      now: performance.now(),
    };
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      ctx.save();
      layer.render(renderCtx);
      ctx.restore();
    }
    ctx.restore();
  }
}
