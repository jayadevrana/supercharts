/**
 * Time and price scales.
 *
 * Time scale maps logical time (UNIX ms) ↔ x pixel.
 * Price scale maps price ↔ y pixel. Supports linear and log modes.
 *
 * Both scales own a small amount of mutable state (origin, span) and are deterministic.
 * They do not allocate during transforms — critical because crosshair / heatmap / candle
 * layers call them thousands of times per frame.
 */

export interface TimeScaleState {
  /** Width of the price pane in pixels. */
  width: number;
  /** UNIX ms at the right edge. */
  rightTime: number;
  /** Pixels per millisecond. */
  pxPerMs: number;
  /** Pixels between consecutive bars (logical bar width). */
  barWidth: number;
  /** Bar duration in ms (e.g. 60_000 for 1m). 0 for tick charts. */
  barDurationMs: number;
}

export class TimeScale {
  state: TimeScaleState;

  constructor(state: TimeScaleState) {
    this.state = state;
  }

  /** Convert UNIX ms → x pixel. */
  timeToX(t: number): number {
    return this.state.width - (this.state.rightTime - t) * this.state.pxPerMs;
  }

  /** Convert x pixel → UNIX ms. */
  xToTime(x: number): number {
    return this.state.rightTime - (this.state.width - x) / this.state.pxPerMs;
  }

  /** Width in px of a bar at the current zoom. */
  barPx(): number {
    return Math.max(1, this.state.barWidth);
  }

  /** Returns the visible [fromTime, toTime] range. */
  visibleRange(): { fromTime: number; toTime: number } {
    return {
      fromTime: this.xToTime(0),
      toTime: this.state.rightTime,
    };
  }

  /**
   * Pan the chart by dx pixels. Sign matches TradingView: dragging the chart to the right
   * with the cursor pulls older data into view from the left (candles follow the cursor),
   * so positive dx moves `rightTime` backward.
   */
  pan(dxPixels: number): void {
    this.state.rightTime -= dxPixels / this.state.pxPerMs;
  }

  /**
   * Zoom around a focal x. factor < 1 zooms in (bars wider), factor > 1 zooms out.
   * Keeps the time under `focalX` stationary, which is what a wheel-around-cursor zoom should do.
   */
  zoomAroundX(focalX: number, factor: number): void {
    const tFocal = this.xToTime(focalX);
    this.state.pxPerMs /= factor;
    this.state.barWidth /= factor;
    // After scaling pxPerMs, re-anchor rightTime so tFocal still sits at focalX.
    this.state.rightTime = tFocal + (this.state.width - focalX) / this.state.pxPerMs;
  }
}

export type PriceScaleMode = 'linear' | 'log' | 'percent';

export interface PriceScaleState {
  /** Height of the pane in pixels. */
  height: number;
  /** Price visible at top of pane. */
  priceMax: number;
  /** Price visible at bottom of pane. */
  priceMin: number;
  mode: PriceScaleMode;
  inverted: boolean;
  /**
   * Percent-mode baseline (the first visible bar's close, TV semantics). Percent mode keeps
   * the linear price↔y transform — only labels are expressed as % change vs this baseline.
   */
  baseline?: number;
}

export class PriceScale {
  state: PriceScaleState;

  constructor(state: PriceScaleState) {
    this.state = state;
  }

  priceToY(price: number): number {
    const { priceMin, priceMax, height, mode, inverted } = this.state;
    let normalized: number;
    if (mode === 'log') {
      const lp = Math.log(Math.max(price, 1e-12));
      const lo = Math.log(Math.max(priceMin, 1e-12));
      const hi = Math.log(Math.max(priceMax, 1e-12));
      normalized = (lp - lo) / Math.max(hi - lo, 1e-9);
    } else {
      normalized = (price - priceMin) / Math.max(priceMax - priceMin, 1e-9);
    }
    const y = (1 - normalized) * height;
    return inverted ? height - y : y;
  }

  yToPrice(y: number): number {
    const { priceMin, priceMax, height, mode, inverted } = this.state;
    const effY = inverted ? height - y : y;
    const normalized = 1 - effY / Math.max(height, 1);
    if (mode === 'log') {
      const lo = Math.log(Math.max(priceMin, 1e-12));
      const hi = Math.log(Math.max(priceMax, 1e-12));
      return Math.exp(lo + normalized * (hi - lo));
    }
    return priceMin + normalized * (priceMax - priceMin);
  }

  /** Fit the scale to a visible price range with optional padding. */
  fit(lowestPrice: number, highestPrice: number, paddingFraction = 0.07): void {
    const span = Math.max(highestPrice - lowestPrice, lowestPrice * 1e-6, 1e-9);
    const pad = span * paddingFraction;
    this.state.priceMin = lowestPrice - pad;
    this.state.priceMax = highestPrice + pad;
  }

  /**
   * Shift price range by dy pixels. Positive dy (cursor dragged down) moves the window to
   * higher prices — the content follows the cursor, grab-style.
   * In log mode the shift happens in log space (a pixel pans a constant *ratio*, not a
   * constant price delta) so panning feels uniform across the whole axis.
   */
  pan(dyPixels: number): void {
    const { priceMin, priceMax, height, mode } = this.state;
    if (mode === 'log') {
      const lo = Math.log(Math.max(priceMin, 1e-12));
      const hi = Math.log(Math.max(priceMax, 1e-12));
      const dLog = (hi - lo) * (dyPixels / Math.max(height, 1));
      this.state.priceMin = Math.exp(lo + dLog);
      this.state.priceMax = Math.exp(hi + dLog);
      return;
    }
    const dPrice = (priceMax - priceMin) * (dyPixels / Math.max(height, 1));
    this.state.priceMin += dPrice;
    this.state.priceMax += dPrice;
  }

  /**
   * Zoom around a focal y. factor < 1 stretches range smaller (more detail).
   * Log mode scales the log-span around the focal price so the price under the cursor
   * stays pinned and both halves zoom by equal ratios.
   */
  zoomAroundY(focalY: number, factor: number): void {
    const pFocal = this.yToPrice(focalY);
    const { priceMin, priceMax, mode } = this.state;
    if (mode === 'log') {
      const lf = Math.log(Math.max(pFocal, 1e-12));
      const lo = Math.log(Math.max(priceMin, 1e-12));
      const hi = Math.log(Math.max(priceMax, 1e-12));
      this.state.priceMin = Math.exp(lf + (lo - lf) * factor);
      this.state.priceMax = Math.exp(lf + (hi - lf) * factor);
      return;
    }
    this.state.priceMin = pFocal + (priceMin - pFocal) * factor;
    this.state.priceMax = pFocal + (priceMax - pFocal) * factor;
  }
}
