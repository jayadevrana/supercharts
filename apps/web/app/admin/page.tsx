'use client';

import { useCallback, useEffect, useState } from 'react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Users, Landmark, ScrollText, ShieldAlert, Network } from 'lucide-react';
import { useSession } from '@/lib/auth';
import { api } from '@/lib/api';

interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  plan: string;
  planExpiresAt: number | null;
  emailVerified: boolean;
  createdAt: number;
  connectionCount: number;
  orderCount: number;
}
interface AdminConnection {
  id: string;
  userId: string;
  email: string;
  broker: string;
  apiKeyLast4: string;
  status: string;
  lastLoginAt: number | null;
  createdAt: number;
}
interface AdminOrder {
  id: string;
  userId: string;
  email: string;
  broker: string;
  intent: string;
  brokerOrderId: string | null;
  status: string;
  error: string | null;
  placedVia: string;
  createdAt: number;
}
interface AdminEgress {
  id: string;
  ip: string;
  source: string;
  region: string | null;
  label: string | null;
  status: string;
  createdAt: number;
  brokersUsed: string[];
}

/** The Pro activation windows the owner can grant with one click. `null` = lifetime. */
const DURATIONS: { label: string; days: number | null }[] = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
  { label: 'Lifetime', days: null },
];

function fmtDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toISOString().slice(0, 10);
}

export default function AdminPage() {
  const { user, loading } = useSession();

  // Client guard: bounce non-admins (middleware only checks the session cookie is present).
  useEffect(() => {
    if (loading) return;
    if (!user) window.location.href = '/login';
    else if (user.role !== 'admin') window.location.href = '/terminal';
  }, [loading, user]);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [connections, setConnections] = useState<AdminConnection[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [egress, setEgress] = useState<AdminEgress[]>([]);
  const [newIp, setNewIp] = useState('');
  const [newProxy, setNewProxy] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [u, c, o, e] = await Promise.all([
        api<{ items: AdminUser[] }>('/admin/users'),
        api<{ items: AdminConnection[] }>('/admin/connections'),
        api<{ items: AdminOrder[] }>('/admin/orders'),
        api<{ items: AdminEgress[] }>('/admin/egress'),
      ]);
      setUsers(u.items);
      setConnections(c.items);
      setOrders(o.items);
      setEgress(e.items);
      setErr(null);
    } catch {
      setErr('Failed to load admin data.');
    }
  }, []);

  async function addEgress() {
    if (!newIp.trim() || !newProxy.trim()) return;
    setBusyId('add-egress');
    try {
      await api('/admin/egress', { method: 'POST', body: JSON.stringify({ ip: newIp.trim(), proxyUrl: newProxy.trim(), label: newLabel.trim() || undefined }) });
      setNewIp('');
      setNewProxy('');
      setNewLabel('');
      await refresh();
    } catch {
      setErr('Failed to add IP.');
    } finally {
      setBusyId(null);
    }
  }
  async function removeEgress(id: string) {
    setBusyId(id);
    try {
      await api(`/admin/egress/${id}`, { method: 'DELETE' });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    if (user?.role === 'admin') void refresh();
  }, [user, refresh]);

  async function setPlan(id: string, plan: 'free' | 'pro', durationDays: number | null) {
    setBusyId(id);
    try {
      await api(`/admin/users/${id}/plan`, {
        method: 'POST',
        body: JSON.stringify(plan === 'pro' && durationDays != null ? { plan, durationDays } : { plan }),
      });
      await refresh();
    } catch {
      setErr('Could not update the plan.');
    } finally {
      setBusyId(null);
    }
  }

  if (loading || !user || user.role !== 'admin') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading…</main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-accent" />
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Manual Pro activation, broker connections, and the order audit trail (owner-only).
        </p>
        {err && (
          <p className="mt-4 rounded-md border border-bear/40 bg-bear/10 px-3 py-2 text-sm text-bear" role="alert">
            {err}
          </p>
        )}

        {/* Users */}
        <Section title="Users" icon={<Users className="h-4 w-4" />} count={users.length}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium">Conns</th>
                  <th className="px-3 py-2 font-medium">Orders</th>
                  <th className="px-3 py-2 font-medium">Activate Pro</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const proActive = u.plan === 'pro' && (u.planExpiresAt == null || u.planExpiresAt > Date.now());
                  return (
                    <tr key={u.id} className="border-t border-border/50">
                      <td className="px-3 py-2.5">
                        <div className="font-medium">{u.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {u.role === 'admin' && <span className="text-accent">admin · </span>}
                          {u.displayName ?? '—'} · joined {fmtDate(u.createdAt)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {u.role === 'admin' ? (
                          <Badge tone="accent">admin</Badge>
                        ) : proActive ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge tone="bull">pro</Badge>
                            <span className="text-[10px] text-muted-foreground">
                              until {u.planExpiresAt ? fmtDate(u.planExpiresAt) : 'lifetime'}
                            </span>
                          </div>
                        ) : u.plan === 'pro' ? (
                          <Badge tone="bear">expired</Badge>
                        ) : (
                          <Badge tone="muted">free</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{u.connectionCount}</td>
                      <td className="px-3 py-2.5 tabular-nums">{u.orderCount}</td>
                      <td className="px-3 py-2.5">
                        {u.role === 'admin' ? (
                          <span className="text-xs text-muted-foreground">always on</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {DURATIONS.map((d) => (
                              <Button
                                key={d.label}
                                size="sm"
                                variant="outline"
                                disabled={busyId === u.id}
                                onClick={() => setPlan(u.id, 'pro', d.days)}
                              >
                                {d.label}
                              </Button>
                            ))}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === u.id || u.plan === 'free'}
                              onClick={() => setPlan(u.id, 'free', null)}
                            >
                              Deactivate
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Broker connections */}
        <Section title="Broker connections" icon={<Landmark className="h-4 w-4" />} count={connections.length}>
          {connections.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No broker connections yet.</p>
          ) : (
            <ul className="divide-y divide-border/50 text-sm">
              {connections.map((c) => (
                <li key={c.id} className="flex items-center justify-between px-3 py-2.5">
                  <span>
                    <span className="font-medium">{c.email}</span>
                    <span className="text-muted-foreground"> · {c.broker.toUpperCase()} · ••••{c.apiKeyLast4}</span>
                  </span>
                  <Badge tone={c.status === 'active' ? 'bull' : c.status === 'pending' ? 'warn' : 'muted'}>
                    {c.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Order-routing egress IP pool (GW-5) */}
        <Section title="Order-routing IPs" icon={<Network className="h-4 w-4" />} count={egress.length}>
          <div className="space-y-3 px-3 py-3">
            <p className="text-[11px] text-muted-foreground">
              SEBI: one IP per client per broker. Each row shows the broker-slots taken. The VM IP is slot 1; add datacenter
              proxies for additional same-broker users.
            </p>
            <ul className="divide-y divide-border/50 text-sm">
              {egress.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="font-mono">{e.ip}</span>
                    <span className="text-muted-foreground"> · {e.source}{e.label ? ` · ${e.label}` : ''}</span>
                    <span className="ml-2 inline-flex flex-wrap gap-1">
                      {e.brokersUsed.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground">free</span>
                      ) : e.brokersUsed.map((b, i) => <Badge key={i} tone="muted" className="text-[9px]">{b}</Badge>)}
                    </span>
                  </span>
                  {e.source !== 'vm' ? (
                    <Button variant="ghost" size="sm" className="text-bear" loading={busyId === e.id} onClick={() => void removeEgress(e.id)}>
                      Remove
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2 border-t border-border/50 pt-3">
              <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                Public IP
                <Input value={newIp} onChange={(ev) => setNewIp(ev.target.value)} placeholder="103.x.x.x" className="h-8 w-32 text-xs" />
              </label>
              <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                Proxy URL
                <Input value={newProxy} onChange={(ev) => setNewProxy(ev.target.value)} placeholder="http://user:pass@103.x.x.x:8080" className="h-8 w-56 text-xs" />
              </label>
              <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                Label
                <Input value={newLabel} onChange={(ev) => setNewLabel(ev.target.value)} placeholder="proxy-1" className="h-8 w-24 text-xs" />
              </label>
              <Button size="sm" loading={busyId === 'add-egress'} disabled={!newIp.trim() || !newProxy.trim()} onClick={() => void addEgress()}>
                Add IP
              </Button>
            </div>
          </div>
        </Section>

        {/* Order audit */}
        <Section title="Recent order audit" icon={<ScrollText className="h-4 w-4" />} count={orders.length}>
          {orders.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No order attempts recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border/50 text-sm">
              {orders.map((o) => {
                const summary = summariseIntent(o.intent);
                return (
                  <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="font-medium">{summary}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {o.email} · {o.placedVia} · {fmtDate(o.createdAt)}
                        {o.error ? ` · ${o.error}` : ''}
                      </span>
                    </span>
                    <Badge tone={orderTone(o.status)}>{o.status}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface/80 shadow-glass">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3 text-sm font-semibold">
        <span className="text-muted-foreground">{icon}</span>
        {title}
        <span className="text-xs font-normal text-muted-foreground">· {count}</span>
      </div>
      {children}
    </section>
  );
}

function orderTone(status: string): 'bull' | 'bear' | 'warn' | 'muted' {
  if (status === 'placed' || status === 'modified' || status === 'exited') return 'bull';
  if (status === 'rejected') return 'bear';
  if (status === 'cancelled') return 'muted';
  return 'warn';
}

/** Compact one-line summary of a stored order intent (place or a modify/cancel descriptor). */
function summariseIntent(raw: string): string {
  try {
    const i = JSON.parse(raw) as Record<string, unknown>;
    if (i.action) return `${String(i.action)} ${String(i.brokerOrderId ?? '')}`.trim();
    const side = String(i.side ?? '').toUpperCase();
    const type = String(i.orderType ?? '').toUpperCase();
    return `${side} ${String(i.quantity ?? '')} ${String(i.symbol ?? '')} · ${type}`.trim();
  } catch {
    return 'order';
  }
}
