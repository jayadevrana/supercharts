import type { IndicatorInstance } from '@supercharts/types';
import type { IndicatorSpec } from '@supercharts/indicators';

/**
 * Pure helpers for the right-rail indicator manager (Mission M4a): multi-instance naming and
 * reordering. Kept out of the component so they're unit-testable.
 */

/**
 * Display name for a NEW instance of `spec`, numbered when repeats exist:
 * first → "Exponential Moving Average", then " 2", " 3", … so duplicates stay distinguishable.
 */
export function nextIndicatorName(existing: IndicatorInstance[], spec: IndicatorSpec): string {
  const count = existing.filter((i) => i.type === spec.type).length;
  return count === 0 ? spec.label : `${spec.label} ${count + 1}`;
}

/** Move the instance with `id` one slot toward the start (`up`) or end (`down`). Returns a new array. */
export function reorderInstances(
  list: IndicatorInstance[],
  id: string,
  dir: 'up' | 'down',
): IndicatorInstance[] {
  const idx = list.findIndex((i) => i.id === id);
  if (idx < 0) return list;
  const target = dir === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[idx], next[target]] = [next[target]!, next[idx]!];
  return next;
}
