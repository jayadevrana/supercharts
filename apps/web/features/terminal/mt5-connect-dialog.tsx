'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Copy,
  Check,
  ShieldCheck,
  Server,
  Terminal as TerminalIcon,
  Wifi,
  WifiOff,
  AlertTriangle,
} from 'lucide-react';
import { useMT5Store } from './mt5-store';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MT5ConnectDialog({ open, onOpenChange }: Props) {
  const {
    pairingToken,
    pairingExpiresAt,
    pairingError,
    generatePairingToken,
    accounts,
    bridgeStatus,
    statusError,
    refreshStatus,
    refreshAccounts,
  } = useMT5Store();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!pairingToken) void generatePairingToken();
    // Live status while the dialog is open so the user sees the EA attach
    // without refreshing.
    void refreshStatus();
    void refreshAccounts();
    const id = setInterval(() => {
      void refreshStatus();
      void refreshAccounts();
    }, 4_000);
    return () => clearInterval(id);
  }, [open, pairingToken, generatePairingToken, refreshStatus, refreshAccounts]);

  const expiresIn = pairingExpiresAt ? Math.max(0, pairingExpiresAt - Date.now()) : 0;
  const expiresHrs = Math.floor(expiresIn / 3_600_000);

  const handleCopy = (): void => {
    if (!pairingToken) return;
    navigator.clipboard.writeText(pairingToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const bridgePort = bridgeStatus?.bridgePort ?? 7878;
  const bridgeHost = bridgeStatus?.bridgeHost ?? '127.0.0.1';
  const known = bridgeStatus?.knownAccounts ?? [];
  const connectedCount = known.filter((k) => k.connected).length;
  const liveByAccountId = new Map(accounts.map((a) => [a.accountId, a]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect MetaTrader 5</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {/* ── Live connection status ───────────────────────────────── */}
          <div data-testid="mt5-status" className="rounded-md border border-border bg-surface-sunken/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Connection status
              </span>
              {statusError ? (
                <Badge tone="bear" className="text-[9px]">API unreachable</Badge>
              ) : !bridgeStatus ? (
                <Badge tone="muted" className="text-[9px]">Checking…</Badge>
              ) : connectedCount > 0 ? (
                <Badge tone="bull" className="text-[9px]">
                  {connectedCount} account{connectedCount > 1 ? 's' : ''} connected
                </Badge>
              ) : known.length > 0 ? (
                <Badge tone="muted" className="text-[9px]">Awaiting EA reconnect</Badge>
              ) : (
                <Badge tone="muted" className="text-[9px]">No EA paired yet</Badge>
              )}
            </div>

            {statusError ? (
              <p className="text-[11px] text-bear">
                Could not reach the SuperCharts API — connection status is unknown. ({statusError})
              </p>
            ) : !bridgeStatus ? (
              <p className="text-[11px] text-muted-foreground">Checking bridge status…</p>
            ) : (
              <>
                <p className="text-[11px] text-muted-foreground">
                  TCP bridge listening on{' '}
                  <code className="text-foreground">{bridgeHost}:{bridgePort}</code>
                  {bridgeHost === '127.0.0.1' ? (
                    <span> — loopback only: the MT5 terminal must run on <em>this same machine</em>. To accept a remote MT5/VPS, start the API with <code>MT5_BRIDGE_HOST=0.0.0.0</code>.</span>
                  ) : null}
                </p>
                {known.length === 0 ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    No MT5 account has paired yet. Follow the steps below — once the EA
                    connects, the account appears here automatically.
                  </p>
                ) : (
                  <div className="mt-2 space-y-1">
                    {known.map((k) => {
                      const live = liveByAccountId.get(k.accountId);
                      const equity = live?.snapshot?.equity;
                      return (
                        <div
                          key={k.accountId}
                          className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-2 py-1.5 text-[11px]"
                        >
                          <span className="flex items-center gap-1.5">
                            {k.connected ? (
                              <Wifi className="h-3 w-3 text-bull" />
                            ) : (
                              <WifiOff className="h-3 w-3 text-bear" />
                            )}
                            <span className="font-mono text-foreground">{k.accountId}</span>
                            {k.broker ? (
                              <Badge tone="muted" className="text-[9px]">{k.broker}</Badge>
                            ) : null}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {k.connected
                              ? equity != null
                                ? `${equity.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${k.currency || ''} · live`
                                : 'live'
                              : `last seen ${timeAgo(k.lastSeenAt)}`}
                          </span>
                        </div>
                      );
                    })}
                    {connectedCount === 0 ? (
                      <p className="text-[10px] text-muted-foreground">
                        Previously paired accounts reconnect automatically when their EA
                        comes back online — no new token needed.
                      </p>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>

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
            address and <code>InpPort</code> to <code>{bridgePort}</code>.
            Paste the pairing token below into <code>InpAccountToken</code>.
          </Step>

          <div>
            <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Pairing token · valid {expiresHrs}h
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-xs">
              <span className="flex-1 truncate text-foreground">
                {pairingToken ?? (pairingError ? '—' : 'Generating…')}
              </span>
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
            {pairingError ? (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-bear">
                <AlertTriangle className="h-3 w-3" /> Token request failed: {pairingError}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Valid for 24h until the EA first attaches; while the EA stays
                paired the token keeps renewing automatically. Generating a new
                token does not revoke earlier ones until they expire.
              </p>
            )}
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => void generatePairingToken()}>
              Generate new token
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
