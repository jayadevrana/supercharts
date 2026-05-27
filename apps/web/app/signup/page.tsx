import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Lock, User } from 'lucide-react';

export default function SignupPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface/80 p-8 shadow-glass">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Free to try with live Binance market data. Add a plan when you're ready to save layouts and run alerts.
          </p>
          <form className="mt-6 space-y-4" action="/terminal">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Display name</span>
              <Input placeholder="Alex Trader" leftAdornment={<User className="h-4 w-4" />} className="mt-2" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Email</span>
              <Input
                type="email"
                placeholder="trader@example.com"
                leftAdornment={<Mail className="h-4 w-4" />}
                className="mt-2"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Password</span>
              <Input
                type="password"
                placeholder="••••••••"
                leftAdornment={<Lock className="h-4 w-4" />}
                className="mt-2"
              />
            </label>
            <Button type="submit" className="w-full" size="lg">
              Create account
            </Button>
          </form>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            By signing up you agree to our{' '}
            <Link href="/legal/terms" className="text-foreground hover:underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/legal/privacy" className="text-foreground hover:underline">
              Privacy
            </Link>
            .
          </p>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-accent hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
