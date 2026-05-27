import { cn } from '@/lib/cn';

interface BrandMarkProps {
  className?: string;
  size?: number;
  withWordmark?: boolean;
}

export function BrandMark({ className, size = 28, withWordmark = true }: BrandMarkProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        aria-hidden="true"
        className="text-accent"
      >
        <defs>
          <linearGradient id="sc-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" />
            <stop offset="100%" stopColor="hsl(var(--bull))" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="8" fill="hsl(var(--surface-raised))" stroke="hsl(var(--border))" />
        <path
          d="M5 22 L11 16 L15 19 L21 11 L27 17"
          stroke="url(#sc-grad)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="21" cy="11" r="2.2" fill="hsl(var(--bull))" />
        <circle cx="11" cy="16" r="1.6" fill="hsl(var(--accent))" />
      </svg>
      {withWordmark ? (
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">SuperCharts</span>
          <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            order-flow terminal
          </span>
        </div>
      ) : null}
    </div>
  );
}
