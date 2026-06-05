# SuperCharts → TradingView indicator-UX parity punch-list

_Audit 2026-06-06 · parity score **42/100** · 64 verified-real gaps → 18 increments_

## Verdict

SuperCharts has a genuinely strong indicator FOUNDATION — a 38-indicator tested registry, a working legend/Data Window/manager built on pure reusable helpers, and renderers that already accept rgba fill, lineWidth, dash, log-scale math, and per-channel data — but the UX layer that exposes all of it to TradingView parity is largely unbuilt, so the score lands at 42. The single biggest theme is 'capability built, never wired': scale modes, paneId, line width/style, opacity, percent/log toggles, and a complete plot-cross alert evaluator all EXIST in code yet are unreachable from any control, making most fixes additive wiring rather than new systems. The second theme is a missing settings/discovery surface — there is no tabbed settings modal (M4b), no acronym search (typing 'EMA' returns only Keltner), no colour picker, no legend overflow menu, and sub-panes are a disconnected last-200-bar SVG thumbnail that doesn't share the chart's time axis (the one true blocker, PANES-1). The plan front-loads quick high-confidence wins (alias search, manager identity, legend double-click) and the sub-pane axis blocker, then builds the M4b settings modal as the parent for all style controls and the legend overflow menu as the parent for move-to-pane and create-alert. Hard constraints are respected throughout: every TA fix reuses packages/indicators, the create-alert engine work defaults legacy rows to ma_cross so the 48 live Telegram alerts keep loading, no fix fabricates data (Bollinger source and VWMA use real candles; secondary symbols are deferred and must show no-data), and PulseScript stays an original language surfaced only as data, never cloned syntax.

## Build order (increments)

| # | Increment | Sev | Effort | Maps to | Findings |
|---|---|---|---|---|---|
| 1 | **Acronym/alias indicator search** | high | S | NEW | 2 |
| 2 | **Manager row identity: full-name tooltip + input summary + colour swatch + pane grouping** | high | S | NEW | 3 |
| 3 | **Sub-pane shared time axis + crosshair + real price scale (the blocker)** | blocker | L | NEW | 3 |
| 4 | **Symbol status line + legend quality-of-life (double-click, collapse, spinner)** | high | M | NEW | 4 |
| 5 | **Tabbed settings modal (M4b) — Inputs / Style / About in a centered dialog** | high | L | M4b | 2 |
| 6 | **Style tab controls — colour-swatch+opacity, line width/style, precision, defaults** | high | L | M4b | 4 |
| 7 | **Legend overflow menu + move-to-pane (paneId becomes live state)** | high | L | M6 | 6 |
| 8 | **Data Window completeness: per-channel colour, readable plot names, hidden/dim, change bar** | medium | M | NEW | 4 |
| 9 | **Create alert from indicator (M5) — engine + extracted evaluator + form + legend entry** | high | XL | M5 | 7 |
| 10 | **Chart context menu staples + fixed-status-line OHLC + cursor affordances** | high | M | NEW | 3 |
| 11 | **Price-scale modes + axis context menu (log ticks, percent, auto, invert)** | high | XL | NEW | 6 |
| 12 | **Surface PulseScript + SMC + STS in the Data Window** | high | L | NEW | 1 |
| 13 | **Browser fast-path: persistent favorites/recents + category rail + saved scripts + row info** | medium | L | NEW | 4 |
| 14 | **Indicator coverage: DEMA/TEMA reachable, VWMA, input bounds+tooltips, MA offset, Bollinger source** | medium | M | NEW | 5 |
| 15 | **Per-plot enable / show-in-legend toggles (multi-plot visibility)** | medium | L | M4b | 1 |
| 16 | **Pane resize separators + maximize/collapse** | high | L | M6 | 3 |
| 17 | **Drag-to-add from dialog + legend drag-reorder** | medium | M | M6 | 1 |
| 18 | **Interaction feel: momentum pan, eased zoom, magnet crosshair, multi-pane Data Window, source-symbol (deferred)** | low | XL | NEW | 5 |

**Quick wins (high impact / low effort):** BROWSER-1, COVERAGE-1, MANAGER-1, MANAGER-2, MANAGER-4, LEGEND-2, DATAWINDOW-4, DATAWINDOW-5, BROWSER-6, INTERACTION-5

## Increment detail

### 1. INC-1 — Acronym/alias indicator search
- **Severity** high · **Effort** S · **Maps to** NEW
- **Goal:** Add an optional aliases?: string[] to IndicatorSpec (registry.ts) and the dialog's Entry union, OR it into matches() in indicators-dialog.tsx (and mirror in indicator-panel.tsx's IndicatorPickerList), and populate high-traffic aliases (ema, bb/bbands, stoch, %r/wpr, kc, dc, sar, st). Fixes the headline 'EMA returns only Keltner' dead-end. Single-source longer text from INDICATOR_LOOKUP[type].description where useful.
- **Findings:** BROWSER-1, COVERAGE-1
- **Files:** packages/indicators/src/registry.ts, apps/web/features/terminal/indicators-dialog.tsx, apps/web/features/terminal/indicator-panel.tsx

### 2. INC-3 — Manager row identity: full-name tooltip + input summary + colour swatch + pane grouping
- **Severity** high · **Effort** S · **Maps to** NEW
- **Goal:** Fix the 'Ex…' unidentifiable manager rows. In indicator-panel.tsx add title={inst.name||spec.label} to the name span, import and render the existing indicatorInputSummary helper as a muted suffix, add a legendColor swatch next to the eye button (both helpers already power the legend/Data Window, just not imported here), and group the flat list under lightweight 'On price'/per-sub-pane headers by inst.paneId while preserving the flat-array index used by the up/down chevrons.
- **Findings:** MANAGER-1, MANAGER-2, MANAGER-4
- **Files:** apps/web/features/terminal/indicator-panel.tsx, apps/web/features/terminal/indicator-legend-util.ts

### 3. INC-11 — Sub-pane shared time axis + crosshair + real price scale (the blocker)
- **Severity** blocker · **Effort** L · **Maps to** NEW
- **Goal:** Make oscillator sub-panes real panes. Capture the live visible range via the already-wired onVisibleRangeChange callback into new subRange state and pass range + barWidth into SubPaneIndicators; replace the slice(-200) tail + i*xScale projection with the canvas's [fromTime,toTime] mapping; pass legendHoverIdx/hoverTime + the indChannelsRef map so SubPaneRow draws a crosshair line and a value-at-cursor readout in its header (read the shared channel map, don't recompute); compute min/max over the visible window and render graduated ticks aligned to the canvas axisWidth gutter instead of hardcoded width=360. Keep the SVG renderer (do not rebuild as a canvas layer).
- **Findings:** PANES-1, PANES-5, PANES-6
- **Files:** apps/web/features/terminal/sub-pane-indicators.tsx, apps/web/features/terminal/chart-pane.tsx, packages/chart-core/src/chart-core.ts

### 4. INC-6 — Symbol status line + legend quality-of-life (double-click, collapse, spinner)
- **Severity** high · **Effort** M · **Maps to** NEW
- **Goal:** Add the institutional top-left reading surface and legend muscle-memory. Render a crosshair-aware SymbolStatusLine sibling above IndicatorLegend in chart-pane fed by candleBufRef.current[legendHoverIdx] (O/H/L/C + abs/percent change, bull/bear classes, reusing formatPrice/formatPercent) — render as a sibling so it shows with zero indicators. Add onDoubleClick={onSettings} to legend rows (+stopPropagation on inner buttons), a local-state collapse chevron, and an optional computing spinner on LegendRow flipped on at recompute start.
- **Findings:** LEGEND-3, LEGEND-2, LEGEND-5, LEGEND-4
- **Files:** apps/web/features/terminal/indicator-legend.tsx, apps/web/features/terminal/chart-pane.tsx, apps/web/features/terminal/indicator-legend-util.ts, apps/web/features/terminal/terminal-store.ts

### 5. INC-7 — Tabbed settings modal (M4b) — Inputs / Style / About in a centered dialog
- **Severity** high · **Effort** L · **Maps to** M4b
- **Goal:** The parent increment for all style controls. Wrap IndicatorEditor's existing fields in the already-present Tabs primitive (components/ui/tabs.tsx): keep the spec.inputs.map loop as the Inputs tab; add a Style tab and an About tab (from spec.description/label); render the whole editor inside components/ui/dialog.tsx keyed off the same editing state, keeping BOTH entry points (rail gear setEditing + legend gear requestIndicatorSettings/indicatorSettingsTarget). A centered modal removes the 'Ex…' truncation. Drive all content from IndicatorSpec — no per-indicator forms; do not rebuild fields.
- **Findings:** SETTINGS-1, SETTINGS-7
- **Files:** apps/web/features/terminal/indicator-panel.tsx, apps/web/components/ui/tabs.tsx, apps/web/components/ui/dialog.tsx, packages/indicators/src/registry.ts

### 6. INC-8 — Style tab controls — colour-swatch+opacity, line width/style, precision, defaults
- **Severity** high · **Effort** L · **Maps to** M4b
- **Goal:** Fill the Style/Properties tab created in INC-7 with real controls (lands inside M4b). Build a ColorSwatch composing popover.tsx + native color input + slider.tsx → rgba, rendered per spec style colour-key (iterate keys like indicator-legend-util's list); add lineWidth stepper + lineStyle enum threaded through chart-pane's overlay push sites (start with the MA/EMA case that passes none) and sub-pane-indicators (dashed:[6,4]/dotted:[2,3]); add a precision style key threading inst.style.precision into formatIndicatorValue (new optional 2nd arg) for legend + Data Window; add a Defaults menu (Save-as-default / Reset-to-defaults) persisting per-type user defaults via the indicator-prefs.ts pattern and merged in onPick. Renderer already consumes rgba (band.fillColor), lineWidth, and dash — no chart-core change.
- **Findings:** SETTINGS-2, SETTINGS-3, SETTINGS-6, SETTINGS-5
- **Files:** apps/web/features/terminal/indicator-panel.tsx, apps/web/components/ui/popover.tsx, apps/web/components/ui/slider.tsx, apps/web/features/terminal/chart-pane.tsx, apps/web/features/terminal/sub-pane-indicators.tsx, apps/web/features/terminal/indicator-legend-util.ts, apps/web/features/terminal/data-window-util.ts, apps/web/features/terminal/indicator-prefs.ts, packages/indicators/src/registry.ts

### 7. INC-13 — Legend overflow menu + move-to-pane (paneId becomes live state)
- **Severity** high · **Effort** L · **Maps to** M6
- **Goal:** Add the per-indicator '…' overflow menu and make paneId actually drive rendering. Add a 4th hover button to IndicatorLegend opening a popover reusing the MenuItem/MenuSeparator pattern: Bring-to-front/Send-to-back (loop existing reorderIndicator), Settings, Remove, Reset-to-defaults (build explicit defaults from spec — NOT an empty-object patch, which the deep-merging updateIndicator no-ops), and Move-to-pane. Make paneId source-of-truth: give sub indicators unique pane ids at all three add paths + duplicate(), add moveIndicatorToPane store action, group sub-pane-indicators by inst.paneId, and have chart-pane's overlay loop honor paneId==='price'. Add group-focus-within reveal for keyboard a11y. Add-alert item defers to INC-14.
- **Findings:** LEGEND-1, PANES-3, DND-2, MANAGER-3, DND-4, DND-5
- **Files:** apps/web/features/terminal/indicator-legend.tsx, apps/web/features/terminal/indicator-panel.tsx, apps/web/features/terminal/sub-pane-indicators.tsx, apps/web/features/terminal/chart-pane.tsx, apps/web/features/terminal/terminal-store.ts, apps/web/features/terminal/indicator-manager-util.ts, packages/types/src/chart.ts

### 8. INC-4 — Data Window completeness: per-channel colour, readable plot names, hidden/dim, change bar
- **Severity** medium · **Effort** M · **Maps to** NEW
- **Goal:** Polish the Data Window to TV's per-plot fidelity. Add color to DataWindowChannel resolved via a new exported channelColor(spec,inst,channel) helper (lift the colorFor logic from sub-pane-indicators with an explicit channel→styleKey alias map for ADX/Bollinger mismatches); add optional channelLabels to IndicatorSpec for friendly plot names (MACD/Signal/Histogram, %K/%D, +DI/-DI, Span A, %B…) read in buildDataWindow; carry visible on DataWindowIndicator and dim+EyeOff hidden rows (EyeOff already imported in right-rail); prepend a thin bull/bear colour bar on the Change/Change% rows keyed off o.up.
- **Findings:** DATAWINDOW-1, DATAWINDOW-2, DATAWINDOW-5, DATAWINDOW-4
- **Files:** apps/web/features/terminal/data-window-util.ts, apps/web/features/terminal/right-rail.tsx, apps/web/features/terminal/indicator-legend-util.ts, apps/web/features/terminal/sub-pane-indicators.tsx, packages/indicators/src/registry.ts

### 9. INC-14 — Create alert from indicator (M5) — engine + extracted evaluator + form + legend entry
- **Severity** high · **Effort** XL · **Maps to** M5
- **Goal:** Vertical slice that must land together to be functional. Extract the MT5 SignalRunner's inner evaluateCondition/evaluateConditions/indicatorRefs closures into a pure shared module (no accountId dependency) and import in both signal-runner and alert-engine. Add an 'indicator' discriminant to AlertDefinition.type + IndicatorAlertConfig reusing the SignalCondition union; make alertCreateSchema a discriminated union; branch alert-engine load()/evaluate() AND rowToAlert() with a legacy-default to 'ma_cross' so the 48 live alerts keep loading. Lift IndicatorCompareRow/PriceCrossesRow from signal-builder into a shared condition-editor and add an indicator-alert path to alerts-dialog seeded from a passed IndicatorInstance (copy full inputs → setIndicatorMetadata server-side). Add the legend/overflow 'Add alert' entry (depends on INC-13). NEVER touch the live alerts/Telegram config — open prefilled creation UI only.
- **Findings:** ALERTFROMIND-1, ALERTFROMIND-2, ALERTFROMIND-3, ALERTFROMIND-4, ALERTFROMIND-5, ALERTFROMIND-6, ALERTFROMIND-7
- **Files:** apps/api/src/mt5/signal-runner.ts, apps/api/src/signal-conditions.ts, apps/api/src/alert-engine.ts, apps/api/src/routes/alerts.ts, apps/api/src/db.ts, packages/types/src/alerts.ts, apps/web/features/terminal/alerts-dialog.tsx, apps/web/features/terminal/signal-builder-dialog.tsx, apps/web/features/terminal/condition-editor.tsx, apps/web/features/terminal/indicator-legend.tsx, apps/web/features/terminal/chart-pane.tsx

### 10. INC-15 — Chart context menu staples + fixed-status-line OHLC + cursor affordances
- **Severity** high · **Effort** M · **Maps to** NEW
- **Goal:** Bring the right-click body menu and cursor up to TV staples. In chart-pane store {x,y,price,time} (the price/time are already computed and thrown away) and extend ChartContextMenu with Copy-price, Add-indicator (open dialog), Reset-chart (reuse onResetZoom), and Add-alert-at-price (open the INC-14 creation UI prefilled — never auto-create). Default the cursor-tracking TooltipLayer off (or gate behind a per-pane flag) now that the INC-6 status line shows OHLC, keeping the candle-column highlight by moving it to CrosshairLayer. Set canvas cursor (crosshair/grab/grabbing/ns-resize/ew-resize) from the pointer handlers.
- **Findings:** INTERACTION-2, INTERACTION-1, INTERACTION-5
- **Files:** apps/web/features/terminal/chart-pane.tsx, packages/chart-core/src/chart-core.ts, packages/chart-core/src/layers/tooltip.ts, packages/chart-core/src/layers/crosshair.ts, apps/web/features/terminal/indicator-legend.tsx, apps/web/features/terminal/indicator-legend-util.ts

### 11. INC-12 — Price-scale modes + axis context menu (log ticks, percent, auto, invert)
- **Severity** high · **Effort** XL · **Maps to** NEW
- **Goal:** Make the declared-but-inert scale modes reachable and correct. Add a log-aware logTicks generator in grid.ts and branch GridLayer/AxisLayer on mode==='log' (hard prerequisite — linear ticks at log positions bunch unusably). Add ChartCore.setPriceScaleMode (sets state.mode, refits, markDirty) + percent/indexed math (rebase against first-visible close) in priceToY/yToPrice; add setAutoFit (extract onDblClick's fit body to share) and setInverted. Detect region:'price-axis' in onContextMenu (reuse the onPointerDown boundary tests) and render a PriceScaleContextMenu (Auto/Log/Percent/Regular/Invert) reusing the MenuItem/MenuSeparator primitives. Persist scaleMode on PaneState (rides the existing saveLayout panes serialization).
- **Findings:** SCALE-2, SCALE-1, SCALE-3, SCALE-4, SCALE-5, INTERACTION-3
- **Files:** packages/chart-core/src/layers/grid.ts, packages/chart-core/src/layers/axis.ts, packages/chart-core/src/scale.ts, packages/chart-core/src/chart-core.ts, apps/web/features/terminal/terminal-store.ts, apps/web/features/terminal/chart-pane.tsx

### 12. INC-5 — Surface PulseScript + SMC + STS in the Data Window
- **Severity** high · **Effort** L · **Maps to** NEW
- **Goal:** Make the flagship original features visible in the Data Window. Extend buildDataWindow's inputs additively: stash the latest RunResult.plots in a ref (mirroring indChannelsRef) and emit one DataWindowIndicator per pulse plot; stash the already-computed anchoredVwap.vwap / cvd.cvd frames (currently only written to layer.frame) in a ref and surface them; read stsFrame scalars (already in React state) at index. Gate each behind its enabled flag (pane.pulse.enabled / pane.smc.* / overlays.signalsTrendScore). Read existing per-bar Float64Arrays — never recompute, never duplicate math, never touch PulseScript identifiers.
- **Findings:** DATAWINDOW-3
- **Files:** apps/web/features/terminal/data-window-util.ts, apps/web/features/terminal/chart-pane.tsx

### 13. INC-2 — Browser fast-path: persistent favorites/recents + category rail + saved scripts + row info
- **Severity** medium · **Effort** L · **Maps to** NEW
- **Goal:** Make the Indicators dialog browsable at scale. Keep matching Favorites surfaced during search (drop the if(!lower) guard on the favorites partition); add a left category rail bound to a new activeGroup state that the existing sections useMemo loop respects (keep flatRows/keyboard-nav intact); add a 'My scripts' section sourced from GET /scripts (same endpoint code-terminal uses) that toggles the pane's pulse source via setPulseSource/setPulseEnabled (single-slot per pane — replaces, does not stack); fall back to INDICATOR_LOOKUP[type].description + an info affordance per classic row to surface the stranded registry descriptions.
- **Findings:** BROWSER-6, BROWSER-2, BROWSER-3, BROWSER-4
- **Files:** apps/web/features/terminal/indicators-dialog.tsx, apps/web/features/terminal/code-terminal-dialog.tsx, packages/indicators/src/registry.ts

### 14. INC-10 — Indicator coverage: DEMA/TEMA reachable, VWMA, input bounds+tooltips, MA offset, Bollinger source
- **Severity** medium · **Effort** M · **Maps to** NEW
- **Goal:** Close registry/math coverage gaps reusing packages/indicators. Add DEMA/TEMA registry+catalog rows (runner cases already exist — zero math); add vwma(values,volumes,length) to ma.ts + runner case reading candle.volume (no fabricated data); backfill min/max/step on all numeric inputs and add optional tooltip to IndicatorInputSpec rendered as help text + onChange clamp (a min-floor in runner.numberInput stops length 0 blanking a series); add an offsetInput()+shiftSeries for displaced MAs; add sourceInput()+source plumbing to Bollinger only (BollingerOptions gains optional source via pricesFromCandles) — NOT to CCI/Williams/MFI/Stochastic (HLC-defined; a source picker there would be misleading).
- **Findings:** COVERAGE-2, COVERAGE-4, COVERAGE-3, COVERAGE-5, SETTINGS-8
- **Files:** packages/indicators/src/registry.ts, packages/indicators/src/runner.ts, packages/indicators/src/ma.ts, packages/indicators/src/volatility.ts, apps/web/features/terminal/indicators-dialog.tsx, apps/web/features/terminal/indicator-panel.tsx

### 15. INC-9 — Per-plot enable / show-in-legend toggles (multi-plot visibility)
- **Severity** medium · **Effort** L · **Maps to** M4b
- **Goal:** Give multi-plot indicators (MACD, Bollinger, Ichimoku, ADX) per-plot control. Add an optional plots field to IndicatorInstance keyed channel→{enabled,showInLegend} defaulted from spec.channels (absent flags default enabled, so existing instances are unaffected). Render per-plot checkboxes in the Style tab; skip pushing a disabled channel's line/band in chart-pane's overlay switch; gate buildLegendRows and buildDataWindow on showInLegend. Keep the instance-level eye as the master switch. Defer the per-plot price-line (no horizontal-level primitive in IndicatorsLayer yet) as a stretch.
- **Findings:** SETTINGS-4
- **Files:** apps/web/features/terminal/indicator-panel.tsx, apps/web/features/terminal/chart-pane.tsx, apps/web/features/terminal/indicator-legend-util.ts, apps/web/features/terminal/data-window-util.ts, packages/types/src/chart.ts

### 16. INC-16 — Pane resize separators + maximize/collapse
- **Severity** high · **Effort** L · **Maps to** M6
- **Goal:** Add draggable sub-pane sizing and focus controls. Add optional paneHeight?/collapsed?/maximized? to IndicatorInstance; render a ~4px drag-handle above each SubPaneRow that calls updateIndicator({paneHeight}) (clamped, dbl-click reset, Arrow-key fallback) and use inst.paneHeight??80 for HEIGHT/svg; add header maximize/collapse buttons (collapsed→header only, maximized→full height, hide existing siblings). paneHeight rides classicIndicators persistence. The price-vs-sub boundary (flexing chart-container) is the heavier stretch since sub-panes are a sibling div below the canvas.
- **Findings:** PANES-2, DND-3, PANES-4
- **Files:** apps/web/features/terminal/sub-pane-indicators.tsx, apps/web/features/terminal/chart-pane.tsx, apps/web/features/terminal/terminal-store.ts, packages/types/src/chart.ts, packages/chart-core/src/viewport.ts

### 17. INC-17 — Drag-to-add from dialog + legend drag-reorder
- **Severity** medium · **Effort** M · **Maps to** M6
- **Goal:** Add the DnD interactions on top of the now-live paneId (INC-13). Make dialog rows draggable (onDragStart sets dataTransfer entryId); add onDragOver/onDrop to chart-container resolving the spec via INDICATOR_LOOKUP and calling addIndicator(buildInstance(spec)) — export buildInstance from indicators-dialog so chart-pane can call it. Make legend rows draggable to reorder via the existing reorderIndicator (+ a moveIndicatorTo(index) store action for precise drops). Keep click/Enter toggle and the up/down chevrons as keyboard fallbacks. True overlay-vs-new-pane drop targeting builds on INC-13's reassignable paneId.
- **Findings:** DND-1
- **Files:** apps/web/features/terminal/indicators-dialog.tsx, apps/web/features/terminal/chart-pane.tsx, apps/web/features/terminal/terminal-store.ts

### 18. INC-18 — Interaction feel: momentum pan, eased zoom, magnet crosshair, multi-pane Data Window, source-symbol (deferred)
- **Severity** low · **Effort** XL · **Maps to** NEW
- **Goal:** Lower-priority feel + advanced polish, batched last. Add an optional momentum decay pass to the existing RAF loop (track pointer velocity, decay pan on flick, gated behind a flag so tests stay deterministic); add an opt-in magnet crosshair that snaps to the hovered bar's OHLC (factor findCandleAt out of tooltip.ts into a shared helper). Relax only the active guard so a hovered non-active pane can publish its Data Window snapshot (keep single-writer). Track per-indicator source-symbol (RSI of SPX on BTC) and left/secondary price scale as deferred XL roadmap items — must show no-data for symbols without a live feed, never fabricate candles.
- **Findings:** INTERACTION-4, INTERACTION-6, DATAWINDOW-6, BROWSER-5, SCALE-6
- **Files:** packages/chart-core/src/chart-core.ts, packages/chart-core/src/scale.ts, packages/chart-core/src/layers/tooltip.ts, packages/chart-core/src/layers/crosshair.ts, packages/chart-core/src/viewport.ts, apps/web/features/terminal/chart-pane.tsx, apps/web/features/terminal/right-rail.tsx

## All verified findings

| id | sev | conf | title | effort |
|---|---|---|---|---|
| PANES-1 | blocker | high | Oscillator sub-panes don't share the chart's time axis, pan, or zoom (SVG-only, last-200-bars) | L |
| BROWSER-1 | high | high | Search matches only label/description substrings — no acronym/alias search | S |
| SETTINGS-1 | high | high | No tabbed settings modal — single flat inline editor, no Style/Visibility/Scale/About tabs | L |
| SETTINGS-2 | high | high | Color is a raw hex text input, not a swatch + color picker with opacity | M |
| SETTINGS-3 | high | high | No per-plot line width / line style (solid·dashed·dotted) controls — renderer supports them but UI and most push-sites don't expose them | M |
| LEGEND-1 | high | high | Legend row has no "more" (…) overflow menu — per-indicator actions (move to pane / pin to scale / visual order / source code / reset) all unreachable from the legend | M |
| LEGEND-3 | high | high | No symbol status-line legend (OHLC + change) at top-left of the pane | M |
| DATAWINDOW-3 | high | high | PulseScript, SMC suite and Signals & Trend Score never appear in the Data Window | L |
| MANAGER-1 | high | high | Indicator name truncates with no tooltip and no input summary | S |
| PANES-2 | high | high | No draggable separator to resize sub-panes (height is hardcoded 80px) | M |
| PANES-3 | high | high | No move-to-pane / move-to-new-pane action; paneId is computed once and ignored | L |
| SCALE-1 | high | high | No way to switch price-scale mode (Log / Percent / Indexed-to-100 / Auto / Regular) — modes declared but inert | L |
| SCALE-2 | high | high | Log-mode gridlines and axis labels computed in linear space → wrong, bunched, non-round ticks | M |
| SCALE-3 | high | high | Right-click on the price axis shows the generic chart menu, not a dedicated price-scale menu | M |
| DND-1 | high | high | Cannot drag an indicator from the dialog onto the chart (no overlay-vs-new-pane drop zones) | M |
| DND-2 | high | high | No 'move to pane' for indicators - paneId is set at creation and never reassignable | L |
| DND-3 | high | high | Sub-panes are fixed-height SVG rows with no draggable separator to resize | L |
| ALERTFROMIND-1 | high | high | No way to create an alert from an indicator — legend has no overflow/Add-alert entry point | M |
| ALERTFROMIND-2 | high | high | Alert engine + create schema are hard-locked to ma_cross — no indicator/plot alert type exists | L |
| ALERTFROMIND-3 | high | high | Working plot-cross condition evaluator already exists but is trapped in the MT5 SignalRunner | L |
| ALERTFROMIND-4 | high | high | Create-alert form has no plot/operator/level picker — it is a pure MA-cross form | L |
| INTERACTION-2 | high | high | Right-click menu is overlay-toggle-only — missing every TV staple action | M |
| INTERACTION-3 | high | high | No log / percent / auto price-scale modes and no price-axis context menu | L |
| COVERAGE-1 | high | high | Indicators not searchable by acronym/alias ("EMA", "BB", "RSI", "DMI" fail) | M |
| BROWSER-2 | medium | high | No left category sidebar — single long scroll instead of clickable category navigation | M |
| BROWSER-3 | medium | high | Saved PulseScripts are not browsable as indicators (no Personal / My scripts section) | L |
| SETTINGS-4 | medium | high | No per-plot enable checkbox, price-line toggle, or value-in-status-line toggle in Style | L |
| SETTINGS-5 | medium | high | No Defaults menu — cannot Save as default, Reset settings, or save/apply templates | M |
| SETTINGS-6 | medium | high | No per-instance precision / decimals control | M |
| LEGEND-2 | medium | high | Double-click a legend row does not open its Settings | S |
| DATAWINDOW-1 | medium | high | Indicator plot values are not colour-keyed to their plot colour | M |
| DATAWINDOW-2 | medium | high | Channel labels are raw internal keys, not human-readable plot names | M |
| MANAGER-2 | medium | high | Manager rows have no colour swatch, so multi-instance/variant rows look identical | S |
| PANES-4 | medium | high | No maximize / restore / collapse / hide controls per sub-pane | M |
| PANES-5 | medium | high | Sub-pane has no real price scale / right-axis aligned to the price pane's axis gutter | M |
| PANES-6 | medium | high | Crosshair and per-bar value readout don't extend into the oscillator sub-pane | M |
| SCALE-4 | medium | high | Auto-fit cannot be re-enabled except via an undiscoverable double-click; no explicit Auto control or state indicator | S |
| DND-4 | medium | high | Legend rows can't be dragged to reorder z-order or move panes | M |
| ALERTFROMIND-5 | medium | high | Indicator instance ids are per-pane/client-only — alert engine has no inputs to compute the plot server-side | M |
| ALERTFROMIND-6 | medium | high | AlertEvent shape assumes maValue — indicator alerts would have nothing meaningful to log/deliver | M |
| INTERACTION-1 | medium | high | Floating OHLC tooltip chases the cursor instead of living in a fixed status line | M |
| COVERAGE-2 | medium | high | No unified Moving Average entry with MA-type dropdown; DEMA/TEMA coded but unreachable; VWMA missing | M |
| COVERAGE-4 | medium | high | Input metadata incomplete/inconsistent — missing min/max on most numeric inputs; no per-input tooltip | M |
| BROWSER-4 | low | high | No per-indicator details / About / info on rows in the browser | M |
| BROWSER-5 | low | high | No per-indicator source-symbol picker in the browser | XL |
| BROWSER-6 | low | high | Favorites/Recently-used vanish during search instead of staying as a fast path | S |
| SETTINGS-7 | low | high | Settings editor is docked in the right rail, not a movable/centered dialog | M |
| SETTINGS-8 | low | high | Source dropdown missing on several indicators; candidate overstates how many can honor one | S |
| LEGEND-4 | low | high | No loading/computing state on legend rows while an indicator is recomputing | S |
| LEGEND-5 | low | high | Legend cannot be collapsed/minimized | S |
| DATAWINDOW-4 | low | high | No source-price row and no coloured Change bar | S |
| DATAWINDOW-5 | low | high | Hidden indicators are not visually distinguished — they render as all-dashes | S |
| DATAWINDOW-6 | low | high | Data Window only ever reflects the active pane; inactive panes show nothing | M |
| MANAGER-3 | low | high | No drag-to-reorder; reorder is one-step-at-a-time up/down chevrons only | M |
| MANAGER-4 | low | high | Manager is a flat list with no grouping by pane (overlay vs sub-pane) | S |
| SCALE-5 | low | high | Invert scale exists in state but is unreachable; 'Lock price to bar ratio' is missing | S |
| SCALE-6 | low | high | Only a single right-side price scale; no left scale / multiple scales | XL |
| DND-5 | low | high | Legend controls are hover-gated with no focus-within fallback; the two missing interactions have no keyboard path | S |
| ALERTFROMIND-7 | low | high | Backtest/optimize/sizer/walk-forward actions on an indicator alert would 400 — they assume ma_cross | S |
| INTERACTION-4 | low | high | Pan and zoom are instant/1:1 — no inertia or smooth zoom, feels abrupt vs TV | L |
| INTERACTION-5 | low | high | Canvas has no cursor affordances (no crosshair / grab / grabbing) | S |
| INTERACTION-6 | low | high | Crosshair does not magnet-snap to OHLC and price label is raw cursor price | M |
| COVERAGE-3 | low | high | No Offset input on MAs/overlays | M |
| COVERAGE-5 | low | high | Source input missing on Bollinger (TV exposes it) | S |
