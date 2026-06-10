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
import { EconomicEventsLayer } from './layers/economic-events';

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

// ---- Interaction feel tuning (momentum pan + eased wheel zoom) ----
/** Pointermove samples older than this stop contributing to the fling velocity. */
const FLING_SAMPLE_WINDOW_MS = 120;
/** If the pointer was held still this long before release, it's a positioning drag — no fling. */
const FLING_RELEASE_STALE_MS = 80;
/** Minimum release speed (px/ms) for inertia to kick in. */
const FLING_MIN_SPEED = 0.08;
/** Release speed cap (px/ms) so a wild throw doesn't launch the chart into orbit. */
const FLING_MAX_SPEED = 3.5;
/** Inertia velocity decay per 60Hz frame (normalized to real frame time). */
const INERTIA_DECAY_PER_FRAME = 0.95;
/** Inertia stops once speed falls under this epsilon (px/ms). */
const INERTIA_STOP_SPEED = 0.02;
/** Duration of one eased wheel-zoom tween; rapid wheel events retarget it instead of stacking. */
const WHEEL_ZOOM_MS = 120;

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
  /** Recent pointermove samples while panning — used to derive the release (fling) velocity. */
  private panSamples: Array<{ t: number; x: number; y: number }> = [];
  /** rAF id of the momentum-pan loop (0 when idle). */
  private inertiaRafId = 0;
  /** rAF id of the eased wheel-zoom tween (0 when idle). */
  private wheelZoomRafId = 0;
  /** In-flight wheel-zoom tween. Rapid wheel events retarget this object rather than stacking. */
  private wheelZoom: { fromPxPerMs: number; toPxPerMs: number; anchorX: number; start: number } | null = null;

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
    this.stopInertia();
    this.cancelWheelZoom();
    this.resizeObserver?.disconnect();
    for (const off of this.removeListeners) off();
    this.removeListeners = [];
  }

  setTheme(theme: ChartTheme): void {
    this.theme = theme;
    this.markDirty();
  }

  /**
   * Request a repaint on the next animation frame. Callers that mutate a layer's `options`
   * or `visible` flag directly (e.g. toggling an overlay) call this so the change shows
   * immediately, rather than waiting for the next live tick to dirty the canvas.
   */
  invalidate(): void {
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
      // Fit the price scale AFTER the time scale is settled, so we measure the window that's
      // actually about to be drawn. Fitting first used a stale visible range — invisible on
      // live symbols (ticks refit it) but sticky for static data like CSV imports.
      this.fitPriceScaleToVisible();
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
   * The exact time→x projection the canvas is drawing with, so React-rendered panes below the
   * chart (e.g. oscillator sub-panes) can map a candle to the SAME x pixel:
   *   x = plotWidth - (rightTime - t) * pxPerMs   (== TimeScale.timeToX)
   * `plotWidth` is the candle plotting area (excludes the right price-axis gutter); `totalWidth`
   * is the full canvas width, so a sibling SVG can reserve the same gutter and stay aligned.
   */
  getTimeProjection(): {
    fromTime: number;
    toTime: number;
    rightTime: number;
    pxPerMs: number;
    plotWidth: number;
    totalWidth: number;
  } {
    const s = this.timeScale.state;
    const { fromTime, toTime } = this.timeScale.visibleRange();
    return {
      fromTime,
      toTime,
      rightTime: s.rightTime,
      pxPerMs: s.pxPerMs,
      plotWidth: this.geometry.pricePane.width,
      totalWidth: this.geometry.width,
    };
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
    this.registerLayer(new EconomicEventsLayer());
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
      this.stopInertia();
      const rect = cvs.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      // Eased zoom: tween pxPerMs toward the target over a short rAF animation instead of
      // jumping. A rapid wheel burst retargets the SAME tween (compounding the target and
      // restarting from the current value) so steps coalesce rather than stack.
      const targetPxPerMs =
        (this.wheelZoom ? this.wheelZoom.toPxPerMs : this.timeScale.state.pxPerMs) / factor;
      this.wheelZoom = {
        fromPxPerMs: this.timeScale.state.pxPerMs,
        toPxPerMs: targetPxPerMs,
        anchorX: x,
        start: performance.now(),
      };
      this.autoFollow = false;
      if (!this.wheelZoomRafId) this.wheelZoomRafId = requestAnimationFrame(this.wheelZoomStep);
    };

    const onPointerDown = (e: PointerEvent) => {
      // A fresh gesture interrupts leftover motion: kill momentum pan, and snap a mid-flight
      // wheel zoom to its target so the tween can't re-anchor under the new gesture.
      this.stopInertia();
      this.finishWheelZoom();
      this.panSamples.length = 0;
      cvs.setPointerCapture(e.pointerId);
      const rect = cvs.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const suppressed = this.opts.shouldSuppressPan?.() ?? false;
      if (x >= this.geometry.axisPane.x) priceAxisDrag = true;
      else if (y >= this.geometry.timeAxisPane.y) timeAxisDrag = true;
      else if (!suppressed) {
        dragging = true;
        this.panSamples.push({ t: performance.now(), x, y });
      }
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
        const now = performance.now();
        this.panSamples.push({ t: now, x, y });
        while (this.panSamples.length > 0 && now - this.panSamples[0]!.t > FLING_SAMPLE_WINDOW_MS) {
          this.panSamples.shift();
        }
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
      const wasPanning = dragging;
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
      // Momentum pan: only after a real chart pan. Drawing gestures never set `dragging`
      // (shouldSuppressPan gated the pointerdown); re-check suppression at release too in
      // case a draw tool was armed mid-gesture.
      if (wasPanning && !(this.opts.shouldSuppressPan?.() ?? false)) {
        const v = this.releaseVelocity();
        if (v) this.startInertia(v.vx, v.vy);
      }
      this.panSamples.length = 0;
    };

    const onLeave = () => {
      this.crosshair = null;
      this.emitCrosshair();
      this.markDirty();
    };

    const onDblClick = () => {
      // Reset auto-follow and fit to data. Any leftover motion would fight the reset.
      this.stopInertia();
      this.cancelWheelZoom();
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

  // ---- Momentum pan (inertia) ----

  /**
   * Time-weighted release velocity (px/ms) from the recent pan samples: longer segments
   * count proportionally more and recent segments dominate (exp decay over ~50ms), so a
   * single jittery move can't dictate the fling. Returns null when the gesture doesn't
   * qualify (too slow, too stale, or not enough samples).
   */
  private releaseVelocity(): { vx: number; vy: number } | null {
    const samples = this.panSamples;
    if (samples.length < 2) return null;
    const now = performance.now();
    const last = samples[samples.length - 1]!;
    // Held still before letting go → a positioning drag, not a fling.
    if (now - last.t > FLING_RELEASE_STALE_MS) return null;
    let vx = 0;
    let vy = 0;
    let wsum = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1]!;
      const b = samples[i]!;
      const dt = b.t - a.t;
      if (dt <= 0 || now - b.t > FLING_SAMPLE_WINDOW_MS) continue;
      const w = dt * Math.exp(-(now - b.t) / 50);
      vx += ((b.x - a.x) / dt) * w;
      vy += ((b.y - a.y) / dt) * w;
      wsum += w;
    }
    if (wsum <= 0) return null;
    vx /= wsum;
    vy /= wsum;
    const speed = Math.hypot(vx, vy);
    if (speed < FLING_MIN_SPEED) return null;
    if (speed > FLING_MAX_SPEED) {
      const k = FLING_MAX_SPEED / speed;
      vx *= k;
      vy *= k;
    }
    return { vx, vy };
  }

  /**
   * Continue the pan with the release velocity, decaying ~0.95 per 60Hz frame
   * (frame-rate normalized) until it falls under a small epsilon. The next
   * pointerdown / wheel / dblclick stops it immediately.
   */
  private startInertia(vx0: number, vy0: number): void {
    this.stopInertia();
    let vx = vx0;
    let vy = vy0;
    let lastT = performance.now();
    const step = (now: number): void => {
      this.inertiaRafId = 0;
      // Clamp dt so a background-tab stall can't teleport the chart on resume.
      const dt = Math.min(Math.max(now - lastT, 0), 50);
      lastT = now;
      this.timeScale.pan(vx * dt);
      this.priceScale.pan(vy * dt);
      const decay = Math.pow(INERTIA_DECAY_PER_FRAME, dt / (1000 / 60));
      vx *= decay;
      vy *= decay;
      this.autoFollow = false;
      this.scheduleRangeChange();
      this.markDirty();
      if (Math.hypot(vx, vy) > INERTIA_STOP_SPEED) {
        this.inertiaRafId = requestAnimationFrame(step);
      }
    };
    this.inertiaRafId = requestAnimationFrame(step);
  }

  private stopInertia(): void {
    if (this.inertiaRafId) {
      cancelAnimationFrame(this.inertiaRafId);
      this.inertiaRafId = 0;
    }
  }

  // ---- Eased wheel zoom ----

  private wheelZoomStep = (now: number): void => {
    this.wheelZoomRafId = 0;
    const anim = this.wheelZoom;
    if (!anim) return;
    const t = Math.min(1, (now - anim.start) / WHEEL_ZOOM_MS);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    // Interpolate in log space so every frame is an equal zoom *ratio* — linear pxPerMs
    // interpolation feels lopsided across a large retargeted step.
    const lnFrom = Math.log(anim.fromPxPerMs);
    const lnTo = Math.log(anim.toPxPerMs);
    const desired = Math.exp(lnFrom + (lnTo - lnFrom) * eased);
    const stepFactor = this.timeScale.state.pxPerMs / desired;
    // zoomAroundX divides pxPerMs by the factor and re-anchors rightTime, so the time
    // under the cursor stays pinned for the whole tween.
    if (stepFactor !== 1) this.timeScale.zoomAroundX(anim.anchorX, stepFactor);
    this.fitPriceScaleToVisible();
    this.scheduleRangeChange();
    this.markDirty();
    if (t < 1) {
      this.wheelZoomRafId = requestAnimationFrame(this.wheelZoomStep);
    } else {
      this.wheelZoom = null;
    }
  };

  /** Snap an in-flight wheel zoom to its target (used when a pointer gesture interrupts it). */
  private finishWheelZoom(): void {
    if (this.wheelZoomRafId) {
      cancelAnimationFrame(this.wheelZoomRafId);
      this.wheelZoomRafId = 0;
    }
    const anim = this.wheelZoom;
    if (!anim) return;
    this.wheelZoom = null;
    const stepFactor = this.timeScale.state.pxPerMs / anim.toPxPerMs;
    if (stepFactor !== 1) {
      this.timeScale.zoomAroundX(anim.anchorX, stepFactor);
      this.fitPriceScaleToVisible();
      this.scheduleRangeChange();
      this.markDirty();
    }
  }

  /** Drop an in-flight wheel zoom where it is (dblclick fit overrides it; destroy). */
  private cancelWheelZoom(): void {
    if (this.wheelZoomRafId) {
      cancelAnimationFrame(this.wheelZoomRafId);
      this.wheelZoomRafId = 0;
    }
    this.wheelZoom = null;
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
