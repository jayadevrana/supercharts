'use client';

import { useToastStore, type ToastItem } from './use-toast';
import { cn } from '@/lib/cn';
import { Check, X, AlertTriangle, Info } from 'lucide-react';

export function Toaster() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <ToastCard key={t.id} t={t} onClose={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ t, onClose }: { t: ToastItem; onClose: () => void }) {
  const iconMap = {
    success: <Check className="h-4 w-4 text-bull" />,
    error: <AlertTriangle className="h-4 w-4 text-bear" />,
    warn: <AlertTriangle className="h-4 w-4 text-warn" />,
    default: <Info className="h-4 w-4 text-accent" />,
  } as const;
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-surface-raised/95 p-3 shadow-floating backdrop-blur',
        'animate-slide-up',
      )}
    >
      <span className="mt-0.5 shrink-0">{iconMap[t.tone ?? 'default']}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{t.title}</div>
        {t.description ? (
          <div className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{t.description}</div>
        ) : null}
      </div>
      <button
        onClick={onClose}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
