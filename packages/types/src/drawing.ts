/**
 * Drawing object model. Everything a user draws on a chart serializes to a DrawingObject.
 */

export type DrawingType =
  | 'trend_line'
  | 'ray'
  | 'extended_line'
  | 'horizontal_line'
  | 'vertical_line'
  | 'cross_line'
  | 'parallel_channel'
  | 'regression_channel'
  | 'rectangle'
  | 'rotated_rectangle'
  | 'ellipse'
  | 'circle'
  | 'triangle'
  | 'polygon'
  | 'freehand'
  | 'arrow'
  | 'double_arrow'
  | 'text'
  | 'callout'
  | 'price_note'
  | 'emoji'
  | 'icon_marker'
  | 'image_marker'
  | 'table'
  | 'risk_reward_long'
  | 'risk_reward_short'
  | 'date_range'
  | 'price_range'
  | 'ruler'
  | 'fib_retracement'
  | 'fib_extension'
  | 'fib_channel'
  | 'fib_time_zones'
  | 'gann_box'
  | 'gann_fan'
  | 'pitchfork'
  | 'anchored_vwap'
  | 'anchored_volume_profile';

/** A chart-space point: a logical time + a price. */
export interface ChartPoint {
  time: number;
  price: number;
}

export interface DrawingStyle {
  strokeColor: string;
  strokeWidth: number;
  /** css-style dash array, e.g. "4 2" or "" for solid */
  strokeDash?: string;
  fillColor?: string;
  fillOpacity?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  textColor?: string;
  textAlign?: 'left' | 'center' | 'right';
  arrowSize?: number;
  cornerRadius?: number;
}

export interface DrawingTableCell {
  row: number;
  col: number;
  text: string;
  bold?: boolean;
  color?: string;
  backgroundColor?: string;
}

export interface DrawingTablePayload {
  rows: number;
  cols: number;
  cells: DrawingTableCell[];
  headerRow: boolean;
  headerCol: boolean;
}

export interface DrawingRiskRewardPayload {
  entry: number;
  stop: number;
  target: number;
  quantity?: number;
  accountSize?: number;
  riskPercent?: number;
}

export interface DrawingFibPayload {
  levels: number[];
  showLabels: boolean;
  showPrices: boolean;
}

/**
 * Discriminator: `points` carry the geometry, `payload` carries type-specific data.
 * Adapters should switch on `type` to render.
 */
export interface DrawingObject {
  id: string;
  userId: string;
  layoutId?: string;
  symbol: string;
  type: DrawingType;
  points: ChartPoint[];
  style: DrawingStyle;
  text?: string;
  emoji?: string;
  iconName?: string;
  table?: DrawingTablePayload;
  riskReward?: DrawingRiskRewardPayload;
  fib?: DrawingFibPayload;
  locked: boolean;
  visible: boolean;
  zIndex: number;
  groupId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DrawingTemplate {
  id: string;
  userId: string;
  name: string;
  type: DrawingType;
  style: DrawingStyle;
}
