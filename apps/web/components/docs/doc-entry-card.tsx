import { PulseCodeBlock } from './pulse-code-block';
import type { DocEntry } from '@/features/docs/reference-types';

/** Anchor id from a function name, e.g. "ta.sma" → "sma", "draw line" → "draw-line". */
export function anchorId(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

/** One reference entry: signature header, summary, param table, and a runnable example. */
export function DocEntryCard({ name, entry }: { name: string; entry: DocEntry }) {
  return (
    <section id={anchorId(name)} className="scroll-mt-20 border-t border-border/60 py-5">
      <h3 className="flex items-baseline gap-2">
        <a href={`#${anchorId(name)}`} className="font-mono text-base font-semibold text-foreground hover:text-accent">
          {name}
        </a>
      </h3>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{entry.signature}</p>
      <p className="mt-2 text-sm text-muted-foreground">{entry.summary}</p>
      {entry.params.length > 0 ? (
        <table className="mt-3 w-full border-collapse text-xs">
          <tbody>
            {entry.params.map((p) => (
              <tr key={p.name} className="border-b border-border/40 align-top">
                <td className="py-1 pr-3 font-mono text-foreground">{p.name}</td>
                <td className="py-1 pr-3 font-mono text-muted-foreground">{p.type}</td>
                <td className="py-1 text-muted-foreground">{p.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="mt-2 text-xs text-muted-foreground">
        Returns: <span className="font-mono text-foreground">{entry.returns}</span>
      </p>
      <PulseCodeBlock code={entry.example} />
    </section>
  );
}
