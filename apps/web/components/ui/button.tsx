'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-foreground hover:bg-accent/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_8px_22px_-12px_hsl(var(--accent)/0.7)]',
  secondary: 'bg-surface-raised text-foreground border border-border hover:border-accent/60 hover:bg-surface-raised/80',
  ghost: 'text-muted-foreground hover:bg-surface-raised hover:text-foreground',
  outline: 'border border-border bg-transparent hover:border-accent hover:text-foreground',
  danger: 'bg-bear/90 text-white hover:bg-bear',
  subtle: 'bg-muted text-foreground hover:bg-muted/80',
};

// Heights/font-sizes read the design-pack tokens (globals.css [data-design]);
// fallbacks are the classic values so no design attribute = unchanged.
const sizeClasses: Record<Size, string> = {
  xs: 'h-[var(--control-h-xs,1.75rem)] px-2.5 text-[length:var(--control-fs-xs,11px)]',
  sm: 'h-[var(--control-h-sm,2rem)] px-3 text-[length:var(--control-fs-sm,0.75rem)]',
  md: 'h-[var(--control-h-md,2.25rem)] px-4 text-[length:var(--control-fs-md,0.875rem)]',
  lg: 'h-[var(--control-h-lg,2.75rem)] px-6 text-[length:var(--control-fs-md,0.875rem)]',
  icon: 'h-[var(--control-h-sm,2rem)] w-[var(--control-h-sm,2rem)]',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 rounded-md font-medium tracking-tight transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
      ) : null}
      {children}
    </button>
  );
});
