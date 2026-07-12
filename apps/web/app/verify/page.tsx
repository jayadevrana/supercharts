'use client';

import { useEffect, useState } from 'react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MailCheck } from 'lucide-react';
import { useSession } from '@/lib/auth';

const VERIFY_ERRORS: Record<string, string> = {
  wrong_code: 'That code is incorrect.',
  invalid_code: 'Enter the 6-digit code from your email.',
  code_expired: 'That code has expired — request a new one.',
  too_many_attempts: 'Too many attempts — request a new code.',
};

export default function VerifyPage() {
  const { user, loading, signOut, refresh } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  // Gate: no session → login; already verified → terminal.
  useEffect(() => {
    if (loading) return;
    if (!user) window.location.href = '/login';
    else if (user.emailVerified) window.location.href = '/terminal';
  }, [loading, user]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: code.trim() }),
      });
      if (res.ok) {
        await refresh();
        window.location.href = '/terminal';
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(VERIFY_ERRORS[body.error ?? ''] ?? 'Could not verify — please try again.');
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST', credentials: 'include' });
      if (res.ok) {
        setNotice('A new code is on its way.');
        setResendIn(45);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === 'cooldown') setResendIn(45);
        setError(body.error === 'email_not_configured' ? 'Email sending is not configured yet.' : 'Could not resend — try again shortly.');
      }
    } catch {
      setError('Network error — please try again.');
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface/80 p-8 shadow-glass">
          <div className="flex items-center gap-2">
            <MailCheck className="h-5 w-5 text-accent" />
            <h1 className="text-2xl font-semibold tracking-tight">Verify your email</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a 6-digit code to {user?.email ? <span className="text-foreground">{user.email}</span> : 'your email'}. Enter it below to unlock the terminal.
          </p>
          {error && <p className="mt-4 rounded-md border border-bear/40 bg-bear/10 px-3 py-2 text-sm text-bear" role="alert">{error}</p>}
          {notice && <p className="mt-4 rounded-md border border-bull/40 bg-bull/10 px-3 py-2 text-sm text-bull">{notice}</p>}
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className="text-center text-2xl tracking-[0.5em]"
            />
            <Button type="submit" className="w-full" size="lg" disabled={submitting || code.length !== 6}>
              {submitting ? 'Verifying…' : 'Verify & continue'}
            </Button>
          </form>
          <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
            <button
              type="button"
              onClick={resend}
              disabled={resendIn > 0}
              className="hover:text-foreground disabled:opacity-50"
            >
              {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
            </button>
            <button type="button" onClick={() => void signOut()} className="hover:text-foreground">
              Use a different account
            </button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
