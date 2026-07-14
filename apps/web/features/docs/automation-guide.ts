/**
 * SuperTrend flip → Zerodha automation guide, rendered on `/docs/automation`. This is the
 * FINAL-DELIVERY capstone: it shows the owner (and any Pro user) how to ARM a SuperTrend
 * position-flip on ANY connected Kite instrument (stock / option / future / MCX) so BUY signals
 * go long and SELL signals flip to short, all through the audited GW-1..GW-7 broker pipeline.
 *
 * Pure content — no React, no IO — so `tests/docs-automation.test.ts` can (1) RUN the displayed
 * strategy script through the real interpreter and prove it emits clean BUY + SELL flip marks, and
 * (2) DRIFT-GUARD the documented defaults against the real arm-form (`apps/web/lib/automation-arm.ts`)
 * and the real automation builder (`apps/api/src/broker/supertrend-automation.ts`). The docs can
 * never claim a number the terminal doesn't actually use.
 */

export interface ArmStep {
  title: string;
  body: string;
}

export interface SafetyRail {
  title: string;
  body: string;
}

export interface FlipRow {
  /** The fired signal, e.g. 'BUY (flip up)'. */
  signal: string;
  /** What the executor does when currently flat. */
  whenFlat: string;
  /** What it does when currently holding the opposite side. */
  whenOpposite: string;
  /** What it does when already on the same side (idempotent). */
  whenSame: string;
}

/**
 * The documented default arm parameters — the SINGLE source the page renders and the drift test
 * checks against `defaultArmForm()` + `buildSupertrendAutomation`. Change a default in the arm
 * surface and this must move with it or the test fails.
 */
export const AUTOMATION_DEFAULTS = {
  /** SuperTrend ATR length. */
  atrLength: 10,
  /** SuperTrend ATR multiplier (band width). */
  multiplier: 3,
  /** Target position size after a flip (lots × lot-size for F&O/MCX). */
  quantity: 1,
  /** Kite product: intraday. */
  product: 'mis' as const,
  /** Max automated flips per day for EACH leg. `null` in the form = unlimited. */
  maxTradesPerDay: 5,
  /** Telegram fill note on each flip. */
  telegram: true,
};

/**
 * The SuperTrend flip strategy shown on the page and runnable in the terminal (Script dock).
 * It reuses `ta.supertrend` — the exact indicator engine the armed automation evaluates — so what
 * you see on the chart is what fires the order. The inputs default to `AUTOMATION_DEFAULTS`.
 */
export const AUTOMATION_STRATEGY_SCRIPT = `pulse 1
meta(name: "SuperTrend Flip", overlay: true)

# Same math the armed automation runs: ta.supertrend reuses the shared indicator engine,
# so the marks below fire on the exact bars your Zerodha order flips on.
atrLen = input.num(10, "ATR length", 1)
mult   = input.num(3, "ATR multiplier", 0.5)

st = ta.supertrend(mult, atrLen)
draw line(st.line, color: "#a78bfa", title: "SuperTrend")

# BUY — regime flips UP: the executor closes any short, then opens a long.
when st.dir > st.dir[1]: mark buy at low "BUY flip"
# SELL — regime flips DOWN: the executor closes the long, then opens a short.
when st.dir < st.dir[1]: mark sell at high "SELL flip"
`;

/** The position-FLIP semantics, in plain English — mirrors the GW-7 flip-planner exactly. */
export const FLIP_TABLE: FlipRow[] = [
  {
    signal: 'BUY (SuperTrend flips up)',
    whenFlat: 'Open a long (market, your set quantity).',
    whenOpposite: 'Close the short at market, then open a long — one flip.',
    whenSame: 'Already long → nothing (never stacks or double-buys).',
  },
  {
    signal: 'SELL (SuperTrend flips down)',
    whenFlat: 'Open a short (market, your set quantity).',
    whenOpposite: 'Close the long at market, then open a short — one flip.',
    whenSame: 'Already short → nothing (idempotent).',
  },
];

/** Step-by-step: how to arm the strategy on your own Kite instrument, from the terminal. */
export const ARM_STEPS: ArmStep[] = [
  {
    title: 'Go Pro and connect Zerodha',
    body:
      'Automated orders are a Pro feature. On /account or from the owner-run admin panel, activate Pro, then use the top-bar Zerodha button to connect your Kite account (one-tap daily reconnect keeps the token fresh each morning).',
  },
  {
    title: 'Whitelist your order-routing IP',
    body:
      'SEBI requires a static IP per client. The connect dialog shows the dedicated egress IP assigned to you — add it to your Kite Connect app’s API settings and confirm it in the dialog. Orders only place once the IP is whitelisted; reads never need it.',
  },
  {
    title: 'Open the Kite instrument you want to trade',
    body:
      'Load the instrument on the active pane — any KITE: symbol works: a stock (NSE:RELIANCE), an option (NFO:NIFTY…CE), a future, or an MCX contract. The chart runs on your own Kite data feed.',
  },
  {
    title: 'Arm the SuperTrend flip',
    body:
      'Open the Automation (bot) dialog in the top bar. It reads the active pane’s instrument; set the interval, ATR length / multiplier, quantity, product (MIS/CNC/NRML), max flips-per-day, and whether to get a Telegram note. Hit Arm — the same whitelist check a manual order needs runs, so any problem surfaces verbatim.',
  },
  {
    title: 'Let it flip — or disarm anytime',
    body:
      'Once armed, each SuperTrend flip routes a position-flip market order through the audited pipeline. The armed list shows an ARMED badge and a disarm (trash) button. Nothing is placed until a live signal fires; disarming removes both legs immediately.',
  },
];

/** The safety rails wrapped around every automated order — none of which you can turn off. */
export const SAFETY_RAILS: SafetyRail[] = [
  {
    title: 'Position-flip, never stack',
    body:
      'Each signal targets ONE net position. The executor closes the opposite side before opening the new one, and does nothing if you are already on the signalled side — so a repeated signal can’t pile on size.',
  },
  {
    title: 'Per-day flip cap',
    body:
      'Each leg honours your max flips-per-day (default 5). Once hit, further signals that day are skipped — no runaway order loop on a choppy instrument.',
  },
  {
    title: 'Kill-switch (drawdown breaker)',
    body:
      'The account-wide max-drawdown breaker gates automated orders exactly as it gates the MT5 runner. If it trips, every armed automation stops placing until the daily UTC reset.',
  },
  {
    title: 'Audit before broker',
    body:
      'Every order writes a broker_orders audit row BEFORE the broker call and completes it placed / rejected — you can always reconstruct what the automation did and why.',
  },
  {
    title: 'Telegram fill notes',
    body:
      'If you opt into Telegram, you get a note the moment a flip actually places (“Opened long” / “Flipped to short”) or the broker rejects it (verbatim reason) — so you see money move in real time.',
  },
  {
    title: 'Daily reconnect nudge',
    body:
      'Kite access tokens expire each IST morning. If an armed automation’s token goes stale, the arm surface shows a reconnect banner and (when enabled) DMs you, so a silent token expiry never leaves you un-armed.',
  },
];
