'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describeCondition, describeAction } from '@/lib/strategy-describe';
import type { SignalCondition, SignalAction, IndicatorInstance } from '@supercharts/types';
import { ArrowUpRight, ArrowDownRight, ShieldAlert, Gauge, Share2, Loader2 } from 'lucide-react';

interface SharedStrategy {
  name: string;
  symbol: string;
  interval: string;
  logic: 'all' | 'any';
  conditions: SignalCondition[];
  actions: SignalAction[];
  indicatorSpecs: IndicatorInstance[];
  maxTradesPerDay?: number;
  maxDailyDrawdownPercent?: number;
}

export default function SharedStrategyPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [data, setData] = useState<{ strategy: SharedStrategy; sharedAt: number } | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`/api/public/strategy/${token}`)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setState('notfound');
          return;
        }
        setData(await r.json());
        setState('ok');
      })
      .catch(() => !cancelled && setState('notfound'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <div className="container max-w-2xl py-12">
          {state === 'loading' ? (
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading strategy…
            </div>
          ) : state === 'notfound' ? (
            <div className="rounded-xl border border-border bg-surface p-12 text-center">
              <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground/60" />
              <h1 className="mt-4 text-lg font-semibold">Strategy not found</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                This share link is invalid or has been revoked by its owner.
              </p>
              <Link href="/" className="mt-6 inline-block">
                <Button>Go to SuperCharts</Button>
              </Link>
            </div>
          ) : data ? (
            <StrategyCard strategy={data.strategy} sharedAt={data.sharedAt} />
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function StrategyCard({ strategy, sharedAt }: { strategy: SharedStrategy; sharedAt: number }) {
  const specs = strategy.indicatorSpecs ?? [];
  const date = new Date(sharedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <Share2 className="h-3.5 w-3.5" /> Shared strategy
        </div>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">{strategy.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{strategy.symbol}</Badge>
          <Badge tone="muted">{strategy.interval}</Badge>
          <span className="text-xs text-muted-foreground">Published {date}</span>
        </div>
      </header>

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Entry conditions</h2>
          <Badge tone="muted" className="text-[10px] uppercase">
            Match {strategy.logic === 'all' ? 'ALL' : 'ANY'}
          </Badge>
        </div>
        <ol className="mt-3 flex flex-col gap-2">
          {strategy.conditions.length === 0 ? (
            <li className="text-sm text-muted-foreground">No conditions defined.</li>
          ) : (
            strategy.conditions.map((c, i) => (
              <li key={i} className="flex items-start gap-3 rounded-md border border-border/60 bg-surface-raised px-3 py-2">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent">
                  {i + 1}
                </span>
                <span className="text-sm text-foreground">{describeCondition(c, specs)}</span>
              </li>
            ))
          )}
        </ol>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Actions</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {strategy.actions.map((a, i) => {
            const isBuy = a.type === 'open_position' && a.side === 'buy';
            const isSell = a.type === 'open_position' && a.side === 'sell';
            return (
              <li key={i} className="flex items-center gap-3 rounded-md border border-border/60 bg-surface-raised px-3 py-2">
                {isBuy ? (
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-bull" />
                ) : isSell ? (
                  <ArrowDownRight className="h-4 w-4 shrink-0 text-bear" />
                ) : (
                  <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="text-sm text-foreground">{describeAction(a)}</span>
              </li>
            );
          })}
        </ul>
        {(strategy.maxTradesPerDay != null || strategy.maxDailyDrawdownPercent != null) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            {strategy.maxTradesPerDay != null ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-raised px-2 py-1">
                <Gauge className="h-3.5 w-3.5" /> Max {strategy.maxTradesPerDay} trades/day
              </span>
            ) : null}
            {strategy.maxDailyDrawdownPercent != null ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-raised px-2 py-1">
                <ShieldAlert className="h-3.5 w-3.5" /> Halt at −{strategy.maxDailyDrawdownPercent}% daily
              </span>
            ) : null}
          </div>
        )}
      </section>

      <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-5 text-center">
        <p className="text-sm font-medium text-foreground">Build and backtest your own strategies</p>
        <p className="mt-1 text-xs text-muted-foreground">
          SuperCharts is an institutional-grade charting terminal with a visual strategy builder, backtester, and live alerts.
        </p>
        <Link href="/signup" className="mt-4 inline-block">
          <Button>Start on SuperCharts</Button>
        </Link>
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        This is a read-only view of a strategy someone shared. No account or broker details are included.
      </p>
    </div>
  );
}
