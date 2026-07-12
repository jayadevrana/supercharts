import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BookOpen, ChefHat, Rocket, Zap } from 'lucide-react';
import { PulseCodeBlock } from '@/components/docs/pulse-code-block';
import { HERO } from '@/features/docs/samples';

export const metadata: Metadata = {
  title: 'Overview',
  description: 'PulseScript — SuperCharts’ original chart-scripting language. Write, backtest, alert.',
};

const CARDS = [
  {
    href: '/docs/getting-started',
    icon: Rocket,
    title: 'Getting started',
    body: 'Your first script running on live candles in five minutes — no setup, the editor is in the terminal.',
  },
  {
    href: '/docs/language',
    icon: BookOpen,
    title: 'Language tour',
    body: 'The whole language: series, history, declarations, control flow, functions, inputs, outputs, multi-timeframe.',
  },
  {
    href: '/docs/cookbook',
    icon: ChefHat,
    title: 'Cookbook',
    body: 'Copy-paste recipes for real strategies — MA-cross filters, SuperTrend, breakouts, momentum, volume-spike alerts, HTF gates.',
  },
  {
    href: '/terminal',
    icon: Zap,
    title: 'Open the terminal',
    body: 'PulseScript lives in the Script dock: write, run on live data, backtest, optimize, and scan the whole market with it.',
  },
];

export default function DocsOverview() {
  return (
    <article className="doc-prose">
      <h1 className="text-3xl font-semibold tracking-tight">PulseScript</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        PulseScript is SuperCharts&rsquo; original chart-scripting language. It runs bar-by-bar over real candles with{' '}
        <strong className="text-foreground">no look-ahead anywhere</strong> — every built-in is causal and multi-timeframe reads
        only ever see completed bars, so what you backtest is what fires live. One script can draw on the chart, backtest itself,
        power the market scanner, and (soon) arm a live Telegram alert.
      </p>

      <PulseCodeBlock code={HERO} />

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/40 hover:bg-surface-raised"
          >
            <c.icon className="h-4 w-4 text-accent" aria-hidden="true" />
            <div className="mt-2 flex items-center gap-1 text-sm font-semibold">
              {c.title}
              <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{c.body}</p>
          </Link>
        ))}
      </div>

      <h2 className="mt-10 text-xl font-semibold">Design guarantees</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <strong className="text-foreground">Deterministic.</strong> Same script + same candles = same output, always. There is
          no randomness and no wall-clock access inside a run.
        </li>
        <li>
          <strong className="text-foreground">No repaint.</strong> <code>onTf(&quot;4h&quot;, …)</code> maps only{' '}
          <em>completed</em> higher-timeframe bars onto the chart — stricter than most platforms&rsquo; defaults.
        </li>
        <li>
          <strong className="text-foreground">Sandboxed.</strong> Scripts cannot reach the network, the page, or your account:
          runaway loops and slow scripts abort with a line-numbered error.
        </li>
        <li>
          <strong className="text-foreground">One TA engine.</strong> <code>ta.*</code> reuses the exact indicator implementations
          the chart, the alerts, and the backtester use — a script and the chart can never disagree.
        </li>
      </ul>
    </article>
  );
}
