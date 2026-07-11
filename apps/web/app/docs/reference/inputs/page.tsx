import type { Metadata } from 'next';
import { DocEntryCard } from '@/components/docs/doc-entry-card';
import { INPUT_DOCS } from '@/features/docs/reference/inputs';

export const metadata: Metadata = {
  title: 'input.* reference',
  description: 'PulseScript inputs — num, source, bool, text, select, color — become controls in the editor’s Inputs panel. Runnable example each.',
};

export default function InputReference() {
  return (
    <article className="doc-prose">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">input.* reference</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Each <code>input.*</code> declaration renders a control in the editor’s Inputs panel; changing a value re-runs
        the script. The general shape is <code>input.&lt;kind&gt;(default, title?, …)</code>.
      </p>
      {Object.entries(INPUT_DOCS).map(([name, entry]) => (
        <DocEntryCard key={name} name={`input.${name}`} entry={entry} />
      ))}
    </article>
  );
}
