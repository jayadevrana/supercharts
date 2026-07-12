import type { Metadata } from 'next';
import { PulseCodeBlock } from '@/components/docs/pulse-code-block';
import { HERO } from '@/features/docs/samples';

export const metadata: Metadata = {
  title: 'Backtesting & optimization',
  description:
    'Turn a strategy into evidence: backtest it on real candles for win rate, return, max drawdown, Sharpe and profit factor; grid-optimize its parameters; validate out-of-sample with walk-forward; and forward-test on paper.',
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 pt-4 text-xl font-semibold text-foreground">
      {children}
    </h2>
  );
}

export default function Backtesting() {
  return (
    <article className="doc-prose space-y-4 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Backtesting &amp; optimization</h1>
      <p className="max-w-2xl">
        A signal is only worth trading if it survives its own history. SuperCharts evaluates a strategy on real candles and
        reports the numbers that matter, then helps you tune and stress-test it — all in the terminal, no export step.
      </p>

      <H2 id="how">How it fits together</H2>
      <p>
        A strategy in SuperCharts is a set of <strong>entry/exit signals</strong>. You build one in the Strategy Builder or as an
        MA-cross alert, and the same <code>mark buy</code> / <code>mark sell</code> events a PulseScript study emits are what the
        engine trades. From there:
      </p>
      <ul className="list-disc space-y-1.5 pl-5">
        <li><strong>Backtest</strong> — replay the signals over history and score the result.</li>
        <li><strong>Optimize</strong> — sweep the parameters to find the robust settings, not just the lucky ones.</li>
        <li><strong>Walk-forward</strong> — confirm those settings hold on data they were never fit to.</li>
        <li><strong>Paper-trade</strong> — forward-test live before risking capital, then arm the alert or MT5 automation.</li>
      </ul>

      <H2 id="metrics">What the backtest reports</H2>
      <p>Every run returns the full scorecard:</p>
      <ul className="list-disc space-y-1.5 pl-5">
        <li><strong>Trades</strong> — how many round-trips the signal produced (too few and nothing else is significant).</li>
        <li><strong>Win rate</strong> — share of trades closed in profit.</li>
        <li><strong>Total return</strong> — cumulative result over the tested window.</li>
        <li><strong>Max drawdown</strong> — the deepest peak-to-trough dip; your worst-case pain.</li>
        <li><strong>Sharpe ratio</strong> — return per unit of volatility; the headline risk-adjusted number.</li>
        <li><strong>Profit factor</strong> — gross profit ÷ gross loss; above 1 is net-positive.</li>
      </ul>
      <p className="text-xs">
        The v1 engine models signal-to-signal trades without stop-loss, take-profit, or fees — read the numbers as the raw edge of
        the signal itself, then layer risk management on top.
      </p>

      <H2 id="optimize">Optimizing parameters</H2>
      <p>
        The optimizer runs a <strong>grid sweep</strong> across a parameter&rsquo;s range (e.g. fast/slow MA lengths) and ranks
        every combination by a robustness score — <strong>Sharpe minus a drawdown penalty</strong> — so a jumpy setting with a
        great return but a brutal drawdown loses to a steadier one. Apply the winner and it writes straight back into the
        strategy&rsquo;s config.
      </p>

      <H2 id="walk-forward">Walk-forward validation</H2>
      <p>
        A great backtest is easy to overfit. Walk-forward splits history into rolling <strong>train / test</strong> windows,
        optimizes on the train slice, then measures only the <strong>out-of-sample</strong> test slice — the honest estimate of
        how the strategy behaves on data it never saw. A strategy whose in-sample edge evaporates out-of-sample is a curve fit,
        not an edge.
      </p>

      <H2 id="script">Starting from a script</H2>
      <p>
        Any study that emits signals is a strategy. Write it in PulseScript, watch the markers on the chart, then run it across the
        whole market with the <a href="/docs/cookbook" className="text-accent hover:underline">scanner</a> and turn the promising
        ones into alerts to backtest and optimize:
      </p>
      <PulseCodeBlock code={HERO} />

      <p className="pt-2 text-xs">
        Open the <a href="/terminal" className="text-accent hover:underline">terminal</a> and find these under the Strategy Builder
        and an alert&rsquo;s Backtest / Optimize / Walk-forward actions.
      </p>
    </article>
  );
}
