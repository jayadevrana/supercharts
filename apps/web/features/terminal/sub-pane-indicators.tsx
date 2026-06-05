'use client';

import { useMemo } from 'react';
import type { Candle, IndicatorInstance } from '@supercharts/types';
import { computeAll, INDICATOR_LOOKUP, type IndicatorSpec } from '@supercharts/indicators';
import { formatIndicatorValue } from './indicator-legend-util';

/**
 * The chart's live time→x projection, mirrored from ChartCore.getTimeProjection(). Lets each
 * oscillator sub-pane plot a candle at the SAME x pixel the canvas uses, so the sub-panes share
 * the main chart's time axis, pan, and zoom (rather than the old fixed last-200-bar thumbnail).
 */
export interface SubPaneView {
  fromTime: number;
  toTime: number;
  rightTime: number;
  pxPerMs: number;
  /** Candle plotting width (excludes the right price-axis gutter). */
  plotWidth: number;
  /** Full canvas width — the SVG reserves totalWidth-plotWidth on the right for value labels. */
  totalWidth: number;
}

interface Props {
  candles: Candle[];
  indicators: IndicatorInstance[];
  view: SubPaneView | null;
  hoverTime: number | null;
}

const HEIGHT = 80;

export function SubPaneIndicators({ candles, indicators, view, hoverTime }: Props) {
  const visible = useMemo(
    () => indicators.filter((i) => i.visible && INDICATOR_LOOKUP[i.type]?.pane === 'sub'),
    [indicators],
  );
  if (visible.length === 0 || candles.length === 0 || !view || view.plotWidth <= 0 || view.pxPerMs <= 0) {
    return null;
  }
  return (
    <div className="border-t border-border/60 bg-surface/60">
      {visible.map((inst) => (
        <SubPaneRow key={inst.id} candles={candles} inst={inst} view={view} hoverTime={hoverTime} />
      ))}
    </div>
  );
}

const midOf = (c: Candle): number => (c.openTime + c.closeTime) / 2;

/** Index of the candle at/just-before `t` (binary search on openTime). -1 if before the first. */
function indexAtTime(candles: Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let res = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.openTime <= t) {
      res = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return res;
}

function SubPaneRow({
  candles,
  inst,
  view,
  hoverTime,
}: {
  candles: Candle[];
  inst: IndicatorInstance;
  view: SubPaneView;
  hoverTime: number | null;
}) {
  const spec = INDICATOR_LOOKUP[inst.type];
  const channels = useMemo(() => {
    const inputs = Object.fromEntries(
      (spec?.inputs ?? []).map((i) => [i.key, inst.inputs[i.key] ?? i.default]),
    );
    return computeAll(inst.type, candles, inputs);
  }, [candles, inst.type, inst.inputs, spec]);
  if (!spec) return null;

  const { fromTime, toTime, rightTime, pxPerMs, plotWidth, totalWidth } = view;
  const timeToX = (t: number): number => plotWidth - (rightTime - t) * pxPerMs;

  // Visible index window over the SHARED time axis (±1 candle of slack for line continuity).
  let i0 = candles.length;
  let i1 = -1;
  for (let i = 0; i < candles.length; i++) {
    const m = midOf(candles[i]!);
    if (m < fromTime || m > toTime) continue;
    if (i < i0) i0 = i;
    if (i > i1) i1 = i;
  }
  if (i1 < 0) {
    // Nothing in the window (panned off the data) — render an empty, labelled pane.
    return <EmptyRow spec={spec} inst={inst} />;
  }
  i0 = Math.max(0, i0 - 1);
  i1 = Math.min(candles.length - 1, i1 + 1);

  // Y scale across all channels within the visible window only (auto-scales like TradingView).
  let min = Infinity;
  let max = -Infinity;
  for (const ch of spec.channels) {
    const arr = channels.get(ch);
    if (!arr) continue;
    for (let i = i0; i <= i1; i++) {
      const v = arr[i];
      if (v == null || Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const yScale = (HEIGHT - 12) / (max - min);
  const yFor = (v: number): number => HEIGHT - 6 - (v - min) * yScale;
  const colorFor = (channel: string): string => {
    const k = channel === 'value' ? 'color' : `${channel}Color`;
    return String(inst.style[k] ?? spec.style[k] ?? spec.style.color ?? '#42a5f5');
  };

  const barDur = candles[i1]!.closeTime - candles[i1]!.openTime || 1;
  const barPx = Math.max(1, pxPerMs * barDur * 0.7);

  // Value at the crosshair candle (latest in-window when not hovering) for the pane header.
  const hoverIdx = hoverTime != null ? Math.min(Math.max(indexAtTime(candles, hoverTime), i0), i1) : i1;
  const primaryCh = spec.channels[0] ?? 'value';
  const hoverVal = channels.get(primaryCh)?.[hoverIdx];
  const crosshairX = hoverTime != null ? timeToX(hoverTime) : null;
  const showCrosshair = crosshairX != null && crosshairX >= 0 && crosshairX <= plotWidth;

  return (
    <div className="px-0 py-1">
      <div className="flex items-center justify-between px-2 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>{inst.name || spec.label}</span>
        <span className="tabular-nums">
          {paramsLabel(inst)}
          {hoverVal != null && Number.isFinite(hoverVal) ? (
            <span className="ml-2 normal-case text-foreground">{formatIndicatorValue(hoverVal)}</span>
          ) : null}
        </span>
      </div>
      <svg viewBox={`0 0 ${totalWidth} ${HEIGHT}`} className="block h-[80px] w-full" preserveAspectRatio="none">
        {hasBand(inst.type) ? <BandRefs inst={inst} spec={spec} yFor={yFor} width={plotWidth} /> : null}
        {showCrosshair ? (
          <line x1={crosshairX} x2={crosshairX} y1={0} y2={HEIGHT} stroke="rgba(255,255,255,0.22)" strokeWidth={1} />
        ) : null}
        {spec.channels.map((ch) => {
          const arr = channels.get(ch);
          if (!arr) return null;
          if (ch === 'histogram') {
            return (
              <g key={ch}>
                {rangeIndices(i0, i1).map((i) => {
                  const v = arr[i];
                  if (v == null || Number.isNaN(v)) return null;
                  const x = timeToX(midOf(candles[i]!));
                  const zero = yFor(0);
                  const y = yFor(v);
                  const h = Math.abs(zero - y);
                  return (
                    <rect
                      key={i}
                      x={x - barPx / 2}
                      y={Math.min(zero, y)}
                      width={barPx}
                      height={Math.max(1, h)}
                      fill={
                        v >= 0
                          ? String(inst.style.histogramPositive ?? spec.style.histogramPositive ?? '#26a69a')
                          : String(inst.style.histogramNegative ?? spec.style.histogramNegative ?? '#ef5350')
                      }
                      opacity={0.85}
                    />
                  );
                })}
              </g>
            );
          }
          const path = buildPath(candles, arr, i0, i1, timeToX, yFor);
          return (
            <path
              key={ch}
              d={path}
              fill="none"
              stroke={colorFor(ch)}
              strokeWidth={ch === spec.channels[0] ? 1.5 : 1}
            />
          );
        })}
        <text x={plotWidth + 4} y={11} className="fill-current text-[9px] text-muted-foreground" fontFamily="ui-monospace">
          {max.toFixed(precisionFor(max, min))}
        </text>
        <text x={plotWidth + 4} y={HEIGHT - 3} className="fill-current text-[9px] text-muted-foreground" fontFamily="ui-monospace">
          {min.toFixed(precisionFor(max, min))}
        </text>
      </svg>
    </div>
  );
}

function EmptyRow({ spec, inst }: { spec: IndicatorSpec | undefined; inst: IndicatorInstance }) {
  if (!spec) return null;
  return (
    <div className="px-2 py-1">
      <div className="flex items-center justify-between text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>{inst.name || spec.label}</span>
        <span className="tabular-nums">{paramsLabel(inst)}</span>
      </div>
      <div className="flex h-[72px] items-center justify-center text-[10px] text-muted-foreground/60">
        No data in view
      </div>
    </div>
  );
}

function rangeIndices(i0: number, i1: number): number[] {
  const out: number[] = [];
  for (let i = i0; i <= i1; i++) out.push(i);
  return out;
}

function precisionFor(max: number, min: number): number {
  const span = Math.abs(max - min);
  if (span >= 100) return 1;
  if (span >= 1) return 2;
  if (span >= 0.01) return 4;
  return 6;
}

function buildPath(
  candles: Candle[],
  values: number[],
  i0: number,
  i1: number,
  timeToX: (t: number) => number,
  yFor: (v: number) => number,
): string {
  let d = '';
  let pen = false;
  for (let i = i0; i <= i1; i++) {
    const v = values[i];
    if (v == null || Number.isNaN(v)) {
      pen = false;
      continue;
    }
    const x = timeToX(midOf(candles[i]!));
    const y = yFor(v);
    d += pen ? `L${x.toFixed(1)} ${y.toFixed(1)} ` : `M${x.toFixed(1)} ${y.toFixed(1)} `;
    pen = true;
  }
  return d;
}

function hasBand(type: string): boolean {
  return type === 'rsi' || type === 'stochastic' || type === 'williams_r' || type === 'cci' || type === 'mfi';
}

function BandRefs({
  inst,
  spec,
  yFor,
  width,
}: {
  inst: IndicatorInstance;
  spec: IndicatorSpec | undefined;
  yFor: (v: number) => number;
  width: number;
}) {
  if (!spec) return null;
  const upper = Number(inst.style.upperBand ?? spec.style.upperBand ?? NaN);
  const lower = Number(inst.style.lowerBand ?? spec.style.lowerBand ?? NaN);
  return (
    <g>
      {Number.isFinite(upper) ? (
        <line x1={0} x2={width} y1={yFor(upper)} y2={yFor(upper)} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 2" />
      ) : null}
      {Number.isFinite(lower) ? (
        <line x1={0} x2={width} y1={yFor(lower)} y2={yFor(lower)} stroke="rgba(255,255,255,0.18)" strokeDasharray="2 2" />
      ) : null}
    </g>
  );
}

function paramsLabel(inst: IndicatorInstance): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(inst.inputs)) {
    if (typeof v === 'number' || typeof v === 'string') parts.push(`${k}=${v}`);
  }
  return parts.slice(0, 3).join(' · ');
}
