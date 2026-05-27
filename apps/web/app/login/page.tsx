import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Lock } from 'lucide-react';

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="grid w-full max-w-5xl items-stretch gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div className="relative hidden lg:block">
            <div className="glass-panel h-full overflow-hidden p-1">
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <span>BTC / USDT · 1m</span>
                  <span className="text-bull">live</span>
                </div>
                <div className="flex-1 bg-gradient-to-b from-surface to-surface-sunken/40 p-5">
                  <h3 className="text-xl font-semibold">Welcome back to the terminal.</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your layouts, drawings, watchlists, and alerts are saved server-side and load instantly when you sign in.
                  </p>
                  <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                    <li>• Live tick stream resumes from where you left off.</li>
                    <li>• Heatmap intensity calibrated against your symbol history.</li>
                    <li>• Drawings rendered in chart space — survive any zoom or pan.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface/80 p-8 shadow-glass">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your credentials. Auth.js wiring lands in Phase 11 — for now the demo terminal is open to everyone.
            </p>
            <form className="mt-7 space-y-4" action="/terminal">
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
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Password
                  </span>
                  <Link href="#" className="text-xs text-muted-foreground hover:text-foreground">
                    Forgot?
                  </Link>
                </div>
                <Input
                  type="password"
                  placeholder="••••••••"
                  leftAdornment={<Lock className="h-4 w-4" />}
                  className="mt-2"
                />
              </label>
              <Button type="submit" className="w-full" size="lg">
                Continue to terminal
              </Button>
            </form>
            <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
              <Button variant="outline" size="sm" className="w-full">
                Google
              </Button>
              <Button variant="outline" size="sm" className="w-full">
                GitHub
              </Button>
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              New here?{' '}
              <Link href="/signup" className="text-accent hover:underline">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
