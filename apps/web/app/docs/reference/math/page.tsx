import type { Metadata } from 'next';
import { DocEntryCard } from '@/components/docs/doc-entry-card';
import { MATH_DOCS, MATH_CONST_DOCS } from '@/features/docs/reference/math';

export const metadata: Metadata = {
  title: 'math.* reference',
  description: 'PulseScript math helpers — abs, round, pow, trig, clamp, min/max and more — with a runnable example each, plus the pi/e/phi constants.',
};

export default function MathReference() {
  const entries = Object.entries(MATH_DOCS);
  return (
    <article className="doc-prose">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">math.* reference</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {entries.length} scalar helpers that apply per bar. They take numeric values (which can be per-bar series
        expressions like <code>close - open</code>) and return a number.
      </p>

      <h2 className="mt-6 text-xl font-semibold text-foreground">Constants</h2>
      <table className="mt-2 w-full border-collapse text-sm">
        <tbody>
          {MATH_CONST_DOCS.map((c) => (
            <tr key={c.name} className="border-b border-border/40 align-top">
              <td className="py-1.5 pr-3 font-mono text-foreground">{c.name}</td>
              <td className="py-1.5 pr-3 font-mono text-muted-foreground">{c.value}</td>
              <td className="py-1.5 text-muted-foreground">{c.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-8 text-xl font-semibold text-foreground">Functions</h2>
      {entries.map(([name, entry]) => (
        <DocEntryCard key={name} name={`math.${name}`} entry={entry} />
      ))}
    </article>
  );
}
