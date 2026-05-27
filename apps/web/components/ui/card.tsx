import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border border-border bg-surface/80 shadow-glass backdrop-blur',
        className,
      )}
      {...rest}
    />
  );
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} className={cn('flex flex-col gap-1.5 p-5 pb-3', className)} {...rest} />;
});

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(function CardTitle(
  { className, ...rest },
  ref,
) {
  return (
    <h3
      ref={ref}
      className={cn('text-base font-semibold tracking-tight text-foreground', className)}
      {...rest}
    />
  );
});

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...rest }, ref) {
    return <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...rest} />;
  },
);

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardContent(
  { className, ...rest },
  ref,
) {
  return <div ref={ref} className={cn('p-5 pt-2', className)} {...rest} />;
});

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardFooter(
  { className, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cn('flex items-center justify-between border-t border-border p-5 pt-4', className)} {...rest} />
  );
});
