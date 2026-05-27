'use client';

import type { SignalsTrendScoreFrame } from '@supercharts/chart-core';
import { cn } from '@/lib/cn';

export interface MtfRow {
  /** Display label like `5`, `15`, `60`, `D`. */
  label: string;
  trendDir: 1 | -1 | null;
  bullScore: number;
  bearScore: number;
  rsi: number;
}

export interface StsDashboardProps {
  /** Frame containing the per-bar series + last scalars for the current pane. */
  frame: SignalsTrendScoreFrame;
  /** Multi-timeframe rows for the top-right dashboard, in display order. */
  mtfRows: MtfRow[];
  /** Per-TF labels for the bottom strip. Must align with `mtfRows`. */
  bottomTfLabels?: string[];
  /** Bullish score display toggle (overall, top-right TS row). */
  showBullScore?: boolean;
  /** Bearish score display toggle. */
  showBearScore?: boolean;
  /** When false, the bottom strip is hidden. */
  showBottomStrip?: boolean;
}

const TF_ICON_COLOR_BULL = 'text-bull';
const TF_ICON_COLOR_BEAR = 'text-bear';

export function StsDashboard({
  frame,
  mtfRows,
  bottomTfLabels = mtfRows.map((r) => r.label),
  showBullScore = true,
  showBearScore = true,
  showBottomStrip = true,
}: StsDashboardProps) {
  const last = frame.last;
  return (
    <div className="pointer-events-none absolute inset-0">
      <TopRightDashboard rows={mtfRows} showBullScore={showBullScore} showBearScore={showBearScore} />
      {showBottomStrip ? (
        <BottomStrip frame={frame} last={last} bottomTfLabels={bottomTfLabels} mtfRows={mtfRows} />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Top-right: TF / Signal / TS table
// -----------------------------------------------------------------------------

function TopRightDashboard({
  rows,
  showBullScore,
  showBearScore,
}: {
  rows: MtfRow[];
  showBullScore: boolean;
  showBearScore: boolean;
}) {
  const cols = rows.length;
  if (cols === 0) return null;
  return (
    <div
      className="pointer-events-auto absolute right-3 top-3 grid overflow-hidden rounded-md border border-border/80 bg-surface-raised/95 text-[10px] shadow-floating backdrop-blur"
      style={{ gridTemplateColumns: `auto repeat(${cols}, minmax(54px, 1fr))` }}
    >
      <Cell head>TF</Cell>
      {rows.map((r) => (
        <Cell head key={`tf-${r.label}`}>{r.label}</Cell>
      ))}
      <Cell head>Signal</Cell>
      {rows.map((r) => (
        <Cell
          key={`sig-${r.label}`}
          tone={r.trendDir == null ? 'muted' : r.trendDir > 0 ? 'bull' : 'bear'}
        >
          {r.trendDir == null ? '—' : r.trendDir > 0 ? 'Buy' : 'Sell'}
        </Cell>
      ))}
      <Cell head>TS</Cell>
      {rows.map((r) => {
        if (r.trendDir == null) return <Cell key={`ts-${r.label}`} tone="muted">—</Cell>;
        const bull = r.trendDir > 0;
        const score = bull ? r.bullScore : r.bearScore;
        const show = bull ? showBullScore : showBearScore;
        return (
          <Cell key={`ts-${r.label}`} tone={bull ? 'bull' : 'bear'}>
            {show ? `${bull ? 'Bull' : 'Bear'} ${score}/5` : bull ? 'Bull' : 'Bear'}
          </Cell>
        );
      })}
    </div>
  );
}

function Cell({
  children,
  head,
  tone = 'default',
}: {
  children: React.ReactNode;
  head?: boolean;
  tone?: 'default' | 'bull' | 'bear' | 'muted';
}) {
  const toneCls =
    tone === 'bull'
      ? 'text-bull bg-bull/10'
      : tone === 'bear'
        ? 'text-bear bg-bear/10'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground';
  return (
    <div
      className={cn(
        'flex items-center justify-center border-b border-r border-border/60 px-2.5 py-1 tabular-nums',
        head ? 'bg-surface text-foreground font-semibold uppercase tracking-[0.14em]' : toneCls,
      )}
    >
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Bottom strip: Timeframe / 5/15/30/60/D / VWAP / ATR / ADX / Supertrend /
// Daily Buy% / Daily Sell% / Lookback Buy% / Lookback Sell% / ATR Range bar
// -----------------------------------------------------------------------------

function BottomStrip({
  frame,
  last,
  bottomTfLabels,
  mtfRows,
}: {
  frame: SignalsTrendScoreFrame;
  last: SignalsTrendScoreFrame['last'];
  bottomTfLabels: string[];
  mtfRows: MtfRow[];
}) {
  const rsiByLabel = new Map(mtfRows.map((r) => [r.label, r.rsi]));
  return (
    <div className="pointer-events-auto absolute bottom-2 left-1/2 -translate-x-1/2 overflow-hidden rounded-md border border-border/80 bg-surface-raised/95 text-[10px] shadow-floating backdrop-blur">
      <div className="grid grid-flow-col auto-cols-max text-foreground">
        <Header>Timeframe</Header>
        {bottomTfLabels.map((l) => (
          <Header key={`th-${l}`}>{l}</Header>
        ))}
        <Header>VWAP</Header>
        <Header>ATR</Header>
        <Header>ADX</Header>
        <Header>Supertrend</Header>
        <Header>Daily Buy %</Header>
        <Header>Daily Sell %</Header>
        <Header>Lookback Buy %</Header>
        <Header>Lookback Sell %</Header>
        <Header>ATR Range</Header>
      </div>
      <div className="grid grid-flow-col auto-cols-max">
        <Value head>RSI</Value>
        {bottomTfLabels.map((l) => (
          <RsiCell key={`rsi-${l}`} value={rsiByLabel.get(l) ?? NaN} />
        ))}
        <Value tone={last.vwapUp ? 'bull' : 'bear'} bg={last.vwapUp ? 'bg-bull/15' : 'bg-bear/15'}>
          {last.vwapUp ? 'UP' : 'DOWN'}
        </Value>
        <Value bg="bg-warn/15" tone="warn">
          {fmt(last.atr, 2)}
        </Value>
        <Value tone={last.stDir < 0 ? 'bull' : 'bear'} bg={last.stDir < 0 ? 'bg-bull/15' : 'bg-bear/15'}>
          {fmt(last.adx, 1)} {last.adxRising ? '▲' : '▼'}
        </Value>
        <Value tone={last.stDir < 0 ? 'bull' : 'bear'} bg={last.stDir < 0 ? 'bg-bull/15' : 'bg-bear/15'}>
          {last.stDir < 0 ? 'UP ▲' : 'DOWN ▼'}
        </Value>
        <Value tone="bull" bg="bg-bull/15">{fmt(last.dailyBuyPct, 1)} %</Value>
        <Value tone="bear" bg="bg-bear/15">{fmt(last.dailySellPct, 1)} %</Value>
        <Value tone="bull" bg="bg-bull/10">{fmt(last.lookbackBuyPct, 1)} %</Value>
        <Value tone="bear" bg="bg-bear/10">{fmt(last.lookbackSellPct, 1)} %</Value>
        <Value>
          <span className="font-mono tracking-tight text-accent">{miniBar(last.atrRangePct)}</span>{' '}
          <span className="tabular-nums">{fmt(last.atrRangePct, 0)}%</span>
        </Value>
      </div>
    </div>
  );
}

function Header({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-r border-border/60 bg-surface px-2.5 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground">
      {children}
    </div>
  );
}

function Value({
  children,
  head,
  tone,
  bg,
}: {
  children: React.ReactNode;
  head?: boolean;
  tone?: 'bull' | 'bear' | 'warn';
  bg?: string;
}) {
  const toneCls = tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : tone === 'warn' ? 'text-warn' : 'text-foreground';
  return (
    <div
      className={cn(
        'border-r border-border/60 px-2.5 py-1 text-center tabular-nums',
        head ? 'bg-surface font-semibold uppercase tracking-[0.12em] text-foreground' : toneCls,
        bg,
      )}
    >
      {children}
    </div>
  );
}

function RsiCell({ value }: { value: number }) {
  if (!Number.isFinite(value)) {
    return <Value tone="warn">—</Value>;
  }
  const tone: 'bull' | 'bear' | undefined = value > 55 ? 'bull' : value < 45 ? 'bear' : undefined;
  const bg = tone === 'bull' ? 'bg-bull/15' : tone === 'bear' ? 'bg-bear/15' : 'bg-accent/10';
  return (
    <div className={cn('border-r border-border/60 px-2.5 py-1 text-center tabular-nums', bg, tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : 'text-accent')}>
      {value.toFixed(2)}
    </div>
  );
}

function miniBar(pct: number): string {
  const filled = Math.round(Math.min(Math.max(pct, 0), 100) / 10);
  let b = '';
  for (let i = 0; i < 10; i += 1) b += i < filled ? '▰' : '▱';
  return b;
}

function fmt(v: number, decimals: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(decimals);
}
