/**
 * Automation gate (GW-7). PURE + TESTED: the single decision on whether an ALERT-driven order may
 * proceed. Two guards, in priority order:
 *
 *   1. Kill-switch — the max-drawdown breaker (`dd-breaker.ts`) halts ALL new automation when the
 *      day's loss limit is breached. This is the durable safety backstop and beats everything.
 *   2. Daily cap — a per-alert ceiling on automated flips per UTC day (configured on the alert).
 *      Omitted / non-positive = unlimited (the kill-switch and the whitelist gate still apply).
 *
 * Manual orders never pass through here — only automated (alert/indicator) placements are capped.
 */
export interface AutomationGateInput {
  killSwitchHalted: boolean;
  /** Automated flips already acted on for this alert today. */
  tradesToday: number;
  /** Per-alert daily cap; undefined or ≤0 → unlimited. */
  maxTradesPerDay?: number;
}

export type AutomationGateResult =
  | { allowed: true }
  | { allowed: false; reason: 'kill_switch' | 'daily_cap' };

export function evaluateAutomationGate(input: AutomationGateInput): AutomationGateResult {
  if (input.killSwitchHalted) return { allowed: false, reason: 'kill_switch' };
  if (input.maxTradesPerDay && input.maxTradesPerDay > 0 && input.tradesToday >= input.maxTradesPerDay) {
    return { allowed: false, reason: 'daily_cap' };
  }
  return { allowed: true };
}
