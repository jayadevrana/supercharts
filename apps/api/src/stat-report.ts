/**
 * Daily / weekly stat report — a scheduled rollup of alert activity + paper P&L, for a
 * web summary card and a Telegram digest.
 *
 * Pure builder: the route gathers windowed rows (fires by `fired_at`, closed paper trades
 * by `exit_time`) and hands them here. Everything is percentage-based / count-based —
 * paper trades carry no lot size, so this is return + activity attribution, not currency
 * P&L (stated in the digest).
 */
import { getCatalogSymbol, type MaCrossAlertConfig } from '@supercharts/types';
import { strategySignature } from './pnl-attribution';

export type ReportPeriod = 'daily' | 'weekly';

export interface ReportFire {
  side: 'buy' | 'sell';
  symbol: string;
}

export interface ReportClosed {
  alertId: string;
  pnlPercent: number;
}

export interface ReportAlertMeta {
  symbol: string;
  interval: string;
  config: MaCrossAlertConfig;
}

export interface StrategyLine {
  label: string;
  trades: number;
  realisedPct: number;
}

export interface StatReport {
  period: ReportPeriod;
  windowStart: number;
  windowEnd: number;
  fires: {
    total: number;
    buy: number;
    sell: number;
    topSymbols: Array<{ symbol: string; label: string; count: number }>;
  };
  paper: {
    closedTrades: number;
    wins: number;
    winRate: number;
    realisedPct: number;
    unrealizedPct: number;
    totalPct: number;
    avgPct: number;
  };
  best: StrategyLine[];
  worst: StrategyLine[];
  activeAlerts: number;
}

function symLabel(symbol: string): string {
  return getCatalogSymbol(symbol)?.label ?? (symbol.includes(':') ? symbol.split(':')[1]! : symbol);
}

export function buildStatReport(input: {
  period: ReportPeriod;
  windowStart: number;
  windowEnd: number;
  fires: ReadonlyArray<ReportFire>;
  closed: ReadonlyArray<ReportClosed>;
  meta: Map<string, ReportAlertMeta>;
  unrealizedPct: number;
  activeAlerts: number;
}): StatReport {
  const buy = input.fires.filter((f) => f.side === 'buy').length;
  const sell = input.fires.length - buy;

  const symCounts = new Map<string, number>();
  for (const f of input.fires) symCounts.set(f.symbol, (symCounts.get(f.symbol) ?? 0) + 1);
  const topSymbols = [...symCounts.entries()]
    .map(([symbol, count]) => ({ symbol, label: symLabel(symbol), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const realisedPct = input.closed.reduce((s, c) => s + c.pnlPercent, 0);
  const wins = input.closed.filter((c) => c.pnlPercent > 0).length;
  const closedTrades = input.closed.length;

  // Per-strategy-instance realised, for best/worst leaderboards.
  const byAlert = new Map<string, { realised: number; trades: number }>();
  for (const c of input.closed) {
    const agg = byAlert.get(c.alertId) ?? { realised: 0, trades: 0 };
    agg.realised += c.pnlPercent;
    agg.trades += 1;
    byAlert.set(c.alertId, agg);
  }
  const lines: StrategyLine[] = [...byAlert.entries()]
    .map(([alertId, agg]) => {
      const m = input.meta.get(alertId);
      const label = m ? `${symLabel(m.symbol)} ${m.interval} · ${strategySignature(m.config)}` : alertId;
      return { label, trades: agg.trades, realisedPct: agg.realised };
    })
    .sort((a, b) => b.realisedPct - a.realisedPct);
  const best = lines.filter((l) => l.realisedPct > 0).slice(0, 3);
  const worst = lines.filter((l) => l.realisedPct < 0).slice(-3).reverse();

  return {
    period: input.period,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    fires: { total: input.fires.length, buy, sell, topSymbols },
    paper: {
      closedTrades,
      wins,
      winRate: closedTrades > 0 ? wins / closedTrades : 0,
      realisedPct,
      unrealizedPct: input.unrealizedPct,
      totalPct: realisedPct + input.unrealizedPct,
      avgPct: closedTrades > 0 ? realisedPct / closedTrades : 0,
    },
    best,
    worst,
    activeAlerts: input.activeAlerts,
  };
}

function pct(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Format the report as a Telegram HTML digest. */
export function formatReportTelegram(r: StatReport): string {
  const d = new Date(r.windowEnd);
  const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const title = r.period === 'daily' ? '📊 Daily report' : '📊 Weekly report';
  const lines: string[] = [];
  lines.push(`<b>${title}</b> · ${stamp} UTC`);
  lines.push('');
  lines.push(`<b>Signals</b>: ${r.fires.total} fired (${r.fires.buy} buy / ${r.fires.sell} sell)`);
  if (r.fires.topSymbols.length) {
    lines.push('Most active: ' + r.fires.topSymbols.map((s) => `${esc(s.label)} ${s.count}`).join(', '));
  }
  lines.push('');
  lines.push(
    `<b>Paper P&amp;L</b>: ${pct(r.paper.totalPct)} (realised ${pct(r.paper.realisedPct)} · open ${pct(r.paper.unrealizedPct)})`,
  );
  lines.push(`Closed ${r.paper.closedTrades} · win ${(r.paper.winRate * 100).toFixed(0)}% · avg ${pct(r.paper.avgPct)}`);
  if (r.best.length) {
    lines.push('');
    lines.push('<b>Top</b>: ' + r.best.map((l) => `${esc(l.label)} ${pct(l.realisedPct)}`).join(' · '));
  }
  if (r.worst.length) {
    lines.push('<b>Bottom</b>: ' + r.worst.map((l) => `${esc(l.label)} ${pct(l.realisedPct)}`).join(' · '));
  }
  lines.push('');
  lines.push(`<i>${r.activeAlerts} active alerts · % return, equal-weight (paper)</i>`);
  return lines.join('\n');
}

/** Window [start,end) for a period ending at `now`. */
export function reportWindow(period: ReportPeriod, now: number): { windowStart: number; windowEnd: number } {
  const span = period === 'daily' ? 86_400_000 : 7 * 86_400_000;
  return { windowStart: now - span, windowEnd: now };
}
