export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChartGeometry {
  /** Total canvas size. */
  width: number;
  height: number;
  /** Right-side axis reserved width. */
  axisWidth: number;
  /** Bottom-side time axis reserved height. */
  timeAxisHeight: number;
  /** Layout of price pane (price + candles + drawings). */
  pricePane: PaneRect;
  /** Optional volume pane below price (height 0 if disabled). */
  volumePane: PaneRect;
  /** Right-side axis pane. */
  axisPane: PaneRect;
  /** Bottom time-axis pane. */
  timeAxisPane: PaneRect;
}

export function computeGeometry(
  width: number,
  height: number,
  options: {
    showVolumePane?: boolean;
    volumePaneRatio?: number;
    axisWidth?: number;
    timeAxisHeight?: number;
  } = {},
): ChartGeometry {
  const axisWidth = options.axisWidth ?? 64;
  const timeAxisHeight = options.timeAxisHeight ?? 24;
  const showVolume = options.showVolumePane ?? true;
  const ratio = options.volumePaneRatio ?? 0.18;

  const usableHeight = Math.max(height - timeAxisHeight, 0);
  const volumePaneHeight = showVolume ? Math.round(usableHeight * ratio) : 0;
  const pricePaneHeight = usableHeight - volumePaneHeight;
  const paneX = 0;
  const paneWidth = Math.max(width - axisWidth, 0);

  return {
    width,
    height,
    axisWidth,
    timeAxisHeight,
    pricePane: { x: paneX, y: 0, width: paneWidth, height: pricePaneHeight },
    volumePane: {
      x: paneX,
      y: pricePaneHeight,
      width: paneWidth,
      height: volumePaneHeight,
    },
    axisPane: { x: paneWidth, y: 0, width: axisWidth, height: usableHeight },
    timeAxisPane: { x: 0, y: usableHeight, width, height: timeAxisHeight },
  };
}
