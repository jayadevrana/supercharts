# SuperCharts TradingView feature recorder

Plays back a Playwright session inside a persistent Chromium profile,
records DOM selectors for the most-used TradingView features, and writes
screenshots + a JSON spec to `output/`.

The persistent profile means **you log into TradingView once** and never
share your credentials with anyone (including Claude). Cookies live in
`.tv-profile/`, which is gitignored.

## First run — log in

```bash
pnpm --filter @supercharts/tv-recorder install:browser   # one-time
pnpm --filter @supercharts/tv-recorder launch
```

Chromium opens. Log into TradingView the normal way, dismiss any popups,
and close the browser window when you see the chart.

## Capture features

```bash
pnpm --filter @supercharts/tv-recorder record
```

This walks through symbol search, interval picker, chart type, indicators
dialog, multi-chart layout, bar replay, drawing toolbar, trading panel,
alerts, screener and watchlist. Each probe is best-effort: missing or
relocated selectors are recorded as `available: false` rather than
aborting the run.

Output:

- `output/tv-features.json` — feature spec with selectors + screenshot
  paths.
- `output/screens/*.png` — full-window captures.
- `output/screens/tv-full.png` — a reference chart screenshot.

## Notes

- TradingView's DOM changes often. If a recording comes back mostly
  `available: false`, update the selectors in `src/record.ts`. The
  selectors are written as arrays so the probe matches the first
  successful one.
- The recorder never modifies your TradingView account or layouts. All
  it does is click into menus and screenshot.
- If you want to record a *different* TV layout or chart URL, edit the
  `page.goto(...)` call at the top of `src/record.ts`.
