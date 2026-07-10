/**
 * Market screener core — pure scan evaluation over per-symbol candle buffers.
 *
 * Reuses the exact machinery the alerts + MT5 runner already trust: metric columns come from
 * `@supercharts/indicators` (`computeIndicatorChannel`) and screen matching goes through
 * `signal-eval.ts` (`evaluateConditionSet`) — bit-for-bit the alert-engine semantics on the
 * last CLOSED bar. Never fabricates data: symbols without candles report `unavailable`,
 * short histories report `insufficient_data`, and a still-forming bar is trimmed first.
 */

import type { Candle, IndicatorInstance, Interval, SignalCondition, SignalConditionLogic } from '@supercharts/types';
import { INTERVAL_MS } from '@supercharts/types';
import { computeIndicatorChannel, setIndicatorMetadata } from '@supercharts/indicators/runner';
import { parse, interpret } from '@supercharts/script-lang';
import { collectIndicatorRefs, evaluateConditionSet } from './signal-eval';

/** A custom or preset screen — the same condition union alerts/recipes use. */
export interface ScanScreen {
  conditions: SignalCondition[];
  logic: SignalConditionLogic;
  /** Instance specs the conditions reference (user-tuned params); empty = registry defaults. */
  indicatorSpecs: IndicatorInstance[];
}

export interface ScanRequest {
  interval: Interval;
  screen: ScanScreen;
  /** Injected clock so closed-bar trimming is deterministic in tests. */
  now: number;
  /** Bars below this → `insufficient_data` (metric warmup ≈ EMA21/RSI14/RVOL20 + margin). */
  minBars?: number;
}

export type ScanRowStatus = 'ok' | 'insufficient_data' | 'unavailable' | 'script_error';

export interface ScanRow {
  symbol: string;
  status: ScanRowStatus;
  /** Closed bars the scan actually evaluated. */
  bars: number;
  /** Fixed metric columns (null = not computable at this index). Empty when status ≠ ok. */
  metrics: Record<string, number | null>;
  matched: boolean;
  /** Honest per-symbol failure detail (status === 'script_error'). */
  error?: string;
}

export interface ScanResult {
  rows: ScanRow[];
  matchedCount: number;
  total: number;
  interval: Interval;
  scannedAt: number;
}

const DEFAULT_MIN_BARS = 60;

/** Metric instances use scan-prefixed ids so they can never collide with user instance ids. */
const METRIC_SPECS: IndicatorInstance[] = [
  { id: '__scan_rsi', type: 'rsi', name: 'rsi', paneId: 'price', inputs: {}, style: {}, visible: true, locked: false },
  { id: '__scan_ema', type: 'ema', name: 'ema', paneId: 'price', inputs: { length: 21 }, style: {}, visible: true, locked: false },
  { id: '__scan_atr', type: 'atr', name: 'atr', paneId: 'price', inputs: {}, style: {}, visible: true, locked: false },
  { id: '__scan_rvol', type: 'rvol', name: 'rvol', paneId: 'price', inputs: {}, style: {}, visible: true, locked: false },
];
const METRIC_REFS = METRIC_SPECS.map((s) => ({ id: s.id, channel: 'value' }));

const finite = (v: number | undefined): number | null =>
  v !== undefined && Number.isFinite(v) ? v : null;

/** Trim a still-forming last bar so scan semantics match the closed-bar alert engine. */
export function closedBars(candles: readonly Candle[], now: number): Candle[] {
  if (candles.length === 0) return [];
  const last = candles[candles.length - 1]!;
  return last.closeTime > now ? candles.slice(0, -1) : candles.slice();
}

/** Fixed metric columns for one symbol — scan-owned instance ids so user ids can never clash. */
function computeMetrics(bars: readonly Candle[], changeLookback: number, extraSpecs: IndicatorInstance[]): Record<string, number | null> {
  setIndicatorMetadata([...METRIC_SPECS, ...extraSpecs]);
  const ind = computeIndicatorChannel(bars as Candle[], METRIC_REFS);
  const i = bars.length - 1;
  const last = bars[i]!;
  const back = bars[Math.max(0, i - changeLookback)]!;
  const emaV = finite(ind.get('__scan_ema.value')?.[i]);
  const atrV = finite(ind.get('__scan_atr.value')?.[i]);
  return {
    close: last.close,
    changePct: back.close !== 0 ? ((last.close - back.close) / back.close) * 100 : null,
    volume: last.volume,
    rsi: finite(ind.get('__scan_rsi.value')?.[i]),
    emaDistPct: emaV !== null && emaV !== 0 ? ((last.close - emaV) / emaV) * 100 : null,
    atrPct: atrV !== null && last.close !== 0 ? (atrV / last.close) * 100 : null,
    rvol: finite(ind.get('__scan_rvol.value')?.[i]),
  };
}

/**
 * Evaluate one screen across per-symbol candle buffers. Pure aside from the indicator runner's
 * process-wide metadata slot, which is set synchronously before every synchronous compute
 * (single-threaded — no interleaving with the alert engine's own evaluate calls).
 */
export function runScan(candlesBySymbol: Map<string, readonly Candle[]>, req: ScanRequest): ScanResult {
  const minBars = req.minBars ?? DEFAULT_MIN_BARS;
  const stepMs = INTERVAL_MS[req.interval] || 60_000;
  // % change lookback: ~24h of bars on intraday intervals, 1 bar on 1d and slower.
  const changeLookback = Math.max(1, Math.min(1440, Math.round(86_400_000 / stepMs)));
  const screenRefs = collectIndicatorRefs(req.screen.conditions);

  const rows: ScanRow[] = [];
  for (const [symbol, raw] of candlesBySymbol) {
    const bars = closedBars(raw, req.now);
    if (bars.length === 0) {
      rows.push({ symbol, status: 'unavailable', bars: 0, metrics: {}, matched: false });
      continue;
    }
    if (bars.length < minBars) {
      rows.push({ symbol, status: 'insufficient_data', bars: bars.length, metrics: {}, matched: false });
      continue;
    }

    const metrics = computeMetrics(bars, changeLookback, req.screen.indicatorSpecs);

    // Screen match — the exact evaluator alerts and the MT5 runner use.
    const matched =
      req.screen.conditions.length === 0
        ? true // no conditions = a pure metrics table; every scanned row "matches"
        : evaluateConditionSet(
            req.screen.conditions,
            req.screen.logic,
            bars as Candle[],
            screenRefs,
            req.screen.indicatorSpecs,
          );

    rows.push({ symbol, status: 'ok', bars: bars.length, metrics, matched });
  }

  return {
    rows,
    matchedCount: rows.filter((r) => r.matched).length,
    total: rows.length,
    interval: req.interval,
    scannedAt: req.now,
  };
}

export interface ScriptScanRequest {
  interval: Interval;
  now: number;
  minBars?: number;
  /** Per-symbol execution budget — scans run the script up to N× per request. Default 500ms. */
  timeoutMs?: number;
}

/**
 * PulseScript-powered scan (M2/SCAN-4): run one script over every symbol's closed bars;
 * a symbol MATCHES when the script raises a mark or `alert()` on the LAST closed bar
 * (no-repaint semantics — historical signals don't count). The source is parsed ONCE
 * (a syntax error fails the whole request loudly); runtime errors are isolated per
 * symbol and reported as `script_error` rows, never hidden.
 */
export function runScriptScan(candlesBySymbol: Map<string, readonly Candle[]>, source: string, req: ScriptScanRequest): ScanResult {
  const minBars = req.minBars ?? DEFAULT_MIN_BARS;
  const stepMs = INTERVAL_MS[req.interval] || 60_000;
  const changeLookback = Math.max(1, Math.min(1440, Math.round(86_400_000 / stepMs)));
  const program = parse(source); // throws ParseError with line/col — 400 at the route

  const rows: ScanRow[] = [];
  for (const [symbol, raw] of candlesBySymbol) {
    const bars = closedBars(raw, req.now);
    if (bars.length === 0) {
      rows.push({ symbol, status: 'unavailable', bars: 0, metrics: {}, matched: false });
      continue;
    }
    if (bars.length < minBars) {
      rows.push({ symbol, status: 'insufficient_data', bars: bars.length, metrics: {}, matched: false });
      continue;
    }
    const metrics = computeMetrics(bars, changeLookback, []);
    try {
      const res = interpret(program, bars as Candle[], { interval: req.interval, timeoutMs: req.timeoutMs ?? 500 });
      const lastBar = bars.length - 1;
      const matched =
        res.marks.some((m) => m.bar === lastBar) || res.alerts.some((a) => a.bar === lastBar);
      rows.push({ symbol, status: 'ok', bars: bars.length, metrics, matched });
    } catch (err) {
      rows.push({
        symbol,
        status: 'script_error',
        bars: bars.length,
        metrics,
        matched: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    rows,
    matchedCount: rows.filter((r) => r.matched).length,
    total: rows.length,
    interval: req.interval,
    scannedAt: req.now,
  };
}
