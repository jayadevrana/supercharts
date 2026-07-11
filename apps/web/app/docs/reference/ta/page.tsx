import type { Metadata } from 'next';
import { DocEntryCard, anchorId } from '@/components/docs/doc-entry-card';
import { TA_DOCS, type TaDocEntry } from '@/features/docs/reference/ta';

export const metadata: Metadata = {
  title: 'ta.* reference',
  description: 'Every technical-analysis function in PulseScript — moving averages, oscillators, event helpers, candle studies, and multi-output records — with a runnable example each.',
};

const GROUPS: Array<{ key: TaDocEntry['group']; title: string; blurb: string }> = [
  { key: 'ma', title: 'Moving averages', blurb: 'Smoothers over an arbitrary series.' },
  { key: 'stat', title: 'Oscillators & statistics', blurb: 'Momentum, dispersion, and rolling stats.' },
  { key: 'event', title: 'Events & state', blurb: 'Crosses, trends, pivots, and “bars since”.' },
  { key: 'candle', title: 'Candle studies', blurb: 'Read OHLCV directly (ATR, VWAP, CCI, …).' },
  { key: 'record', title: 'Multi-output studies', blurb: 'Return a record — access fields like ta.bands(20, 2).upper.' },
];

export default function TaReference() {
  const entries = Object.entries(TA_DOCS) as Array<[string, TaDocEntry]>;
  const total = entries.length;
  return (
    <article className="doc-prose">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">ta.* reference</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {total} technical functions. Each is also callable bare — <code>ema(close, 12)</code> is the same as{' '}
        <code>ta.ema(close, 12)</code>. Every example runs; click <strong>Run in terminal</strong> to try it live.
      </p>

      {GROUPS.map((g) => {
        const rows = entries.filter(([, e]) => e.group === g.key);
        return (
          <div key={g.key} className="mt-8">
            <h2 id={g.key} className="scroll-mt-20 text-xl font-semibold text-foreground">{g.title}</h2>
            <p className="text-sm text-muted-foreground">{g.blurb}</p>
            <nav aria-label={g.title} className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs">
              {rows.map(([name]) => (
                <a key={name} href={`#${anchorId('ta.' + name)}`} className="font-mono text-accent hover:underline">
                  {name}
                </a>
              ))}
            </nav>
            {rows.map(([name, entry]) => (
              <DocEntryCard key={name} name={`ta.${name}`} entry={entry} />
            ))}
          </div>
        );
      })}
    </article>
  );
}
