/**
 * Plan model for BYOB broker access (spec §2, §3.3, §4 GW-4).
 *
 * $15/mo Pro is THE plan and activation is MANUAL: the owner flips `users.plan` from the /admin
 * panel (no payment gateway yet). These are the two pure decisions that back that model — kept
 * DB-free so both the auth guard (`requirePro`) and the admin plan-toggle route share one tested
 * implementation. `role='admin'` always has access (the owner never locks themselves out).
 */

export type PlanTier = 'free' | 'pro';

export interface PlanState {
  role?: string;
  /** Stored `users.plan`; a missing/legacy value is treated as free. */
  plan?: string | null;
  /** Epoch ms; null/absent = no expiry (lifetime Pro). */
  planExpiresAt?: number | null;
}

export interface PlanAccess {
  allowed: boolean;
  tier: PlanTier;
  reason: 'admin' | 'active' | 'expired' | 'free';
}

/**
 * Decide whether a user may use the plan-gated broker surface (connect + trading + broker charts).
 * Admins bypass entirely; a Pro plan is active until its (optional) expiry; free is denied.
 */
export function resolvePlanAccess(state: PlanState, now: number): PlanAccess {
  if (state.role === 'admin') return { allowed: true, tier: 'pro', reason: 'admin' };
  const tier: PlanTier = state.plan === 'pro' ? 'pro' : 'free';
  if (tier !== 'pro') return { allowed: false, tier: 'free', reason: 'free' };
  // Boundary counts as expired: an expiry at exactly `now` is no longer active.
  if (state.planExpiresAt != null && state.planExpiresAt <= now) {
    return { allowed: false, tier: 'pro', reason: 'expired' };
  }
  return { allowed: true, tier: 'pro', reason: 'active' };
}

export interface PlanUpdateInput {
  plan: PlanTier;
  /** Convenience: activate Pro for N days from `now` (admin quick-buttons). */
  durationDays?: number;
  /** Explicit epoch-ms expiry; wins over durationDays when both are absent-of-conflict. */
  expiresAt?: number | null;
}

/**
 * Normalise an admin plan change into the `(plan, plan_expires_at)` columns to write.
 * Free always clears the expiry. Pro: durationDays → now+days; else explicit expiresAt; else
 * lifetime (null). Kept pure so the admin route's DB write is a thin wrapper.
 */
export function resolvePlanUpdate(input: PlanUpdateInput, now: number): { plan: PlanTier; expiresAt: number | null } {
  if (input.plan === 'free') return { plan: 'free', expiresAt: null };
  if (input.durationDays != null) return { plan: 'pro', expiresAt: now + input.durationDays * 86_400_000 };
  if (input.expiresAt != null) return { plan: 'pro', expiresAt: input.expiresAt };
  return { plan: 'pro', expiresAt: null };
}
