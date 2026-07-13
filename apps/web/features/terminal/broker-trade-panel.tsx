'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine, ArrowUpToLine, Briefcase, CheckCircle2, Crosshair, ListOrdered,
  RefreshCw, TriangleAlert, X,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/use-toast';
import { api } from '@/lib/api';
import { parseBrokerSymbol } from '@/lib/broker-symbol';
import { useTerminalStore, type PaneState } from './terminal-store';

type OrderType = 'market' | 'limit' | 'sl' | 'sl-m';
type Product = 'mis' | 'cnc' | 'nrml';

interface ConnectionSummary {
  broker: string;
  status: string;
  accountMeta: { accountId: string; name: string } | null;
}
interface BrokerOrder {
  brokerOrderId: string; symbol: string; exchange: string; side: 'buy' | 'sell';
  quantity: number; filledQuantity: number; orderType: string; product: string;
  price: number | null; triggerPrice: number | null; status: string; statusMessage: string | null; variety: string;
}
interface BrokerPosition {
  symbol: string; exchange: string; product: string; quantity: number;
  averagePrice: number; lastPrice: number; pnl: number;
}

/** POST/PUT/DELETE that reads the JSON body so we can surface broker messages verbatim. */
async function send(path: string, method: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body != null ? { 'content-type': 'application/json' } : {},
    credentials: 'include',
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

const OPEN_STATES = new Set(['OPEN', 'TRIGGER PENDING', 'PENDING', 'AMO REQ RECEIVED', 'MODIFY PENDING', 'OPEN PENDING']);

/**
 * BYOB broker trade ticket (GW-3) — renders in the right-rail Trade tab when the active symbol
 * is a KITE symbol and the user is an admin (interim gate until GW-4). Orders go through the
 * user's OWN Kite account via the audited /api/broker/orders pipeline; every broker rejection is
 * shown verbatim. Nothing here is faked — with no active connection the panel guides reconnect.
 */
export function BrokerTradePanel({ pane }: { pane: PaneState }) {
  const ref = useMemo(() => parseBrokerSymbol(pane.symbol), [pane.symbol]);
  const [conn, setConn] = useState<ConnectionSummary | null | undefined>(undefined);
  const [orders, setOrders] = useState<BrokerOrder[]>([]);
  const [positions, setPositions] = useState<BrokerPosition[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const orderSideRequest = useTerminalStore((s) => s.orderSideRequest);
  useEffect(() => {
    if (orderSideRequest) setSide(orderSideRequest.side);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderSideRequest?.token]);
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [product, setProduct] = useState<Product>('mis');
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [trigger, setTrigger] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const active = conn?.status === 'active';

  const loadConn = useCallback(async () => {
    try {
      const r = await api<{ items: ConnectionSummary[] }>('/broker/connections');
      setConn(r.items.find((c) => c.broker === 'kite') ?? null);
    } catch {
      setConn(null);
    }
  }, []);

  const loadBook = useCallback(async () => {
    try {
      const [o, p] = await Promise.all([
        api<{ items: BrokerOrder[] }>('/broker/orders'),
        api<{ items: BrokerPosition[] }>('/broker/positions'),
      ]);
      setOrders(o.items);
      setPositions(p.items);
      setFeedError(null);
    } catch (err) {
      setFeedError((err as Error).message);
    }
  }, []);

  useEffect(() => { void loadConn(); }, [loadConn]);
  useEffect(() => {
    if (!active) return;
    void loadBook();
    const id = setInterval(() => void loadBook(), 5000);
    return () => clearInterval(id);
  }, [active, loadBook]);

  const needsPrice = orderType === 'limit' || orderType === 'sl';
  const needsTrigger = orderType === 'sl' || orderType === 'sl-m';

  const submit = async (): Promise<void> => {
    if (!ref) return;
    setSubmitting(true);
    setLastError(null);
    const intent = {
      symbol: ref.tradingSymbol, exchange: ref.exchange, side, quantity: qty, orderType, product,
      ...(needsPrice ? { price } : {}), ...(needsTrigger ? { triggerPrice: trigger } : {}),
    };
    const { ok, data } = await send('/broker/orders', 'POST', intent);
    setSubmitting(false);
    setConfirmOpen(false);
    if (!ok) {
      setLastError(String(data.message ?? 'Order was rejected.'));
      return;
    }
    toast({ title: `${side.toUpperCase()} order placed`, description: `#${String(data.brokerOrderId ?? '')}`, tone: 'success' });
    void loadBook();
  };

  const cancelOrder = async (o: BrokerOrder): Promise<void> => {
    const { ok, data } = await send(`/broker/orders/${o.brokerOrderId}?variety=${o.variety || 'regular'}`, 'DELETE');
    if (!ok) toast({ title: 'Cancel rejected', description: String(data.message ?? ''), tone: 'error' });
    else toast({ title: 'Order cancelled', tone: 'success' });
    void loadBook();
  };

  const exitPosition = async (p: BrokerPosition): Promise<void> => {
    const { ok, data } = await send('/broker/positions/exit', 'POST', p);
    if (!ok) toast({ title: 'Exit rejected', description: String(data.message ?? ''), tone: 'error' });
    else toast({ title: 'Exit order sent', description: `#${String(data.brokerOrderId ?? '')}`, tone: 'success' });
    void loadBook();
  };

  if (!ref) {
    return <div className="p-3 text-sm text-muted-foreground">Not a broker symbol.</div>;
  }

  if (conn === undefined) {
    return <div className="p-3 text-sm text-muted-foreground">Checking your broker connection…</div>;
  }

  if (!active) {
    return (
      <div className="space-y-3 p-3 text-sm">
        <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div>
            <div className="font-medium text-foreground">{conn ? 'Reconnect Kite to trade' : 'Connect Zerodha Kite to trade'}</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {conn
                ? 'Your Kite session needs a fresh daily token. Use the broker button in the top bar to reconnect, then place orders here.'
                : 'Use the broker (Landmark) button in the top bar to connect your Kite Connect app. Orders always go through your own account.'}
            </p>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Live Indian chart data uses your own Kite Connect data add-on (₹500/mo to Zerodha). Order APIs are free.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px]">
          <CheckCircle2 className="h-3.5 w-3.5 text-bull" />
          <span className="font-medium text-foreground">{ref.tradingSymbol}</span>
          <Badge tone="muted" className="text-[9px]">{ref.exchange}</Badge>
        </div>
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {conn?.accountMeta?.accountId ?? 'Kite'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant={side === 'buy' ? 'primary' : 'outline'} onClick={() => setSide('buy')} className="h-8">
          <ArrowUpToLine className="mr-1 h-3 w-3" /> Buy
        </Button>
        <Button variant={side === 'sell' ? 'primary' : 'outline'} onClick={() => setSide('sell')} className="h-8">
          <ArrowDownToLine className="mr-1 h-3 w-3" /> Sell
        </Button>
      </div>

      <Segmented
        label="Order type"
        value={orderType}
        options={[['market', 'Market'], ['limit', 'Limit'], ['sl', 'SL'], ['sl-m', 'SL-M']]}
        onChange={(v) => setOrderType(v as OrderType)}
      />
      <Segmented
        label="Product"
        value={product}
        options={[['mis', 'MIS'], ['cnc', 'CNC'], ['nrml', 'NRML']]}
        onChange={(v) => setProduct(v as Product)}
      />

      <div className="grid grid-cols-2 gap-2">
        <NumField label="Quantity" value={qty} onChange={(v) => setQty(Math.max(1, Math.round(v)))} step={1} />
        {needsPrice ? <NumField label="Limit price" value={price} onChange={setPrice} step={0.05} /> : <div />}
        {needsTrigger ? <NumField label="Trigger price" value={trigger} onChange={setTrigger} step={0.05} /> : null}
      </div>

      <Button
        className={`h-9 w-full text-sm text-white ${side === 'buy' ? 'bg-bull/90 hover:bg-bull' : 'bg-bear/90 hover:bg-bear'}`}
        disabled={submitting || (needsPrice && price <= 0) || (needsTrigger && trigger <= 0)}
        onClick={() => { setLastError(null); setConfirmOpen(true); }}
      >
        <Crosshair className="mr-1 h-3.5 w-3.5" />
        {side === 'buy' ? 'Buy' : 'Sell'} {ref.tradingSymbol}
      </Button>
      {lastError ? (
        <div className="flex items-start gap-1.5 rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px] text-bear">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{lastError}</span>
        </div>
      ) : null}

      <OpenOrders orders={orders} onCancel={cancelOrder} />
      <Positions positions={positions} onExit={exitPosition} />
      {feedError ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-2 py-1.5 text-[10px] text-muted-foreground">
          <span className="truncate">Book unavailable · {feedError.slice(0, 60)}</span>
          <button onClick={() => void loadBook()} className="ml-2 shrink-0 text-accent hover:underline"><RefreshCw className="h-3 w-3" /></button>
        </div>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Confirm order</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 rounded-md border border-border bg-surface-sunken p-3 text-xs">
            <Line k="Side" v={<Badge tone={side === 'buy' ? 'bull' : 'bear'}>{side.toUpperCase()}</Badge>} />
            <Line k="Symbol" v={`${ref.tradingSymbol} · ${ref.exchange}`} />
            <Line k="Type" v={`${orderType.toUpperCase()} · ${product.toUpperCase()}`} />
            <Line k="Quantity" v={String(qty)} />
            {needsPrice ? <Line k="Limit" v={String(price)} /> : null}
            {needsTrigger ? <Line k="Trigger" v={String(trigger)} /> : null}
            {needsPrice && price > 0 ? <Line k="Est. value" v={`₹${(qty * price).toLocaleString('en-IN')}`} /> : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Sent to your own Zerodha account. Margin, freeze-qty and circuit checks are enforced by the broker.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              className={`text-white ${side === 'buy' ? 'bg-bull/90 hover:bg-bull' : 'bg-bear/90 hover:bg-bear'}`}
              loading={submitting}
              onClick={() => void submit()}
            >
              Place {side} order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OpenOrders({ orders, onCancel }: { orders: BrokerOrder[]; onCancel: (o: BrokerOrder) => void }) {
  const open = orders.filter((o) => OPEN_STATES.has(o.status.toUpperCase()));
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <ListOrdered className="h-3 w-3" /> Open orders ({open.length})
      </div>
      {open.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2 py-2 text-[11px] text-muted-foreground">No open orders.</div>
      ) : (
        <div className="space-y-1">
          {open.map((o) => (
            <div key={o.brokerOrderId} className="rounded-md border border-border bg-surface-sunken/60 px-2 py-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span>
                  <Badge tone={o.side === 'buy' ? 'bull' : 'bear'} className="mr-1 text-[9px]">{o.side.toUpperCase()}</Badge>
                  <span className="font-mono text-foreground">{o.symbol}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{o.quantity} @ {o.price ?? o.triggerPrice ?? 'mkt'}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{o.orderType} · {o.product} · {o.status}</span>
                <Button size="sm" variant="outline" className="h-5 px-2 text-[10px]" onClick={() => onCancel(o)}>Cancel</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Positions({ positions, onExit }: { positions: BrokerPosition[]; onExit: (p: BrokerPosition) => void }) {
  const [confirm, setConfirm] = useState<BrokerPosition | null>(null);
  const live = positions.filter((p) => p.quantity !== 0);
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <Briefcase className="h-3 w-3" /> Positions ({live.length})
      </div>
      {live.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2 py-2 text-[11px] text-muted-foreground">No open positions.</div>
      ) : (
        <div className="space-y-1">
          {live.map((p) => (
            <div key={`${p.exchange}:${p.symbol}:${p.product}`} className="rounded-md border border-border bg-surface-sunken/60 px-2 py-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span>
                  <Badge tone={p.quantity > 0 ? 'bull' : 'bear'} className="mr-1 text-[9px]">{p.quantity > 0 ? 'LONG' : 'SHORT'}</Badge>
                  <span className="font-mono text-foreground">{p.symbol}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{Math.abs(p.quantity)} · {p.product}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground">
                <span>@ {p.averagePrice} · LTP {p.lastPrice}</span>
                <span className={p.pnl >= 0 ? 'text-bull' : 'text-bear'}>{p.pnl >= 0 ? '+' : ''}{p.pnl.toFixed(2)}</span>
              </div>
              <Button size="sm" variant="outline" className="mt-1 h-6 w-full text-[10px]" onClick={() => setConfirm(p)}>
                <X className="mr-1 h-3 w-3" /> Exit
              </Button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Exit position</DialogTitle></DialogHeader>
          {confirm ? (
            <p className="text-xs text-muted-foreground">
              Close {Math.abs(confirm.quantity)} {confirm.symbol} ({confirm.quantity > 0 ? 'long' : 'short'}) at market on your Kite account?
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirm(null)}>Keep</Button>
            <Button
              size="sm"
              className="bg-bear/90 text-white hover:bg-bear"
              onClick={() => { if (confirm) onExit(confirm); setConfirm(null); }}
            >
              Exit at market
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Segmented({
  label, value, options, onChange,
}: { label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(([v, txt]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`h-6 rounded-md border px-1 text-[10px] uppercase tracking-[0.1em] ${
              value === v ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border bg-surface-sunken text-muted-foreground hover:text-foreground'
            }`}
          >
            {txt}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumField({
  label, value, onChange, step = 1,
}: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <Input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-7 tabular-nums"
      />
    </label>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="tabular-nums text-foreground">{v}</span>
    </div>
  );
}
