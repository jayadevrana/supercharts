'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot, Zap, TriangleAlert, CheckCircle2, Trash2, ExternalLink } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { toast } from '@/components/use-toast';
import { parseBrokerSymbol } from '@/lib/broker-symbol';
import {
  ARM_INTERVALS, defaultArmForm, validateArmForm, describeAutomation,
  type ArmForm, type ArmProduct, type ArmedAutomation,
} from '@/lib/automation-arm';
import { useTerminalStore } from './terminal-store';

/**
 * GW-7 FINAL-DELIVERY arm surface (UI) — "Arm SuperTrend flip automation on a Kite instrument".
 *
 * Reads the active pane's chart symbol; if it's a KITE instrument the owner picks ATR/mult/qty/
 * product/cap and arms a position-FLIP automation via `POST /api/broker/automation/supertrend`
 * (BUY signal → go long, closing any short; SELL → close long, go short). The route runs the SAME
 * whitelist gate a manual order needs, so failures (not connected / not whitelisted / not Pro) are
 * surfaced verbatim. Places NO order itself — the wired GW-7 executor flips on a signal fire.
 *
 * Admin-gated in the top bar (same as the broker connect button). Thin shell over the tested pure
 * helper `@/lib/automation-arm`.
 */

interface ArmError { status: number; message: string; ip?: string }

export function AutomationArmDialog() {
  const [open, setOpen] = useState(false);
  const panes = useTerminalStore((s) => s.panes);
  const activePaneId = useTerminalStore((s) => s.activePaneId);
  const active = useMemo(() => panes.find((p) => p.id === activePaneId) ?? panes[0], [panes, activePaneId]);
  const symbolId = active?.symbol ?? '';
  const ref = useMemo(() => parseBrokerSymbol(symbolId), [symbolId]);

  const [form, setForm] = useState<ArmForm>(() => defaultArmForm(active?.interval));
  const [items, setItems] = useState<ArmedAutomation[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [armError, setArmError] = useState<ArmError | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const set = <K extends keyof ArmForm>(k: K, v: ArmForm[K]): void => setForm((f) => ({ ...f, [k]: v }));

  const refresh = async (): Promise<void> => {
    try {
      const res = await api<{ items: ArmedAutomation[] }>('/broker/automation');
      setItems(res.items);
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    if (open) {
      setArmError(null);
      setFormErrors([]);
      setForm(defaultArmForm(active?.interval));
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const arm = async (): Promise<void> => {
    const v = validateArmForm(symbolId, form);
    if (!v.ok) {
      setFormErrors(v.errors);
      return;
    }
    setFormErrors([]);
    setArmError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/broker/automation/supertrend', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(v.payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setArmError({
          status: res.status,
          message: String(data.message ?? data.error ?? armErrorFallback(res.status)),
          ip: typeof data.ip === 'string' ? data.ip : undefined,
        });
        return;
      }
      toast({ title: 'Automation armed', description: `${ref?.tradingSymbol ?? symbolId} · SuperTrend flip`, tone: 'success' });
      await refresh();
    } catch {
      setArmError({ status: 0, message: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  };

  const disarm = async (automationId: string): Promise<void> => {
    setBusy(true);
    try {
      await api(`/broker/automation/${automationId}`, { method: 'DELETE' });
      await refresh();
      toast({ title: 'Automation disarmed', tone: 'success' });
    } finally {
      setBusy(false);
    }
  };

  const armedCount = items?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative px-2 text-muted-foreground hover:text-foreground"
          title="Arm SuperTrend flip automation on a Kite instrument"
          aria-label="Arm automation"
        >
          <Bot className="h-4 w-4" />
          {armedCount > 0 ? <span className="absolute right-1 top-1 inline-block h-1.5 w-1.5 rounded-full bg-bull" /> : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Zap className="h-4 w-4 text-accent" /> Arm SuperTrend flip · Zerodha
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Auto-trade your connected Zerodha on a <span className="text-foreground">position-flip</span>: a{' '}
            <span className="text-bull">BUY</span> signal closes any short and goes long; a{' '}
            <span className="text-bear">SELL</span> closes the long and goes short. Orders route through your own
            audited, IP-whitelisted pipeline. Nothing is placed until a live signal fires.
          </p>

          {ref ? (
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2.5 py-1.5 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-bull" />
              <span className="font-medium text-foreground">{ref.tradingSymbol}</span>
              <Badge tone="muted" className="text-[9px]">{ref.exchange}</Badge>
              <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-muted-foreground">active pane</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-3 text-[11px]">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
              <span className="text-foreground">
                Open a Zerodha instrument (a <code>KITE:</code> symbol) on the active pane to arm an automation.
              </span>
            </div>
          )}

          {ref ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Interval">
                <select
                  className="h-7 w-full rounded-md border border-border bg-surface-sunken px-2 text-xs text-foreground"
                  value={form.interval}
                  onChange={(e) => set('interval', e.target.value)}
                >
                  {ARM_INTERVALS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                </select>
              </Field>
              <Field label="Product">
                <div className="grid grid-cols-3 gap-1">
                  {(['mis', 'cnc', 'nrml'] as ArmProduct[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => set('product', p)}
                      className={`h-7 rounded-md border text-[10px] uppercase tracking-[0.1em] ${
                        form.product === p ? 'border-accent/60 bg-accent/10 text-accent' : 'border-border bg-surface-sunken text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="ATR length">
                <Input type="number" step={1} min={1} className="h-7 tabular-nums" value={form.atrLength}
                  onChange={(e) => set('atrLength', Math.round(Number(e.target.value)))} />
              </Field>
              <Field label="Multiplier">
                <Input type="number" step={0.5} min={0.5} className="h-7 tabular-nums" value={form.multiplier}
                  onChange={(e) => set('multiplier', Number(e.target.value))} />
              </Field>
              <Field label="Quantity">
                <Input type="number" step={1} min={1} className="h-7 tabular-nums" value={form.quantity}
                  onChange={(e) => set('quantity', Math.round(Number(e.target.value)))} />
              </Field>
              <Field label="Max flips/day (blank = ∞)">
                <Input type="number" step={1} min={1} className="h-7 tabular-nums"
                  value={form.maxTradesPerDay ?? ''}
                  placeholder="unlimited"
                  onChange={(e) => set('maxTradesPerDay', e.target.value === '' ? null : Math.round(Number(e.target.value)))} />
              </Field>
            </div>
          ) : null}

          {ref ? (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={form.telegram} onChange={(e) => set('telegram', e.target.checked)} />
              Telegram note on each flip
            </label>
          ) : null}

          {formErrors.length > 0 ? (
            <div className="rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px] text-bear">
              <ul className="list-disc pl-4">{formErrors.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          ) : null}

          {armError ? (
            <div className="flex flex-col gap-1.5 rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px] text-bear">
              <div className="flex items-start gap-1.5"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{armError.message}</span></div>
              {armError.status === 409 && armError.ip ? (
                <a href="https://developers.kite.trade/apps" target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline">
                  <ExternalLink className="h-3 w-3" /> Whitelist {armError.ip} in your Kite app, then confirm via the broker button
                </a>
              ) : null}
              {armError.status === 404 ? (
                <span className="text-muted-foreground">Connect your Zerodha account first with the broker (Landmark) button in the top bar.</span>
              ) : null}
            </div>
          ) : null}

          {ref ? (
            <Button size="sm" loading={busy} onClick={() => void arm()} className="gap-1">
              <Zap className="h-3.5 w-3.5" /> Arm on {ref.tradingSymbol}
            </Button>
          ) : null}

          <div className="mt-1 border-t border-border pt-2">
            <div className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Armed automations ({armedCount})
            </div>
            {items === null ? (
              <div className="text-[11px] text-muted-foreground">Loading…</div>
            ) : items.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-2 py-2 text-[11px] text-muted-foreground">
                None armed yet.
              </div>
            ) : (
              <div className="space-y-1.5">
                {items.map((a) => (
                  <div key={a.automationId} className="flex items-start justify-between gap-2 rounded-md border border-border bg-surface-sunken/60 px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <Badge tone={a.enabled ? 'bull' : 'muted'} className="text-[9px]">{a.enabled ? 'ARMED' : 'paused'}</Badge>
                        <span className="truncate text-foreground">{describeAutomation(a)}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-muted-foreground hover:text-bear"
                      loading={busy} onClick={() => void disarm(a.automationId)} aria-label="Disarm automation">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function armErrorFallback(status: number): string {
  if (status === 403) return 'Pro plan required to arm broker automation.';
  if (status === 404) return 'No active Zerodha connection.';
  if (status === 409) return 'Your order-routing IP is not whitelisted yet.';
  return 'Could not arm the automation.';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
