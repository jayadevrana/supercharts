'use client';

import { useMemo } from 'react';
import type { Candle, IndicatorInstance } from '@supercharts/types';
import { computeAll, INDICATOR_LOOKUP } from '@supercharts/indicators';

interface Props {
  candles: Candle[];
  indicators: IndicatorInstance[];
  width: number;
}

export function SubPaneIndicators({ candles, indicators, width }: Props) {
  const visible = useMemo(
    () => indicators.filter((i) => i.visible && INDICATOR_LOOKUP[i.type]?.pane === 'sub'),
    [indicators],
  );
  if (visible.length === 0 || candles.length === 0) return null;
  return (
    <div className="border-t border-border/60 bg-surface/60">
      {visible.map((inst) => (
        <SubPaneRow key={inst.id} candles={candles} inst={inst} width={width} />
      ))}
    </div>
  );
}

function SubPaneRow({
  candles,
  inst,
  width,
}: {
  candles: Candle[];
  inst: IndicatorInstance;
  width: number;
}) {
  const spec = INDICATOR_LOOKUP[inst.type];
  const channels = useMemo(() => {
    const inputs = Object.fromEntries(
      (spec?.inputs ?? []).map((i) => [i.key, inst.inputs[i.key] ?? i.default]),
    );
    return computeAll(inst.type, candles, inputs);
  }, [candles, inst.type, inst.inputs, spec]);
  if (!spec) return null;

  const tail = candles.slice(-Math.min(candles.length, 200));
  const start = candles.length - tail.length;
  const HEIGHT = 80;

  // Compute Y scale across all channels.
  let min = Infinity;
  let max = -Infinity;
  for (const ch of spec.channels) {
    const arr = channels.get(ch);
    if (!arr) continue;
    for (let i = start; i < arr.length; i++) {
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
  const xScale = tail.length > 1 ? (width - 30) / (tail.length - 1) : 0;
  const yScale = (HEIGHT - 12) / (max - min);
  const yFor = (v: number): number => HEIGHT - 6 - (v - min) * yScale;
  const colorFor = (channel: string): string => {
    const k = channel === 'value' ? 'color' : `${channel}Color`;
    return String(inst.style[k] ?? spec.style[k] ?? spec.style.color ?? '#42a5f5');
  };

  return (
    <div className="px-2 py-1">
      <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>{spec.label}</span>
        <span className="tabular-nums">{paramsLabel(inst)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="block h-[80px] w-full">
        {hasBand(inst.type) ? <BandRefs inst={inst} spec={spec} yFor={yFor} width={width - 30} /> : null}
        {spec.channels.map((ch) => {
          const arr = channels.get(ch);
          if (!arr) return null;
          if (ch === 'histogram') {
            return (
              <g key={ch}>
                {tail.map((_c, i) => {
                  const v = arr[start + i];
                  if (v == null || Number.isNaN(v)) return null;
                  const x = i * xScale;
                  const zero = yFor(0);
                  const y = yFor(v);
                  const h = Math.abs(zero - y);
                  return (
                    <rect
                      key={i}
                      x={x}
                      y={Math.min(zero, y)}
                      width={Math.max(1, xScale - 1)}
                      height={Math.max(1, h)}
                      fill={v >= 0 ? String(inst.style.histogramPositive ?? spec.style.histogramPositive ?? '#26a69a') : String(inst.style.histogramNegative ?? spec.style.histogramNegative ?? '#ef5350')}
                      opacity={0.85}
                    />
                  );
                })}
              </g>
            );
          }
          const path = buildPath(tail, arr.slice(start), xScale, yFor);
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
        <text x={width - 28} y={12} className="fill-current text-[9px] text-muted-foreground" fontFamily="ui-monospace">{max.toFixed(2)}</text>
        <text x={width - 28} y={HEIGHT - 2} className="fill-current text-[9px] text-muted-foreground" fontFamily="ui-monospace">{min.toFixed(2)}</text>
      </svg>
    </div>
  );
}

function buildPath(
  tail: Candle[],
  values: number[],
  xScale: number,
  yFor: (v: number) => number,
): string {
  let d = '';
  let pen = false;
  for (let i = 0; i < tail.length; i++) {
    const v = values[i];
    if (v == null || Number.isNaN(v)) {
      pen = false;
      continue;
    }
    const x = i * xScale;
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
  spec: ReturnType<typeof getSpec>;
  yFor: (v: number) => number;
  width: number;
}) {
  if (!spec) return null;
  const upper = Number(inst.style.upperBand ?? spec.style.upperBand ?? NaN);
  const lower = Number(inst.style.lowerBand ?? spec.style.lowerBand ?? NaN);
  return (
    <g>
      {Number.isFinite(upper) ? (
        <line
          x1={0}
          x2={width}
          y1={yFor(upper)}
          y2={yFor(upper)}
          stroke="rgba(255,255,255,0.18)"
          strokeDasharray="2 2"
        />
      ) : null}
      {Number.isFinite(lower) ? (
        <line
          x1={0}
          x2={width}
          y1={yFor(lower)}
          y2={yFor(lower)}
          stroke="rgba(255,255,255,0.18)"
          strokeDasharray="2 2"
        />
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

function getSpec(type: string) {
  return INDICATOR_LOOKUP[type];
}
