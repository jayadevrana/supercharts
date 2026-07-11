import type { Metadata } from 'next';
import { DocEntryCard } from '@/components/docs/doc-entry-card';
import { OUTPUT_DOCS } from '@/features/docs/reference/outputs';

export const metadata: Metadata = {
  title: 'Outputs reference',
  description: 'PulseScript outputs — draw, paint, mark, alert, onTf, and the nz/na helpers — with a runnable example each.',
};

export default function OutputReference() {
  return (
    <article className="doc-prose">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Outputs &amp; helpers</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        The constructs that put things on the chart or raise events. <code>mark buy</code>/<code>sell</code> are also
        what the backtester trades and the scanner matches on the last closed bar.
      </p>
      {Object.entries(OUTPUT_DOCS).map(([name, entry]) => (
        <DocEntryCard key={name} name={name} entry={entry} />
      ))}
    </article>
  );
}
