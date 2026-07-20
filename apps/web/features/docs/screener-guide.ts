/**
 * "Code a market screener in PulseScript" guide, rendered on `/docs/screener`. It teaches the
 * SCAN-4 surface: write ONE script, run it across every symbol in the catalog, and a symbol
 * matches when the script raises a mark or `alert()` on the newest CLOSED bar.
 *
 * Pure content — no React, no IO — so `tests/docs-screener.test.ts` can run every displayed
 * script through the REAL `runScriptScan` (apps/api/src/scanner.ts) and behaviorally pin the
 * documented match rule, bar minimum, honest failure statuses, and the runaway-script sandbox.
 * The docs can never claim semantics the scanner doesn't actually have.
 */

export interface ScreenerScript {
  id: string;
  title: string;
  /** What the screen finds, in plain English. */
  blurb: string;
  code: string;
}

export interface ScanStep {
  title: string;
  body: string;
}

export interface StatusRow {
  /** The exact `ScanRowStatus` value the API returns. */
  status: string;
  meaning: string;
}

/**
 * The documented scan limits — behaviorally drift-guarded: the test proves `minBars - 1` closed
 * bars report `insufficient_data` while `minBars` are evaluated, and that a runaway script is
 * aborted by the per-symbol sandbox instead of hanging the scan.
 */
export const SCREENER_LIMITS = {
  /** Closed bars below this → `insufficient_data` (indicator warmup + margin). */
  minBars: 60,
  /** Per-symbol execution budget — a slow or runaway script is cut off, honestly reported. */
  perSymbolTimeoutMs: 500,
};

/** The match rule + honesty guarantees, exactly as the engine implements them. */
export const MATCH_RULES: Array<{ title: string; body: string }> = [
  {
    title: 'Matches fire on the newest closed bar only',
    body:
      'A symbol matches when your script raises a mark (buy / sell / note / marker) or calls alert() on the LAST closed bar. Historical signals don’t count — a screen result is something happening now, not something that happened last week.',
  },
  {
    title: 'The still-forming bar never counts',
    body:
      'The bar currently printing is trimmed before your script runs — the same no-repaint rule the alert engine uses. A breakout that only exists on a half-finished candle can’t put a symbol in your results.',
  },
  {
    title: 'Syntax errors fail the whole scan, loudly',
    body:
      'Your script is parsed once before anything runs. A syntax error returns a line/column error for the scan itself — you’ll never get a silently empty result from a script that couldn’t compile.',
  },
  {
    title: 'Runtime errors are isolated per symbol',
    body:
      'If the script throws on one symbol (bad data shape, a branch that only runs there), that symbol reports script_error with the message — every other symbol still scans normally.',
  },
];

/** Honest per-row statuses — mirrors the API's `ScanRowStatus` union exactly. */
export const STATUS_ROWS: StatusRow[] = [
  { status: 'ok', meaning: 'The script ran over this symbol’s closed bars; `matched` says whether it fired on the newest one.' },
  { status: 'insufficient_data', meaning: `Fewer than ${SCREENER_LIMITS.minBars} closed bars — not enough history for indicator warmup, so the script never runs.` },
  { status: 'unavailable', meaning: 'No candles for this symbol on the chosen timeframe (venue doesn’t serve it). Never faked.' },
  { status: 'script_error', meaning: 'The script threw on this symbol — the row carries the error message; other symbols are unaffected.' },
];

/** Step-by-step: from an idea to a whole-market screen, inside the terminal. */
export const SCAN_STEPS: ScanStep[] = [
  {
    title: 'Write the screen in the Script dock',
    body:
      'Open the terminal and hit the toolbar Script button. Write a script whose mark or alert() fires exactly when your condition is true — run it on the active chart first and check the marks land where you expect.',
  },
  {
    title: 'Save it with a name',
    body:
      'Hit Save in the Script dock and name it (e.g. “RSI snap-back”). Saved scripts are per-account and show up everywhere scripts can run — including the scanner.',
  },
  {
    title: 'Open the Scanner tab and switch to Script mode',
    body:
      'In the right rail, open the Scanner tab and pick the Script chip. Choose your saved script from the dropdown and pick a timeframe (15m / 1h / 4h / 1d).',
  },
  {
    title: 'Run it across the whole catalog',
    body:
      'Hit Run. One script now evaluates every symbol in the catalog — crypto, forex, metals, indices — on real closed candles. Matches sort to the top; every non-match row still tells you honestly why (no data, short history, or a script error).',
  },
  {
    title: 'Click a row to chart it',
    body:
      'Click any matched symbol to load it on the active pane with your script’s marks visible — inspect the setup, then refine the script and re-run. From there the same script can drive a backtest or a live alert.',
  },
];

/**
 * The runnable example screens. Every one of these is executed through the REAL scan engine in
 * `tests/docs-screener.test.ts` — if a script stops parsing or running, the build fails.
 */
export const SCREENER_SCRIPTS: ScreenerScript[] = [
  {
    id: 'rsi-snap-back',
    title: 'RSI snap-back',
    blurb:
      'Find symbols whose RSI just crossed back above 30 — the oversold washout is over and price is snapping back. The classic mean-reversion entry, screened across the whole market.',
    code: `pulse 1
meta(name: "RSI Snap-Back Screen", overlay: false)

r = ta.rsi(close, 14)
draw line(r, color: "#38bdf8", title: "RSI 14")
draw level(30, color: "#64748b")

# The scanner matches when this fires on the newest closed bar.
when crossOver(r, 30): mark buy at low "RSI snap-back"
`,
  },
  {
    id: 'uptrend-volume-surge',
    title: 'Volume surge in an uptrend',
    blurb:
      'A pure alert() screen — no chart output needed to match. Finds symbols trading above their 50-EMA whose latest bar printed more than twice the 20-bar average volume: momentum with fuel behind it.',
    code: `pulse 1
meta(name: "Uptrend Volume Surge", overlay: true)

trendEma = ta.ema(close, 50)
draw line(trendEma, color: "#f59e0b", title: "EMA 50")

avgVol = ta.sma(volume, 20)
when close > trendEma and volume > 2 * avgVol {
    alert("volume surge in an uptrend")
}
`,
  },
  {
    id: 'fresh-breakout',
    title: 'Fresh 20-bar breakout',
    blurb:
      'Find symbols closing above their prior 20-bar high — comparing against the PRIOR bar’s channel so the break is confirmed, never look-ahead. New highs, the moment they print.',
    code: `pulse 1
meta(name: "Fresh 20-Bar Breakout", overlay: true)

d = ta.donchian(20)
draw line(d.upper, color: "#f59e0b", title: "20-bar high")

when close > d.upper[1]: mark buy at low "breakout"
`,
  },
  {
    id: 'macd-momentum-turn',
    title: 'MACD momentum turn',
    blurb:
      'Find symbols whose MACD histogram just flipped from negative to positive — momentum turning up right now, not five bars ago.',
    code: `pulse 1
meta(name: "MACD Momentum Turn", overlay: false)

m = ta.macdFull(close, 12, 26, 9)
draw hist(m.histo, title: "Histogram")

when m.histo > 0 and m.histo[1] <= 0: mark buy at low "momentum flip"
`,
  },
];
