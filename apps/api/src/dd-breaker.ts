/**
 * Max-drawdown breaker (Phase 2 #10).
 *
 * Watches the day's P&L and, when the loss breaches a configurable limit, HALTS new
 * automation (MT5 signal recipes) so a bad day can't compound. Auto-resets at the UTC
 * day boundary; the owner can also manually resume.
 *
 * The daily P&L is injected (`computeDailyPnlPct`) so the source is swappable — today it's
 * the paper book (realised closed-today % + open unrealized %); when an MT5 account is
 * connected the same breaker can be fed live equity drawdown. Percentage-based, equal
 * weight — stated, not faked.
 *
 * Safety: this only ever ADDS a "skip" gate to the signal runner. With the breaker absent
 * or not halted, recipe behaviour is unchanged.
 */
export interface BreakerStatus {
  enabled: boolean;
  /** Halt when the day's P&L drops to ≤ −limitPct (e.g. 5 → halt at −5%). */
  limitPct: number;
  /** Today's net P&L % (realised + open). Negative = down on the day. */
  dailyPnlPct: number;
  /** Loss magnitude as a positive number (0 when flat/green). */
  drawdownPct: number;
  halted: boolean;
  haltedAt: number | null;
  /** UTC day-start (ms) this status is scoped to. */
  dayStart: number;
  reason?: string;
}

export interface DrawdownBreaker {
  /** Recompute the day's P&L, trip if breached, return the fresh status. */
  check(): BreakerStatus;
  status(): BreakerStatus;
  isHalted(): boolean;
  /** Manually clear the halt for the rest of today (won't auto-re-trip until tomorrow). */
  resume(): void;
  configure(patch: { enabled?: boolean; limitPct?: number }): BreakerStatus;
}

export function startOfUtcDay(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}

export function createDrawdownBreaker(opts: {
  computeDailyPnlPct: (dayStart: number) => number;
  limitPct?: number;
  enabled?: boolean;
  onTrip?: (status: BreakerStatus) => void;
  now?: () => number;
}): DrawdownBreaker {
  const now = opts.now ?? (() => Date.now());
  let enabled = opts.enabled ?? true;
  let limitPct = opts.limitPct ?? 5;
  let halted = false;
  let haltedAt: number | null = null;
  let dayStart = startOfUtcDay(now());
  let manualResumeDay: number | null = null;
  let lastDailyPnlPct = 0;

  function snapshot(): BreakerStatus {
    return {
      enabled,
      limitPct,
      dailyPnlPct: lastDailyPnlPct,
      drawdownPct: lastDailyPnlPct < 0 ? -lastDailyPnlPct : 0,
      halted,
      haltedAt,
      dayStart,
      reason: halted ? `Daily P&L ${lastDailyPnlPct.toFixed(2)}% ≤ −${limitPct}% limit` : undefined,
    };
  }

  function rolloverIfNeeded(): void {
    const today = startOfUtcDay(now());
    if (today !== dayStart) {
      dayStart = today;
      halted = false;
      haltedAt = null;
      manualResumeDay = null;
    }
  }

  function check(): BreakerStatus {
    rolloverIfNeeded();
    lastDailyPnlPct = opts.computeDailyPnlPct(dayStart);
    if (
      enabled &&
      !halted &&
      manualResumeDay !== dayStart && // don't auto-re-trip after a manual resume today
      lastDailyPnlPct <= -limitPct
    ) {
      halted = true;
      haltedAt = now();
      opts.onTrip?.(snapshot());
    }
    return snapshot();
  }

  return {
    check,
    status() {
      rolloverIfNeeded();
      return snapshot();
    },
    isHalted() {
      rolloverIfNeeded();
      return enabled && halted;
    },
    resume() {
      rolloverIfNeeded();
      halted = false;
      haltedAt = null;
      manualResumeDay = dayStart;
    },
    configure(patch) {
      if (typeof patch.enabled === 'boolean') enabled = patch.enabled;
      if (typeof patch.limitPct === 'number' && patch.limitPct > 0) limitPct = patch.limitPct;
      return check();
    },
  };
}
