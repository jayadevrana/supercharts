import type { Candle, DeepTradeBubble, LiquidityHeatmapCell, VolumeProfile } from '@supercharts/types';
import type { ChartTheme } from '../theme';
import type { PriceScale, TimeScale } from '../scale';
import type { ChartGeometry } from '../viewport';
import type { DrawingObject } from '@supercharts/types';

export interface ChartFrame {
  /** Ordered candles, ascending by openTime. The PriceSeriesLayer mutates this in place to extend live bars. */
  candles: Candle[];
  heatmapCells: LiquidityHeatmapCell[];
  deepTrades: DeepTradeBubble[];
  volumeProfile: VolumeProfile | null;
  drawings: DrawingObject[];
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  theme: ChartTheme;
  timeScale: TimeScale;
  priceScale: PriceScale;
  /** Independent price scale for the volume pane (linear, 0 .. maxVolume). */
  volumeScale: PriceScale;
  geometry: ChartGeometry;
  frame: ChartFrame;
  /** Crosshair state, or null when hidden. */
  crosshair: { x: number; y: number; time: number; price: number } | null;
  /** Time mirrored from another pane (for cross-pane sync). Drawn as a soft vertical line. */
  externalCrosshairTime?: number | null;
  /** Devicepixel ratio for crisp lines. */
  dpr: number;
  /** Time of render in ms, lets layers animate (heatmap fade, etc.). */
  now: number;
}

export interface Layer {
  readonly id: string;
  readonly zIndex: number;
  /** Layers can skip drawing when false. */
  visible: boolean;
  /** Render into the current canvas context. The caller has already applied dpr scaling and clipping per-pane. */
  render(ctx: RenderContext): void;
}
