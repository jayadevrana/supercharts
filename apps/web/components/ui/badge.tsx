import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'accent' | 'bull' | 'bear' | 'warn' | 'muted';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

const toneMap: Record<Tone, string> = {
  neutral: 'border-border bg-surface-raised text-foreground',
  accent: 'border-accent/40 bg-accent/15 text-accent',
  bull: 'border-bull/40 bg-bull/12 text-bull',
  bear: 'border-bear/40 bg-bear/12 text-bear',
  warn: 'border-warn/40 bg-warn/15 text-warn',
  muted: 'border-border bg-surface-sunken text-muted-foreground',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, tone = 'neutral', ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em]',
        toneMap[tone],
        className,
      )}
      {...rest}
    />
  );
});
