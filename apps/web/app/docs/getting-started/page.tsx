import type { Metadata } from 'next';
import Link from 'next/link';
import { PulseCodeBlock } from '@/components/docs/pulse-code-block';
import { FIRST_SCRIPT, INPUTS } from '@/features/docs/samples';

export const metadata: Metadata = {
  title: 'Getting started',
  description: 'Your first PulseScript running on live candles in five minutes.',
};

export default function GettingStarted() {
  return (
    <article className="doc-prose space-y-4 text-sm leading-relaxed text-muted-foreground [&_h1]:text-foreground [&_h2]:text-foreground [&_strong]:text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight">Getting started</h1>
      <p>
        PulseScript runs inside the terminal — there is nothing to install. Every code block on these pages has a{' '}
        <strong>Run in terminal</strong> button that opens the editor with the script loaded.
      </p>

      <h2 className="pt-2 text-xl font-semibold">1 · Open the Script dock</h2>
      <p>
        Go to the <Link href="/terminal" className="text-accent hover:underline">terminal</Link> and press{' '}
        <strong>Script</strong> in the top bar. A docked editor opens under the chart with a sample strategy: press{' '}
        <strong>Run</strong> and its plots and buy/sell marks land on the live candles of the active pane.
      </p>

      <h2 className="pt-2 text-xl font-semibold">2 · Your first script</h2>
      <p>Replace the editor contents with this — the smallest useful study:</p>
      <PulseCodeBlock code={FIRST_SCRIPT} />
      <p>
        Line by line: <code>pulse 1</code> declares the language version. <code>meta(…)</code> names the study.{' '}
        <code>smooth = sma(close, 20)</code> computes a 20-bar average of the close on <em>every bar</em> — assignments are
        per-bar series, not single values. <code>draw line(…)</code> puts it on the chart.
      </p>

      <h2 className="pt-2 text-xl font-semibold">3 · Make it tunable</h2>
      <p>
        <code>input.*</code> declarations become real controls in the editor&rsquo;s Inputs panel — change a value and the script
        re-runs instantly:
      </p>
      <PulseCodeBlock code={INPUTS} />

      <h2 className="pt-2 text-xl font-semibold">4 · Save it, then use it everywhere</h2>
      <ul className="list-disc space-y-1.5 pl-5">
        <li><strong>Save</strong> in the dock header stores the script to your account.</li>
        <li><strong>Backtest</strong> trades the script&rsquo;s buy/sell marks over the last 1000 real candles — win rate, drawdown, equity curve, per-trade list.</li>
        <li><strong>Optimizer</strong> sweeps your <code>input.num</code> ranges MetaTrader-style and ranks the results honestly.</li>
        <li>The <strong>Scanner&rsquo;s Script mode</strong> runs a saved script across every symbol in the catalog — a symbol matches when your script signals on its last closed bar.</li>
      </ul>
      <p>
        Next: the <Link href="/docs/language" className="text-accent hover:underline">language tour</Link> covers everything —
        history reads, state, control flow, functions, and multi-timeframe.
      </p>
    </article>
  );
}
