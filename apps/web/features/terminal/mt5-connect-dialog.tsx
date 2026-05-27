'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Copy, Check, ShieldCheck, Server, Terminal as TerminalIcon } from 'lucide-react';
import { useMT5Store } from './mt5-store';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MT5ConnectDialog({ open, onOpenChange }: Props) {
  const { pairingToken, pairingExpiresAt, generatePairingToken } = useMT5Store();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && !pairingToken) {
      void generatePairingToken();
    }
  }, [open, pairingToken, generatePairingToken]);

  const expiresIn = pairingExpiresAt ? Math.max(0, pairingExpiresAt - Date.now()) : 0;
  const expiresHrs = Math.floor(expiresIn / 3_600_000);

  const handleCopy = (): void => {
    if (!pairingToken) return;
    navigator.clipboard.writeText(pairingToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect MetaTrader 5</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            SuperCharts pairs to your MT5 terminal through a custom Expert
            Advisor (EA). The EA opens a TCP socket to this server and streams
            account / positions / ticks while accepting orders.
          </p>

          <Step
            n={1}
            title="Install the EA"
            icon={<TerminalIcon className="h-4 w-4" />}
          >
            Open MetaTrader 5 → <code>File → Open Data Folder</code>. Copy{' '}
            <code>SuperChartsBridge.mq5</code> from <code>apps/mt5-ea/</code>{' '}
            into <code>MQL5/Experts/</code>. In MetaEditor press <kbd>F7</kbd>{' '}
            to compile.
          </Step>

          <Step n={2} title="Allow algorithmic trading" icon={<ShieldCheck className="h-4 w-4" />}>
            <code>Tools → Options → Expert Advisors</code> → enable{' '}
            <strong>Allow algorithmic trading</strong>. The EA does not need
            DLL imports or WebRequest URLs for the TCP path.
          </Step>

          <Step n={3} title="Attach the EA" icon={<Server className="h-4 w-4" />}>
            Drag <code>SuperChartsBridge</code> from the Navigator onto any
            chart. In the inputs, set <code>InpHost</code> to this server's
            address and <code>InpPort</code> to your{' '}
            <code>MT5_BRIDGE_PORT</code> (default <code>7878</code>). Paste
            the pairing token below into <code>InpAccountToken</code>.
          </Step>

          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Pairing token · valid {expiresHrs}h
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-xs">
              <span className="flex-1 truncate text-foreground">{pairingToken ?? 'Generating…'}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                disabled={!pairingToken}
                className="h-7 px-2"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Single-use until first attach. Rotate any time with the button below.
            </p>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => void generatePairingToken()}>
              Rotate token
            </Button>
          </div>

          <p className="rounded-md border border-warn/40 bg-warn/5 p-3 text-[11px] text-warn">
            The EA accepts trade commands from any backend it connects to.
            Only point it at a SuperCharts instance you control. Treat the
            pairing token like an API key.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  n,
  title,
  icon,
  children,
}: {
  n: number;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-md border border-border bg-surface-sunken/60 p-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold">
          <span className="mr-1 text-muted-foreground">{n}.</span>
          {title}
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
