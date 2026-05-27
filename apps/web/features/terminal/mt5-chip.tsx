'use client';

import { useEffect, useState } from 'react';
import { CircleDollarSign, Plug, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useMT5Store } from './mt5-store';
import { MT5ConnectDialog } from './mt5-connect-dialog';

export function MT5Chip() {
  const { accounts, activeAccountId, setActiveAccount, refreshAccounts } = useMT5Store();
  const [open, setOpen] = useState(false);
  const active = accounts.find((a) => a.accountId === activeAccountId) ?? accounts[0];

  useEffect(() => {
    void refreshAccounts();
    const id = setInterval(() => void refreshAccounts(), 8_000);
    return () => clearInterval(id);
  }, [refreshAccounts]);

  if (!active) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-border bg-surface-sunken px-2.5 py-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:border-accent/60 hover:text-foreground"
        >
          <Plug className="h-3 w-3" /> Connect MT5
        </button>
        <MT5ConnectDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }

  const equity = active.snapshot?.equity ?? 0;
  const currency = active.snapshot?.account.currency ?? 'USD';
  const connected = active.connected;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-2 rounded-md border bg-surface-sunken px-2.5 py-1.5 text-[11px] hover:border-accent/60 ${
          connected ? 'border-bull/40' : 'border-bear/40'
        }`}
      >
        {connected ? (
          <Wifi className="h-3 w-3 text-bull" />
        ) : (
          <WifiOff className="h-3 w-3 text-bear" />
        )}
        <span className="font-semibold tracking-tight text-foreground">
          MT5 · {active.snapshot?.account.login ?? active.accountId.split('@')[0]}
        </span>
        <Badge tone="muted" className="text-[9px]">
          {active.snapshot?.account.broker ?? '—'}
        </Badge>
        <span className="text-foreground/80 tabular-nums">
          <CircleDollarSign className="mr-0.5 inline h-3 w-3" />
          {equity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}
        </span>
      </button>
      {accounts.length > 1 ? (
        <select
          value={activeAccountId ?? ''}
          onChange={(e) => setActiveAccount(e.target.value || null)}
          className="rounded-md border border-border bg-surface-sunken px-2 py-1 text-[11px] text-foreground"
        >
          {accounts.map((a) => (
            <option key={a.accountId} value={a.accountId}>
              {a.snapshot?.account.broker ?? '?'} · {a.snapshot?.account.login}
            </option>
          ))}
        </select>
      ) : null}
      <MT5ConnectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
