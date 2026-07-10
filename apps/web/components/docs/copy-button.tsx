'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Tiny client island: copy a code sample to the clipboard with visible confirmation. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={copied ? 'Copied' : 'Copy code'}
      title={copied ? 'Copied' : 'Copy code'}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-bull" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );
}
