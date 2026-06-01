'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Search } from 'lucide-react';
import { INDICATOR_LOOKUP, type IndicatorSpec } from '@supercharts/indicators';
import type { IndicatorInstance } from '@supercharts/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useTerminalStore, type PaneState } from './terminal-store';
import { nanoid } from './nanoid';

/**
 * Unified "Indicators" dialog (TradingView-style). A fresh chart is blank; the trader
 * opens this and toggles indicators on/off. It surfaces all three indicator systems in
 * one categorised, searchable list:
 *   - boolean overlays (pane.overlays.*)
 *   - SMC / order-flow flags (pane.smc.*)
 *   - classic TA from the registry (pane.classicIndicators[])
 *
 * Order-flow indicators need live trade/order-book data, which only the Binance (crypto)
 * feed supplies — on FX/metals/indices (Yahoo) they're flagged "needs order-flow data"
 * and render empty rather than fabricating anything.
 */

type Entry =
  | { kind: 'overlay'; key: keyof PaneState['overlays']; label: string; desc: string; orderflow?: boolean }
  | { kind: 'smc'; key: keyof PaneState['smc']; label: string; desc: string; orderflow?: boolean }
  | { kind: 'classic'; type: string; label: string; desc: string };

interface Group {
  group: string;
  items: Entry[];
}

const CATALOG: Group[] = [
  {
    group: 'Volume & Profile',
    items: [
      { kind: 'overlay', key: 'volume', label: 'Volume', desc: 'Per-bar volume histogram.' },
      { kind: 'overlay', key: 'profile', label: 'Volume Profile (VPVR)', desc: 'Volume traded at each price · POC / VAH / VAL.' },
      { kind: 'overlay', key: 'marketProfile', label: 'Market Profile (TPO)', desc: 'Per-session time-at-price histogram · POC + value area.' },
      { kind: 'overlay', key: 'heatmap', label: 'Liquidity Heatmap', desc: 'Resting order-book liquidity over time.', orderflow: true },
      { kind: 'smc', key: 'hvnLvn', label: 'HVN / LVN nodes', desc: 'High / low volume nodes.' },
      { kind: 'classic', type: 'vwap', label: 'VWAP', desc: 'Volume-weighted average price (session).' },
      { kind: 'classic', type: 'obv', label: 'On-Balance Volume', desc: 'Cumulative volume flow.' },
      { kind: 'classic', type: 'cmf', label: 'Chaikin Money Flow', desc: 'Money-flow over a period.' },
      { kind: 'classic', type: 'mfi', label: 'Money Flow Index', desc: 'Volume-weighted RSI.' },
      { kind: 'classic', type: 'rvol', label: 'Relative Volume (RVOL)', desc: 'Bar volume vs the average of prior bars. >1 = above-average.' },
      { kind: 'classic', type: 'initial_balance', label: 'Initial Balance', desc: 'First-hour session high/low range, drawn as reference levels.' },
      { kind: 'classic', type: 'naked_poc', label: 'Naked POC', desc: 'Untouched prior-session volume POCs (virgin points of control).' },
    ],
  },
  {
    group: 'Order Flow & Delta',
    items: [
      { kind: 'overlay', key: 'footprint', label: 'Footprint / Cluster', desc: 'Bid × ask volume per price cell.', orderflow: true },
      { kind: 'overlay', key: 'deepTrades', label: 'Delta Bubbles', desc: 'Per-trade aggressive-flow bubbles.', orderflow: true },
      { kind: 'smc', key: 'cvdDivergence', label: 'CVD + Delta Divergence', desc: 'Cumulative volume delta + price/delta divergence.', orderflow: true },
      { kind: 'overlay', key: 'timeAndSales', label: 'Time & Sales', desc: 'Live trade-by-trade tape (price · size · side).', orderflow: true },
      { kind: 'overlay', key: 'domLadder', label: 'DOM Ladder', desc: 'Live depth-of-market — top bid/ask sizes per price.', orderflow: true },
    ],
  },
  {
    group: 'Smart Money (SMC)',
    items: [
      { kind: 'smc', key: 'fvg', label: 'Fair Value Gaps', desc: 'Price imbalances / gaps.' },
      { kind: 'smc', key: 'orderBlocks', label: 'Order Blocks', desc: 'Institutional order-block zones.' },
      { kind: 'smc', key: 'liquidity', label: 'Liquidity Pools', desc: 'Equal highs/lows liquidity.' },
      { kind: 'smc', key: 'liquiditySweeps', label: 'Liquidity Sweeps', desc: 'Stop-run / sweep markers.' },
      { kind: 'smc', key: 'marketStructure', label: 'Market Structure (BOS/CHoCH)', desc: 'Break of structure / change of character.' },
      { kind: 'smc', key: 'premiumDiscount', label: 'Premium / Discount', desc: 'Dealing-range premium/discount zones.' },
      { kind: 'smc', key: 'anchoredVwap', label: 'Anchored VWAP', desc: 'VWAP anchored to a swing.' },
      { kind: 'smc', key: 'sessions', label: 'Sessions', desc: 'Asia / London / NY session boxes.' },
      { kind: 'smc', key: 'regimeBadge', label: 'Regime Badge', desc: 'Trend / range regime classifier.' },
    ],
  },
  {
    group: 'Signals',
    items: [
      { kind: 'overlay', key: 'signalsTrendScore', label: 'Signals & Trend Score', desc: 'MA cloud + ATR trail + buy/sell + MTF dashboards.' },
    ],
  },
  {
    group: 'Moving Averages',
    items: [
      { kind: 'classic', type: 'sma', label: 'Simple MA', desc: 'Simple moving average.' },
      { kind: 'classic', type: 'ema', label: 'Exponential MA', desc: 'Exponential moving average.' },
      { kind: 'classic', type: 'wma', label: 'Weighted MA', desc: 'Weighted moving average.' },
      { kind: 'classic', type: 'hma', label: 'Hull MA', desc: 'Hull moving average.' },
    ],
  },
  {
    group: 'Bands & Channels',
    items: [
      { kind: 'classic', type: 'bollinger', label: 'Bollinger Bands', desc: 'SMA ± n·σ bands.' },
      { kind: 'classic', type: 'vwap_bands', label: 'VWAP Bands (σ)', desc: 'Session VWAP with ±σ standard-deviation bands.' },
      { kind: 'classic', type: 'keltner', label: 'Keltner Channels', desc: 'EMA ± ATR channels.' },
      { kind: 'classic', type: 'donchian', label: 'Donchian Channels', desc: 'N-bar high/low channel.' },
    ],
  },
  {
    group: 'Oscillators',
    items: [
      { kind: 'classic', type: 'rsi', label: 'RSI', desc: 'Relative strength index.' },
      { kind: 'classic', type: 'macd', label: 'MACD', desc: 'Moving-average convergence/divergence.' },
      { kind: 'classic', type: 'stochastic', label: 'Stochastic', desc: '%K / %D oscillator.' },
      { kind: 'classic', type: 'williams_r', label: 'Williams %R', desc: 'Momentum oscillator.' },
      { kind: 'classic', type: 'cci', label: 'CCI', desc: 'Commodity channel index.' },
      { kind: 'classic', type: 'roc', label: 'Rate of Change', desc: 'Momentum / ROC.' },
      { kind: 'classic', type: 'aroon', label: 'Aroon', desc: 'Trend-strength oscillator.' },
      { kind: 'classic', type: 'volume_oscillator', label: 'Volume Oscillator', desc: 'Fast/slow volume-MA spread.' },
    ],
  },
  {
    group: 'Trend & Volatility',
    items: [
      { kind: 'classic', type: 'supertrend', label: 'Supertrend', desc: 'ATR-based trend follower.' },
      { kind: 'classic', type: 'psar', label: 'Parabolic SAR', desc: 'Stop-and-reverse dots.' },
      { kind: 'classic', type: 'ichimoku', label: 'Ichimoku Cloud', desc: 'Full Ichimoku system.' },
      { kind: 'classic', type: 'adx', label: 'ADX / DMI', desc: 'Directional movement / trend strength.' },
      { kind: 'classic', type: 'atr', label: 'Average True Range', desc: 'Volatility (ATR).' },
    ],
  },
];

function buildInstance(spec: IndicatorSpec): IndicatorInstance {
  return {
    id: `${spec.type}_${nanoid().slice(0, 6)}`,
    type: spec.type,
    name: spec.label,
    paneId: spec.pane === 'overlay' ? 'price' : spec.type,
    inputs: Object.fromEntries(spec.inputs.map((i) => [i.key, i.default])) as IndicatorInstance['inputs'],
    style: { ...spec.style },
    visible: true,
    locked: false,
  };
}

export function IndicatorsDialog() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // Chrome aggressively autofills the search field on open (Radix auto-focuses it),
  // dumping the user's email in and filtering the list to nothing. Hold the input
  // readOnly for a beat after open — Chrome won't autofill a readOnly field, and the
  // auto-focus lands during that window. Becomes editable right after.
  const [searchReady, setSearchReady] = useState(false);
  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) setQ('');
  };
  useEffect(() => {
    if (!open) {
      setSearchReady(false);
      return;
    }
    const t = setTimeout(() => setSearchReady(true), 450);
    return () => clearTimeout(t);
  }, [open]);
  const activePaneId = useTerminalStore((s) => s.activePaneId);
  const pane = useTerminalStore((s) => s.panes.find((p) => p.id === activePaneId) ?? s.panes[0]!);
  const togglePaneOverlay = useTerminalStore((s) => s.togglePaneOverlay);
  const toggleSmcOverlay = useTerminalStore((s) => s.toggleSmcOverlay);
  const addIndicator = useTerminalStore((s) => s.addIndicator);
  const removeIndicator = useTerminalStore((s) => s.removeIndicator);

  const isCrypto = pane.symbol.startsWith('BINANCE:');

  const isActive = (e: Entry): boolean => {
    if (e.kind === 'overlay') return pane.overlays[e.key];
    if (e.kind === 'smc') return pane.smc[e.key];
    return pane.classicIndicators.some((i) => i.type === e.type);
  };

  const toggle = (e: Entry): void => {
    if (e.kind === 'overlay') {
      togglePaneOverlay(pane.id, e.key);
      return;
    }
    if (e.kind === 'smc') {
      toggleSmcOverlay(pane.id, e.key);
      return;
    }
    // classic: one-instance-per-type toggle (advanced multi-instance lives in the Ind rail)
    const existing = pane.classicIndicators.filter((i) => i.type === e.type);
    if (existing.length > 0) {
      existing.forEach((i) => removeIndicator(pane.id, i.id));
    } else {
      const spec = INDICATOR_LOOKUP[e.type];
      if (spec) addIndicator(pane.id, buildInstance(spec));
    }
  };

  const activeCount = useMemo(() => {
    const ov = Object.values(pane.overlays).filter(Boolean).length;
    const smc = Object.values(pane.smc).filter(Boolean).length;
    return ov + smc + pane.classicIndicators.length;
  }, [pane]);

  const lower = q.trim().toLowerCase();
  const groups = useMemo(
    () =>
      CATALOG.map((g) => ({
        group: g.group,
        items: g.items.filter(
          (e) => !lower || e.label.toLowerCase().includes(lower) || e.desc.toLowerCase().includes(lower) || g.group.toLowerCase().includes(lower),
        ),
      })).filter((g) => g.items.length > 0),
    [lower],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
          <LineChart className="h-3.5 w-3.5" /> Indicators
          {activeCount > 0 ? (
            <Badge tone="accent" className="ml-0.5 px-1.5 text-[9px]">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-accent" /> Indicators
            <span className="text-xs font-normal text-muted-foreground">· {pane.symbol.split(':')[1] ?? pane.symbol} · {pane.interval}</span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Toggle any indicator on the active chart. Order-flow tools (heatmap, footprint, delta, CVD)
            need live trade data — Binance crypto only; on FX/metals they show no data rather than fake it.
          </p>
        </DialogHeader>

        <div className="px-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              name="sc-indicator-search"
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              readOnly={!searchReady}
              placeholder="Search indicators…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 pl-8"
            />
          </div>
        </div>

        <div className="max-h-[56vh] space-y-4 overflow-y-auto scroll-thin px-4 pb-2 pt-3">
          {groups.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No indicators match “{q}”.</div>
          ) : (
            groups.map((g) => (
              <div key={g.group}>
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {g.group}
                </div>
                <div className="space-y-1">
                  {g.items.map((e) => {
                    const active = isActive(e);
                    const needsData = 'orderflow' in e && e.orderflow && !isCrypto;
                    return (
                      <div
                        key={e.kind === 'classic' ? e.type : e.key}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggle(e)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            toggle(e);
                          }
                        }}
                        className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                          active ? 'border-accent/50 bg-accent/10' : 'border-border/60 bg-card/40 hover:border-border'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium text-foreground">{e.label}</span>
                            {'orderflow' in e && e.orderflow ? (
                              <Badge tone={needsData ? 'warn' : 'muted'} className="shrink-0 px-1 text-[8px]">
                                {needsData ? 'needs data' : 'order-flow'}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {needsData ? 'No live order-flow on this feed (Binance crypto only).' : e.desc}
                          </div>
                        </div>
                        {/* Display-only — the row owns the toggle (avoids double-fire + button-in-button). */}
                        <Switch checked={active} className="pointer-events-none shrink-0" />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
