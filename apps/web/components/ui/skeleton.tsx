import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shine rounded-md', className)} aria-hidden />;
}
