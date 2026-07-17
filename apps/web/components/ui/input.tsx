'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  rightAdornment?: React.ReactNode;
  leftAdornment?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leftAdornment, rightAdornment, ...rest },
  ref,
) {
  return (
    <div
      className={cn(
        'group relative flex items-center rounded-md border border-border bg-surface-sunken px-3 transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/60',
        className,
      )}
    >
      {leftAdornment ? <div className="mr-2 text-muted-foreground">{leftAdornment}</div> : null}
      <input
        ref={ref}
        className="h-[var(--control-h-md,2.25rem)] flex-1 bg-transparent text-[length:var(--control-fs-md,0.875rem)] placeholder:text-muted-foreground/70 focus:outline-none"
        {...rest}
      />
      {rightAdornment ? <div className="ml-2 text-muted-foreground">{rightAdornment}</div> : null}
    </div>
  );
});
