import type { Metadata } from 'next';
import { PulseCodeBlock } from '@/components/docs/pulse-code-block';
import { CONTROL_FLOW, DECLARATIONS, FUNCTIONS, HISTORY, MTF, PERSIST_STATE } from '@/features/docs/samples';

export const metadata: Metadata = {
  title: 'Language tour',
  description: 'The complete PulseScript language: series, history, declarations, control flow, functions, inputs, outputs, multi-timeframe.',
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 pt-4 text-xl font-semibold text-foreground">
      <a href={`#${id}`} className="hover:text-accent">{children}</a>
    </h2>
  );
}

const TOC = [
  ['execution', 'Execution model'],
  ['syntax', 'Syntax'],
  ['history', 'Series & history'],
  ['declarations', 'Declarations & state'],
  ['control', 'Control flow'],
  ['functions', 'Functions'],
  ['builtins', 'Built-in series & context'],
  ['outputs', 'Outputs'],
  ['mtf', 'Multi-timeframe'],
  ['safety', 'Safety & limits'],
] as const;

export default function LanguageTour() {
  return (
    <article className="doc-prose space-y-4 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Language tour</h1>
      <nav aria-label="On this page" className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {TOC.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="text-accent hover:underline">{label}</a>
        ))}
      </nav>

      <H2 id="execution">Execution model</H2>
      <p>
        The script body runs <strong>once per bar</strong>, oldest → newest, over the pane&rsquo;s real candles. A bare series
        name (<code>close</code>) is the current bar&rsquo;s value; outputs capture each bar&rsquo;s contribution and the chart
        assembles the full series afterwards. There is <strong>no look-ahead anywhere</strong> — every built-in is causal.
      </p>

      <H2 id="syntax">Syntax</H2>
      <ul className="list-disc space-y-1.5 pl-5">
        <li><code>pulse 1</code> — optional version header on the first line (unknown versions fail loudly).</li>
        <li><code>#</code> starts a line comment. Newlines separate statements; expressions inside <code>(…)</code>/<code>[…]</code> wrap freely.</li>
        <li>Blocks use <code>{'{ }'}</code>, or the low-indent colon form — <code>when cond: mark buy</code> — one statement on the same line.</li>
        <li>Strings use double quotes; <code>meta(name: &quot;My Study&quot;, overlay: true)</code> declares the script.</li>
        <li>Named call arguments use <code>name:</code> — <code>draw line(fast, color: &quot;#38bdf8&quot;, title: &quot;Fast&quot;)</code>.</li>
      </ul>

      <H2 id="history">Series &amp; history</H2>
      <p>
        <code>expr[n]</code> is the history operator: the value of any expression <code>n</code> bars back. Out-of-range history
        is <code>none</code>, which propagates through arithmetic and compares false — use <code>nz(x, fallback)</code> and{' '}
        <code>na(x)</code> to handle warmup.
      </p>
      <PulseCodeBlock code={HISTORY} />

      <H2 id="declarations">Declarations &amp; state</H2>
      <p>
        Bare assignment declares a per-bar series. <code>let</code> makes it reassignment-protected. <code>persist</code> is the
        state primitive: initialised once, carrying its value across bars — counters, trailing stops, regime flags.
      </p>
      <PulseCodeBlock code={DECLARATIONS} />

      <H2 id="control">Control flow</H2>
      <p>
        <code>if / else if / else</code> branches; <code>when</code> is the event-style if (no else); <code>for i = a to b</code>,{' '}
        <code>for v in list</code>, and <code>while</code> loop with hard runaway guards; <code>? :</code> is the ternary. Only
        real booleans drive conditions — <code>1</code> is not <code>true</code>.
      </p>
      <PulseCodeBlock code={CONTROL_FLOW} />

      <H2 id="functions">Functions</H2>
      <PulseCodeBlock code={FUNCTIONS} />

      <H2 id="builtins">Built-in series &amp; context</H2>
      <p>
        Price series: <code>open high low close volume hl2 hlc3 ohlc4 hlcc4</code>. Bar context: <code>time barIndex barCount
        lastBarIndex isFirstBar isLastBar</code>, plus UTC clock fields <code>year month day weekday hour minute second</code>.
        The TA library (<code>sma ema rsi atr vwap …</code> and 60+ <code>ta.*</code> functions, many returning multi-field
        records like <code>ta.bands(20, 2).upper</code>) reuses the exact implementations the chart indicators use. See the{' '}
        <a href="/docs/reference/ta" className="text-accent hover:underline">ta.* reference</a> for every function with a runnable
        example, and the <a href="/docs/cookbook" className="text-accent hover:underline">cookbook</a> for full strategies.
      </p>

      <H2 id="outputs">Outputs</H2>
      <p>
        <code>draw line/area/steps/dots/hist/band/level/marker</code> plot on the chart; <code>mark buy/sell/note</code> drop
        signal markers (they are also what the backtester trades and the scanner matches); <code>paint bg(…)</code> and{' '}
        <code>paint candles(…)</code> tint bars; <code>alert(&quot;…&quot;)</code> raises alert events.
      </p>
      <PulseCodeBlock code={PERSIST_STATE} />

      <H2 id="mtf">Multi-timeframe</H2>
      <p>
        <code>onTf(tf, expr)</code> evaluates an expression on a higher timeframe and maps back only{' '}
        <strong>completed</strong> HTF bars — the strict no-repaint choice: a 4h value never changes mid-bucket.
      </p>
      <PulseCodeBlock code={MTF} />

      <H2 id="safety">Safety &amp; limits</H2>
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Wall-clock budget (2s on the chart) and loop caps abort runaway scripts with a line-numbered error.</li>
        <li>No host access: no network, no page, no globals — unknown identifiers fail loudly.</li>
        <li>Assigning to a built-in name (<code>close = 5</code>) errors with guidance instead of silently shadowing.</li>
        <li>No randomness, no wall clock: runs are reproducible by construction.</li>
      </ul>
    </article>
  );
}
