/**
 * Per-strategy P&L attribution.
 *
 * Answers "which recipes actually earn?" by rolling the paper-trade book up three ways:
 *   - per alert (a strategy *instance*: this MA config on this symbol+interval),
 *   - per strategy *signature* (the same MA/RSI recipe across every symbol it runs on),
 *   - per asset class.
 *
 * Realised P&L = sum of closed-trade pnl_percent. Open P&L = mark-to-market unrealized
 * (computed by the caller via markRow, passed in). Everything is percentage-based and
 * equal-weight per trade — paper_trades carry no lot size, so this is return attribution,
 * not currency P&L. Stated honestly in the UI.
 */
import { getCatalogSymbol, CATEGORY_LABEL, type MaCrossAlertConfig, type SymbolCategory } from '@supercharts/types';

export interface ClosedTradeLite {
  alertId: string;
  pnlPercent: number;
}

export interface OpenTradeLite {
  alertId: string;
  side: 'buy' | 'sell';
  unrealizedPct: number;
}

export interface AlertMeta {
  symbol: string;
  interval: string;
  config: MaCrossAlertConfig;
}

export interface AttributionRow {
  alertId: string;
  symbol: string;
  label: string;
  signature: string;
  interval: string;
  category: string;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  realisedPct: number;
  unrealizedPct: number;
  totalPct: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number | null;
  bestPct: number;
  worstPct: number;
  openSide?: 'buy' | 'sell';
}

export interface AttributionRollup {
  key: string;
  label: string;
  closedTrades: number;
  wins: number;
  winRate: number;
  realisedPct: number;
  unrealizedPct: number;
  totalPct: number;
}

export interface PnlAttribution {
  rows: AttributionRow[];
  byStrategy: AttributionRollup[];
  byCategory: AttributionRollup[];
  totals: {
    closedTrades: number;
    wins: number;
    winRate: number;
    realisedPct: number;
    unrealizedPct: number;
    totalPct: number;
    openPositions: number;
    strategies: number;
    bestRow?: { label: string; totalPct: number };
    worstRow?: { label: string; totalPct: number };
  };
}

/** Human label for an MA-cross recipe, symbol-agnostic. */
export function strategySignature(config: MaCrossAlertConfig): string {
  const ma = `${config.ma.type.toUpperCase()}(${config.ma.length})`;
  const leg = config.crossWith
    ? `${ma} × ${config.crossWith.type.toUpperCase()}(${config.crossWith.length})`
    : `${ma} × price`;
  const rsi = config.rsiFilter ? ` +RSI(${config.rsiFilter.length})` : '';
  return `${leg}${rsi}`;
}

function pctOrZero(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

export function buildAttribution(
  closed: ReadonlyArray<ClosedTradeLite>,
  open: ReadonlyArray<OpenTradeLite>,
  meta: Map<string, AlertMeta>,
): PnlAttribution {
  // Group closed pnl + open unrealized by alert.
  const closedByAlert = new Map<string, number[]>();
  for (const t of closed) {
    const arr = closedByAlert.get(t.alertId) ?? [];
    arr.push(t.pnlPercent);
    closedByAlert.set(t.alertId, arr);
  }
  const openByAlert = new Map<string, OpenTradeLite>();
  for (const o of open) openByAlert.set(o.alertId, o);

  // Every alert that has any closed or open trade gets a row.
  const alertIds = new Set<string>([...closedByAlert.keys(), ...openByAlert.keys()]);

  const rows: AttributionRow[] = [];
  for (const alertId of alertIds) {
    const m = meta.get(alertId);
    if (!m) continue;
    const pnls = closedByAlert.get(alertId) ?? [];
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p <= 0);
    const grossWin = wins.reduce((s, p) => s + p, 0);
    const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
    const realisedPct = pnls.reduce((s, p) => s + p, 0);
    const op = openByAlert.get(alertId);
    const unrealizedPct = op ? pctOrZero(op.unrealizedPct) : 0;
    const sig = strategySignature(m.config);
    const symLabel = getCatalogSymbol(m.symbol)?.label ?? (m.symbol.includes(':') ? m.symbol.split(':')[1]! : m.symbol);
    rows.push({
      alertId,
      symbol: m.symbol,
      label: `${symLabel} · ${m.interval}`,
      signature: sig,
      interval: m.interval,
      category: (getCatalogSymbol(m.symbol)?.category ?? 'crypto') as SymbolCategory,
      closedTrades: pnls.length,
      wins: wins.length,
      losses: losses.length,
      winRate: pnls.length > 0 ? wins.length / pnls.length : 0,
      realisedPct,
      unrealizedPct,
      totalPct: realisedPct + unrealizedPct,
      avgWinPct: wins.length > 0 ? grossWin / wins.length : 0,
      avgLossPct: losses.length > 0 ? -grossLoss / losses.length : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
      bestPct: pnls.length > 0 ? Math.max(...pnls) : 0,
      worstPct: pnls.length > 0 ? Math.min(...pnls) : 0,
      openSide: op?.side,
    });
  }

  rows.sort((a, b) => b.totalPct - a.totalPct);

  // Rollups.
  const rollup = (keyOf: (r: AttributionRow) => { key: string; label: string }): AttributionRollup[] => {
    const map = new Map<string, AttributionRollup>();
    for (const r of rows) {
      const { key, label } = keyOf(r);
      let agg = map.get(key);
      if (!agg) {
        agg = { key, label, closedTrades: 0, wins: 0, winRate: 0, realisedPct: 0, unrealizedPct: 0, totalPct: 0 };
        map.set(key, agg);
      }
      agg.closedTrades += r.closedTrades;
      agg.wins += r.wins;
      agg.realisedPct += r.realisedPct;
      agg.unrealizedPct += r.unrealizedPct;
      agg.totalPct += r.totalPct;
    }
    for (const agg of map.values()) agg.winRate = agg.closedTrades > 0 ? agg.wins / agg.closedTrades : 0;
    return [...map.values()].sort((a, b) => b.totalPct - a.totalPct);
  };

  const byStrategy = rollup((r) => ({ key: r.signature, label: r.signature }));
  const byCategory = rollup((r) => ({
    key: r.category,
    label: CATEGORY_LABEL[r.category as SymbolCategory] ?? r.category,
  }));

  const closedTrades = rows.reduce((s, r) => s + r.closedTrades, 0);
  const wins = rows.reduce((s, r) => s + r.wins, 0);
  const realisedPct = rows.reduce((s, r) => s + r.realisedPct, 0);
  const unrealizedPct = rows.reduce((s, r) => s + r.unrealizedPct, 0);

  return {
    rows,
    byStrategy,
    byCategory,
    totals: {
      closedTrades,
      wins,
      winRate: closedTrades > 0 ? wins / closedTrades : 0,
      realisedPct,
      unrealizedPct,
      totalPct: realisedPct + unrealizedPct,
      openPositions: open.length,
      strategies: byStrategy.length,
      bestRow: rows.length > 0 ? { label: rows[0]!.label, totalPct: rows[0]!.totalPct } : undefined,
      worstRow: rows.length > 0 ? { label: rows[rows.length - 1]!.label, totalPct: rows[rows.length - 1]!.totalPct } : undefined,
    },
  };
}
