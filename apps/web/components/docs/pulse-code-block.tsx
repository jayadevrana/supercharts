import Link from 'next/link';
import { Play } from 'lucide-react';
import { highlightPulse } from '@/features/docs/pulse-highlight';
import { CopyButton } from './copy-button';

/**
 * Docs code block: statically highlighted PulseScript (server-rendered, zero client JS for
 * the colors) + copy + a "Run in terminal" deep link that loads the snippet into the live
 * Script dock via `/terminal?pulse=<base64url>`.
 */
export function PulseCodeBlock({ code, runnable = true }: { code: string; runnable?: boolean }) {
  const encoded = Buffer.from(code, 'utf8').toString('base64url');
  return (
    <div className="pulse-code group relative my-4 overflow-hidden rounded-lg border border-border bg-surface-sunken">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">PulseScript</span>
        <div className="flex items-center gap-1">
          {runnable ? (
            <Link
              href={`/terminal?pulse=${encoded}`}
              title="Open the terminal with this script loaded in the editor"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/10"
            >
              <Play className="h-3 w-3" aria-hidden="true" /> Run in terminal
            </Link>
          ) : null}
          <CopyButton text={code} />
        </div>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[13px] leading-relaxed">
        <code>{highlightPulse(code.trimEnd())}</code>
      </pre>
    </div>
  );
}
