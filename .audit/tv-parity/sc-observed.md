# SuperCharts — observed indicator UX (live capture 2026-06-06, BTCUSDT 1m)

Captured by driving the live app at http://localhost:3000/terminal. Ground truth for the parity audit.

## Indicators dialog (top-bar "Indicators" button)
- Single centered modal. Title "Indicators · BTCUSDT · 1m". Help line: "Toggle any indicator on the active chart. ↑↓ to navigate · Enter to add · ★ to favorite. Order-flow tools need live trade data — Binance crypto only."
- One search box + a single scrolling column grouped by category headers: VOLUME & PROFILE, MOVING AVERAGES, OSCILLATORS, BANDS & CHANNELS, (more).
- Each row: name + one-line description + ★ favorite toggle + an on/off Switch. Order-flow rows carry an [ORDER-FLOW] tag.
- SEARCH MATCHES name+description substring only. Typing "EMA" returns ONLY "Keltner Channels" (matched via its description "EMA ± ATR channels") — the actual "Exponential MA" indicator is NOT found by the acronym. Typing "moving" finds Simple/Exponential/Weighted/Hull MA. => no acronym/alias/synonym search.
- No left category sidebar; no per-indicator details/About panel; no source-symbol picker; no tabs (Indicators/Financials/Community); favorites/recent appear as sections only after use.

## Adding an indicator
- Toggling the Switch adds it immediately; the top-bar "Indicators" button shows a count badge ("1").
- Overlay (e.g. Exponential MA) draws a blue line over price.

## On-chart legend / status line (top-left of pane)
- Row: "● Exponential Moving Average   21 · close   60,085.7" = colour swatch + full name + input summary + live value (updates with crosshair candle; latest when off-chart).
- HOVER reveals 3 controls to the right: eye (visibility) / gear (settings) / × (delete). No "more" (…) overflow menu (TV has Move-to / Add-alert / Pin-to-scale / Visual-order / Source-code). No loading spinner state. No double-click-to-open-settings observed.

## Indicator manager — right rail "Ind" tab
- Header "INDICATORS" + "Add" button. One row per instance: eye / up-chevron / down-chevron / duplicate / gear / trash.
- Instance NAME IS TRUNCATED to "Ex…" — the rail/row is too narrow to show "Exponential Moving Average".
- Gear opens an INLINE editor panel below the row titled "EXPONENTIAL MOVING AVERAGE · SETTINGS" with a "Close" link. Fields: LENGTH (number "21"), SOURCE (dropdown "Close"), COLOR (raw hex text input "#2196f3").
- NO tabs (Inputs/Style/Visibility/Scale/About). COLOR is a raw hex string, not a colour-picker swatch. No line width, no line style (solid/dashed/dotted), no opacity, no "Defaults" (save/reset) menu, no precision, no price-line toggle, no per-plot styling, no "place on scale" / pane assignment. Editor is docked in the rail, not a movable dialog.

## Data Window — right rail "Data" tab
- Badge "5 JUN, 22:30  [CROSSHAIR]" (switches to "[LATEST]" off-chart). Rows: Open / High / Low / Close (close colour-coded) / Change (+43.6) / Change % (+0.07%) / Volume. Bearish path confirmed live (Change −10.97 / −0.02%, red).
- Then per visible indicator: a header ("Exponential Moving Average") + each channel ("Value  60,032.96").
- No source-price row, no coloured change bar, no OHLC colour key beyond close.

## Crosshair tooltip
- A floating O/H/L/C/V/Δ box is drawn near the cursor on the chart (separate `layers/tooltip.ts`) IN ADDITION TO the top-left legend. TradingView shows OHLC in the top status line, not a floating box that tracks the cursor.

## Right-click — chart body
- Menu items: Reset zoom (DBL-CLICK), Delete selected drawing (DEL), Show heatmap, Show volume profile, Show deep trades, Show footprint, Show volume pane.
- Overlay-toggle heavy. MISSING TV staples: Add indicator, Add alert (at price), Trade, Chart/scale settings, Copy price, Object tree, Hide all drawings, Reset chart.

## Right-click — price axis (scale)
- Shows the SAME generic chart menu. There is NO dedicated price-scale menu (Auto/fit, Logarithmic, Percent, Indexed-to-100, Regular, Scale settings) and no visible log/%/auto scale-mode buttons at the axis. Scale modes appear unimplemented.

## General
- Live data is real (Binance/mock/yahoo "connected" in DATA HEALTH). Do NOT fabricate data.
- Live alert config (48× 1d EMA(5)×EMA(10), Telegram @dipaloMA_bot) must NOT be touched by any fix.
- PulseScript is an ORIGINAL language — fixes must not clone TradingView's Pine identifiers/keywords/syntax.
