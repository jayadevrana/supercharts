import type { Metadata } from 'next';
import { PulseCodeBlock } from '@/components/docs/pulse-code-block';
import { HERO } from '@/features/docs/samples';

export const metadata: Metadata = {
  title: 'Coming from Pine Script',
  description:
    'A migration guide for Pine Script users: how indicators, plots, ta.* functions, inputs, alerts, and higher-timeframe requests map onto PulseScript — plus the key differences (colon bodies, no-repaint multi-timeframe, one shared TA engine).',
};

const MAP: Array<{ task: string; pine: string; pulse: string }> = [
  { task: 'Declare an indicator', pine: 'indicator() / study()', pulse: 'meta(name: "…", overlay: true)' },
  { task: 'Plot a line', pine: 'plot(x)', pulse: 'draw line(x, title: "…")' },
  { task: 'Plot a histogram', pine: 'plot(x, style=histogram)', pulse: 'draw hist(x)' },
  { task: 'Fill between two series', pine: 'fill(a, b)', pulse: 'draw band(a, b)' },
  { task: 'Simple / exponential MA', pine: 'ta.sma / ta.ema', pulse: 'sma(close, 20) · ema(close, 20)' },
  { task: 'RSI / ATR', pine: 'ta.rsi / ta.atr', pulse: 'rsi(close, 14) · ta.atr(14)' },
  { task: 'Bollinger Bands', pine: 'ta.bb(...)', pulse: 'ta.bands(20, 2).upper / .mid / .lower' },
  { task: 'Cross up / down', pine: 'ta.crossover / crossunder', pulse: 'crossOver(a, b) · crossUnder(a, b)' },
  { task: 'Value N bars back', pine: 'x[1]', pulse: 'x[1]  (identical)' },
  { task: 'Persistent variable', pine: 'var x = …', pulse: 'persist x = …' },
  { task: 'Reassign a variable', pine: 'x := …', pulse: 'x = …  (bare assignment is mutable)' },
  { task: 'Numeric input', pine: 'input.int / input.float', pulse: 'input.num(14, "Length", 2, 50)' },
  { task: 'Higher timeframe', pine: 'request.security(...)', pulse: 'onTf("4h", expr)  (completed bars, no repaint)' },
  { task: 'Raise an alert', pine: 'alert() / alertcondition()', pulse: 'alert("…")' },
  { task: 'Signal marker', pine: 'plotshape()', pulse: 'mark buy at low "…"  ·  draw marker(...)' },
  { task: 'Colour the background', pine: 'bgcolor()', pulse: 'paint bg(rgba(…))' },
  { task: 'Colour the candles', pine: 'barcolor()', pulse: 'paint candles(color)' },
];

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 pt-4 text-xl font-semibold text-foreground">
      {children}
    </h2>
  );
}

export default function FromPine() {
  return (
    <article className="doc-prose space-y-4 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Coming from Pine Script</h1>
      <p className="max-w-2xl">
        PulseScript is an <strong>original language</strong>, not a Pine dialect — the structure keywords
        (<code>meta</code>, <code>let</code>, <code>persist</code>, <code>when</code>, <code>draw</code>, <code>mark</code>) are
        ours. But the <em>trading concepts</em> map almost one-to-one, and the universal vocabulary you already know
        (<code>close</code>, <code>sma</code>, <code>rsi</code>) is the same. If you&rsquo;ve written a Pine study, you&rsquo;ll
        be productive here in minutes.
      </p>

      <H2 id="cheatsheet">Cheat sheet</H2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-sunken text-left text-muted-foreground">
              <th className="px-3 py-2 font-semibold">What you want</th>
              <th className="px-3 py-2 font-semibold">In Pine</th>
              <th className="px-3 py-2 font-semibold text-foreground">In PulseScript</th>
            </tr>
          </thead>
          <tbody>
            {MAP.map((row) => (
              <tr key={row.task} className="border-b border-border/50 last:border-0">
                <td className="px-3 py-2">{row.task}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{row.pine}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-foreground">{row.pulse}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="example">The same study, in PulseScript</H2>
      <p>
        A fast/slow EMA cross with markers — the &ldquo;hello world&rdquo; of chart scripts. Note the low-boilerplate colon form
        and that <code>meta(...)</code> replaces the indicator declaration.
      </p>
      <PulseCodeBlock code={HERO} />

      <H2 id="differences">Key differences worth knowing</H2>
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          <strong>Low-indent colon bodies.</strong> A single-statement branch fits on one line —{' '}
          <code>when crossOver(fast, slow): mark buy</code> — no braces needed. Use <code>{'{ }'}</code> for multi-statement blocks.
        </li>
        <li>
          <strong>No <code>let</code> required.</strong> A bare <code>x = expr</code> declares a mutable per-bar series
          (Python-style). <code>let</code> adds reassignment protection; <code>persist</code> is the cross-bar state primitive
          (initialised once, carried forward).
        </li>
        <li>
          <strong>Booleans only drive conditions.</strong> <code>1</code> is not <code>true</code> — comparisons and logical ops
          return real booleans, which catches a whole class of silent bugs.
        </li>
        <li>
          <strong>Multi-timeframe never repaints.</strong> <code>onTf(&quot;4h&quot;, …)</code> maps only{' '}
          <em>completed</em> higher-timeframe bars onto the chart — stricter than the common default, so a backtest can&rsquo;t
          use data that didn&rsquo;t exist yet.
        </li>
        <li>
          <strong>One TA engine.</strong> <code>ta.*</code> is the exact implementation the chart indicators, the backtester, the
          scanner, and the alert engine use — a script and the chart can never disagree.
        </li>
        <li>
          <strong>Sandboxed by construction.</strong> No network requests, no drawing-object bookkeeping to leak; runaway loops
          and slow scripts abort with a line-numbered error. Runs are deterministic — no randomness, no wall clock.
        </li>
      </ul>

      <H2 id="gotchas">Two quick gotchas</H2>
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          <strong>Warmup is <code>none</code>.</strong> Before an indicator has enough bars its value is <code>none</code> (Pine&rsquo;s{' '}
          <code>na</code>). It propagates through math and compares false — wrap with <code>nz(x, fallback)</code> or test{' '}
          <code>na(x)</code>.
        </li>
        <li>
          <strong>Multi-output studies return records.</strong> Instead of tuple destructuring, read fields:{' '}
          <code>b = ta.bands(20, 2)</code> then <code>b.upper</code>, <code>b.lower</code>, <code>b.mid</code>.
        </li>
      </ul>

      <p className="pt-2 text-xs">
        Next: browse the{' '}
        <a href="/docs/cookbook" className="text-accent hover:underline">
          cookbook
        </a>{' '}
        for ready-to-run strategies, or the{' '}
        <a href="/docs/reference/ta" className="text-accent hover:underline">
          ta.* reference
        </a>{' '}
        for every function.
      </p>
    </article>
  );
}
