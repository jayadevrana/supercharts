'use client';

import { useEffect, useState } from 'react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, User, Lock, ShieldCheck } from 'lucide-react';
import { useSession } from '@/lib/auth';

const LINK_ERRORS: Record<string, string> = {
  google_in_use: 'That Google account is already linked to a different SuperCharts account.',
  google_denied: 'Google connection was cancelled.',
  google_userinfo: 'Could not read your Google profile — please try again.',
  google_failed: 'Connecting Google failed — please try again.',
};

function Banner({ tone, children }: { tone: 'ok' | 'err'; children: React.ReactNode }) {
  const cls =
    tone === 'ok'
      ? 'border-bull/40 bg-bull/10 text-bull'
      : 'border-bear/40 bg-bear/10 text-bear';
  return (
    <p className={`rounded-md border px-3 py-2 text-sm ${cls}`} role="alert">
      {children}
    </p>
  );
}

export default function AccountPage() {
  const { user, loading, hasPassword, providers, googleEnabled, refresh } = useSession();

  // Redirect out if not signed in (middleware also gates this route).
  useEffect(() => {
    if (!loading && !user) window.location.href = '/login';
  }, [loading, user]);

  // Surface the ?linked / ?error banners from the Google connect redirect.
  const [topBanner, setTopBanner] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('linked') === 'google') setTopBanner({ tone: 'ok', msg: 'Google account connected.' });
    else {
      const err = q.get('error');
      if (err) setTopBanner({ tone: 'err', msg: LINK_ERRORS[err] ?? 'Something went wrong — please try again.' });
    }
    if (q.has('linked') || q.has('error')) window.history.replaceState(null, '', '/account');
  }, []);

  if (loading || !user) {
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
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Account settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your profile, password, and connected sign-in methods.</p>
        {topBanner && <div className="mt-5">{<Banner tone={topBanner.tone}>{topBanner.msg}</Banner>}</div>}

        <ProfileCard />
        <SecurityCard hasPassword={hasPassword} onChanged={refresh} />
        <ConnectionsCard email={user.email} providers={providers} googleEnabled={googleEnabled} />
      </main>
      <SiteFooter />
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface/80 p-6 shadow-glass">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ProfileCard() {
  const { user, refresh } = useSession();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName }),
      });
      if (res.ok) {
        await refresh();
        setMsg({ tone: 'ok', text: 'Profile updated.' });
      } else {
        setMsg({ tone: 'err', text: 'Enter a name (1–80 characters).' });
      }
    } catch {
      setMsg({ tone: 'err', text: 'Network error — please try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Profile" icon={<User className="h-4 w-4" />}>
      <form className="space-y-4" onSubmit={save}>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Display name</span>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex Trader" className="mt-2" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Email</span>
          <Input value={user?.email ?? ''} disabled leftAdornment={<Mail className="h-4 w-4" />} className="mt-2 opacity-70" />
        </label>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </form>
    </Card>
  );
}

function SecurityCard({ hasPassword, onChanged }: { hasPassword: boolean; onChanged: () => Promise<void> }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) return setMsg({ tone: 'err', text: 'New password must be at least 8 characters.' });
    if (next !== confirm) return setMsg({ tone: 'err', text: 'New passwords do not match.' });
    setSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(hasPassword ? { currentPassword: current, newPassword: next } : { newPassword: next }),
      });
      if (res.ok) {
        setCurrent('');
        setNext('');
        setConfirm('');
        await onChanged();
        setMsg({ tone: 'ok', text: hasPassword ? 'Password changed.' : 'Password set — you can now sign in with email too.' });
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg({
          tone: 'err',
          text: body.error === 'wrong_current_password' ? 'Current password is incorrect.' : 'Could not update password.',
        });
      }
    } catch {
      setMsg({ tone: 'err', text: 'Network error — please try again.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={hasPassword ? 'Change password' : 'Set a password'} icon={<Lock className="h-4 w-4" />}>
      {!hasPassword && (
        <p className="mb-4 text-sm text-muted-foreground">
          You currently sign in with Google. Set a password to also sign in with your email.
        </p>
      )}
      <form className="space-y-4" onSubmit={submit}>
        {hasPassword && (
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Current password</span>
            <Input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="mt-2" />
          </label>
        )}
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">New password</span>
          <Input type="password" required value={next} onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters" className="mt-2" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Confirm new password</span>
          <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-2" />
        </label>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
        </Button>
      </form>
    </Card>
  );
}

function ConnectionsCard({
  email,
  providers,
  googleEnabled,
}: {
  email: string;
  providers: string[];
  googleEnabled: boolean;
}) {
  const googleLinked = providers.includes('google');
  return (
    <Card title="Connected sign-in methods" icon={<ShieldCheck className="h-4 w-4" />}>
      <ul className="space-y-3 text-sm">
        <li className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-3">
          <span className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" /> Email <span className="text-muted-foreground">· {email}</span>
          </span>
          <span className="text-xs text-muted-foreground">Active</span>
        </li>
        <li className="flex items-center justify-between rounded-lg border border-border/60 px-4 py-3">
          <span className="flex items-center gap-2">Google</span>
          {googleLinked ? (
            <span className="text-xs text-bull">Connected</span>
          ) : googleEnabled ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = '/api/auth/google/start?link=1';
              }}
            >
              Connect Google
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Not available</span>
          )}
        </li>
      </ul>
    </Card>
  );
}
