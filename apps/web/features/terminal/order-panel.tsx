'use client';

import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Briefcase, Crosshair, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import type { OrderIntent, PartialCloseLeg } from '@supercharts/types';
import { useMT5Store } from './mt5-store';
import { useTerminalStore, type PaneState } from './terminal-store';

interface OrderPanelProps {
  pane: PaneState;
}

type Tab = 'market' | 'limit' | 'stop';
type SizingMode = 'fixed_lots' | 'risk_percent' | 'cash_risk';

export function OrderPanel({ pane }: OrderPanelProps) {
  const accounts = useMT5Store((s) => s.accounts);
  const activeAccountId = useMT5Store((s) => s.activeAccountId);
  const positions = useMT5Store((s) => s.positions);
  const pending = useMT5Store((s) => s.pending);
  const refreshPositions = useMT5Store((s) => s.refreshPositions);
  const account = accounts.find((a) => a.accountId === activeAccountId);

  const brokerSymbol = useMemo(() => mapBrokerSymbol(pane.symbol, account?.symbols ?? []), [pane.symbol, account?.symbols]);

  const [tab, setTab] = useState<Tab>('market');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [sizingMode, setSizingMode] = useState<SizingMode>('fixed_lots');
  const [lots, setLots] = useState(0.01);
  const [riskPercent, setRiskPercent] = useState(0.5);
  const [cashRisk, setCashRisk] = useState(50);
  const [slPips, setSlPips] = useState(20);
  const [tpPips, setTpPips] = useState(40);
  const [usePips, setUsePips] = useState(true);
  const [slPrice, setSlPrice] = useState(0);
  const [tpPrice, setTpPrice] = useState(0);
  const [restingPrice, setRestingPrice] = useState(0);
  const [partials, setPartials] = useState<PartialCloseLeg[]>([]);
  const [trailingPips, setTrailingPips] = useState(0);
  const [breakEvenPips, setBreakEvenPips] = useState(0);
  const [comment, setComment] = useState('manual');
  const [submitting, setSubmitting] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  if (!account) {
    return (
      <div className="space-y-3 p-3 text-sm text-muted-foreground">
        <p>Connect an MT5 account from the top bar to enable trading.</p>
        <p className="text-[11px]">Read-only chart features keep working without MT5.</p>
      </div>
    );
  }

  if (!brokerSymbol) {
    return (
      <div className="space-y-3 p-3 text-sm text-muted-foreground">
        <p>
          Symbol <span className="font-mono text-foreground">{pane.symbol}</span> is not available in this MT5 broker's Market Watch.
        </p>
        <p className="text-[11px]">
          Right-click the symbol in the MT5 terminal and choose <em>Show</em>, then refresh. Forex/metals/CFDs usually need to be enabled manually per account.
        </p>
      </div>
    );
  }

  const onSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setLastMessage(null);
    const sizing: OrderIntent['sizing'] =
      sizingMode === 'fixed_lots'
        ? { mode: 'fixed_lots', lots }
        : sizingMode === 'risk_percent'
          ? { mode: 'risk_percent', percent: riskPercent, slPips }
          : { mode: 'cash_risk', amount: cashRisk, slPips };
    const intent: OrderIntent = {
      accountId: account.accountId,
      symbol: brokerSymbol,
      side,
      kind: tab,
      sizing,
      price: tab === 'market' ? undefined : restingPrice,
      sl: usePips ? { pips: slPips } : slPrice > 0 ? { price: slPrice } : undefined,
      tp: usePips ? { pips: tpPips } : tpPrice > 0 ? { price: tpPrice } : undefined,
      partials: partials.length > 0 ? partials : undefined,
      trailing: trailingPips > 0 ? { distancePips: trailingPips, stepPips: Math.max(1, trailingPips / 5) } : undefined,
      breakEven: breakEvenPips > 0 ? { triggerPips: breakEvenPips } : undefined,
      comment,
    };
    try {
      const r = await api<{ intentId: string; state: string; error?: string }>('/mt5/orders', {
        method: 'POST',
        body: JSON.stringify(intent),
      });
      setLastMessage(`${r.state}${r.error ? ' · ' + r.error : ''}`);
      await refreshPositions();
    } catch (err) {
      setLastMessage(`error · ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const addPartial = (): void => {
    setPartials((arr) => [
      ...arr,
      {
        label: `TP${arr.length + 1}`,
        price: 0,
        fraction: 0.33,
        moveSlToBreakEvenAfter: arr.length === 0,
      },
    ]);
  };
  const updatePartial = (idx: number, patch: Partial<PartialCloseLeg>): void => {
    setPartials((arr) => arr.map((leg, i) => (i === idx ? { ...leg, ...patch } : leg)));
  };
  const removePartial = (idx: number): void => {
    setPartials((arr) => arr.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>{brokerSymbol}</span>
        <Badge tone={side === 'buy' ? 'bull' : 'bear'}>{side.toUpperCase()}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant={side === 'buy' ? 'primary' : 'outline'}
          onClick={() => setSide('buy')}
          className="h-8"
        >
          <ArrowUpToLine className="mr-1 h-3 w-3" /> Buy
        </Button>
        <Button
          variant={side === 'sell' ? 'primary' : 'outline'}
          onClick={() => setSide('sell')}
          className="h-8"
        >
          <ArrowDownToLine className="mr-1 h-3 w-3" /> Sell
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="grid grid-cols-3">
          <TabsTrigger value="market">Market</TabsTrigger>
          <TabsTrigger value="limit">Limit</TabsTrigger>
          <TabsTrigger value="stop">Stop</TabsTrigger>
        </TabsList>
        <TabsContent value="market" className="mt-2" />
        <TabsContent value="limit" className="mt-2">
          <NumField label="Resting price" value={restingPrice} onChange={setRestingPrice} step={0.0001} />
        </TabsContent>
        <TabsContent value="stop" className="mt-2">
          <NumField label="Trigger price" value={restingPrice} onChange={setRestingPrice} step={0.0001} />
        </TabsContent>
      </Tabs>

      <Separator />

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Sizing</div>
        <div className="grid grid-cols-3 gap-1">
          <SmallTab active={sizingMode === 'fixed_lots'} onClick={() => setSizingMode('fixed_lots')}>Lots</SmallTab>
          <SmallTab active={sizingMode === 'risk_percent'} onClick={() => setSizingMode('risk_percent')}>% Risk</SmallTab>
          <SmallTab active={sizingMode === 'cash_risk'} onClick={() => setSizingMode('cash_risk')}>$ Risk</SmallTab>
        </div>
        {sizingMode === 'fixed_lots' ? (
          <NumField label="Lots" value={lots} onChange={setLots} step={0.01} />
        ) : sizingMode === 'risk_percent' ? (
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Risk %" value={riskPercent} onChange={setRiskPercent} step={0.05} />
            <NumField label="SL pips" value={slPips} onChange={setSlPips} step={1} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Risk $" value={cashRisk} onChange={setCashRisk} step={5} />
            <NumField label="SL pips" value={slPips} onChange={setSlPips} step={1} />
          </div>
        )}
      </div>

      <Separator />

      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>Stops</span>
          <span className="flex items-center gap-1.5 normal-case">
            <span>pips</span>
            <Switch checked={!usePips} onCheckedChange={(v) => setUsePips(!v)} />
            <span>price</span>
          </span>
        </div>
        {usePips ? (
          <div className="grid grid-cols-2 gap-2">
            <NumField label="SL pips" value={slPips} onChange={setSlPips} step={1} />
            <NumField label="TP pips" value={tpPips} onChange={setTpPips} step={1} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <NumField label="SL price" value={slPrice} onChange={setSlPrice} step={0.0001} />
            <NumField label="TP price" value={tpPrice} onChange={setTpPrice} step={0.0001} />
          </div>
        )}
      </div>

      <Separator />

      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>Partial closes (TP1/2/3)</span>
          <button onClick={addPartial} className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline">
            <Plus className="h-3 w-3" /> add
          </button>
        </div>
        <div className="space-y-1.5">
          {partials.map((leg, i) => (
            <div key={i} className="flex items-end gap-1 rounded-md border border-border bg-surface-sunken/60 p-2">
              <div className="grid grid-cols-3 flex-1 gap-1">
                <label className="block">
                  <div className="mb-0.5 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">label</div>
                  <Input value={leg.label} onChange={(e) => updatePartial(i, { label: e.target.value })} className="h-6 px-1.5 text-xs" />
                </label>
                <label className="block">
                  <div className="mb-0.5 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">price</div>
                  <Input
                    type="number"
                    step="0.0001"
                    value={leg.price}
                    onChange={(e) => updatePartial(i, { price: Number(e.target.value) })}
                    className="h-6 px-1.5 text-xs"
                  />
                </label>
                <label className="block">
                  <div className="mb-0.5 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">fraction</div>
                  <Input
                    type="number"
                    step="0.05"
                    min={0.01}
                    max={1}
                    value={leg.fraction}
                    onChange={(e) => updatePartial(i, { fraction: Number(e.target.value) })}
                    className="h-6 px-1.5 text-xs"
                  />
                </label>
              </div>
              <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => removePartial(i)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumField label="Trailing pips" value={trailingPips} onChange={setTrailingPips} step={1} />
        <NumField label="Break-even pips" value={breakEvenPips} onChange={setBreakEvenPips} step={1} />
      </div>

      <label className="block">
        <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Comment</div>
        <Input value={comment} onChange={(e) => setComment(e.target.value.slice(0, 31))} className="h-7" />
      </label>

      <Button
        className={`h-9 w-full text-sm ${side === 'buy' ? 'bg-bull/90 hover:bg-bull text-white' : 'bg-bear/90 hover:bg-bear text-white'}`}
        onClick={() => void onSubmit()}
        disabled={submitting}
      >
        <Crosshair className="mr-1 h-3.5 w-3.5" />
        {submitting ? 'Sending…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${tab === 'market' ? 'market' : tab}`}
      </Button>
      {lastMessage ? (
        <div className="rounded-md border border-border bg-surface-sunken px-2 py-1.5 text-[11px] text-muted-foreground">
          {lastMessage}
        </div>
      ) : null}

      <PositionsList positions={positions} pending={pending} accountId={account.accountId} />
    </div>
  );
}

function PositionsList({
  positions,
  pending,
  accountId,
}: {
  positions: ReturnType<typeof useMT5Store.getState>['positions'];
  pending: ReturnType<typeof useMT5Store.getState>['pending'];
  accountId: string;
}) {
  const refreshPositions = useMT5Store((s) => s.refreshPositions);
  const own = positions.filter((p) => p.accountId === accountId);
  const ownOrders = pending.filter((p) => p.accountId === accountId);
  const close = async (id: string, fraction = 1): Promise<void> => {
    await api(`/mt5/positions/${id}`, {
      method: 'DELETE',
      searchParams: { fraction: String(fraction) },
    });
    await refreshPositions();
  };
  const cancel = async (id: string): Promise<void> => {
    await api(`/mt5/orders/${id}`, { method: 'DELETE' });
    await refreshPositions();
  };
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Briefcase className="h-3 w-3" /> Open positions ({own.length})
      </div>
      <div className="space-y-1">
        {own.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-2 py-2 text-[11px] text-muted-foreground">No open positions.</div>
        ) : (
          own.map((p) => (
            <div key={p.id} className="rounded-md border border-border bg-surface-sunken/60 px-2 py-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span>
                  <Badge tone={p.side === 'buy' ? 'bull' : 'bear'} className="mr-1 text-[9px]">{p.side.toUpperCase()}</Badge>
                  <span className="font-mono text-foreground">{p.symbol}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{p.volume.toFixed(2)} lot</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
                <span>@ {p.openPrice.toFixed(5)} · SL {p.sl.toFixed(5)} · TP {p.tp.toFixed(5)}</span>
                <span className={p.profit >= 0 ? 'text-bull' : 'text-bear'}>{p.profit.toFixed(2)}</span>
              </div>
              <div className="mt-1 flex gap-1">
                <Button size="sm" variant="outline" className="h-6 flex-1 text-[10px]" onClick={() => void close(p.id, 0.5)}>
                  ½
                </Button>
                <Button size="sm" variant="outline" className="h-6 flex-1 text-[10px]" onClick={() => void close(p.id, 1)}>
                  Close
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
      {ownOrders.length > 0 ? (
        <>
          <div className="mb-1 mt-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Pending ({ownOrders.length})
          </div>
          {ownOrders.map((o) => (
            <div key={o.id} className="rounded-md border border-border bg-surface-sunken/60 px-2 py-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span>
                  <Badge tone="muted" className="mr-1 text-[9px]">{o.kind} {o.side}</Badge>
                  <span className="font-mono text-foreground">{o.symbol}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{o.volume.toFixed(2)} lot @ {o.price.toFixed(5)}</span>
              </div>
              <Button size="sm" variant="outline" className="mt-1 h-6 w-full text-[10px]" onClick={() => void cancel(o.id)}>
                Cancel
              </Button>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 w-full rounded-md border border-border bg-surface-sunken px-2 text-xs tabular-nums text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/60"
      />
    </label>
  );
}

function SmallTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-6 rounded-md border px-2 text-[10px] uppercase tracking-[0.12em] ${
        active ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border bg-surface-sunken text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function mapBrokerSymbol(symbolId: string, brokerSymbols: ReadonlyArray<{ raw: string; baseCurrency: string; quoteCurrency: string }>): string | null {
  const tail = symbolId.split(':').slice(1).join(':');
  // Normalize OANDA: "EUR_USD" → "EURUSD"
  const norm = tail.replace('_', '').toUpperCase();
  const exact = brokerSymbols.find((s) => s.raw.toUpperCase() === norm);
  if (exact) return exact.raw;
  const fuzzy = brokerSymbols.find((s) => s.raw.toUpperCase().startsWith(norm));
  if (fuzzy) return fuzzy.raw;
  return null;
}

void useTerminalStore;
