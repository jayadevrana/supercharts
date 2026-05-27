/**
 * Walks through the most-used TradingView features, captures DOM selectors
 * and full-page screenshots, and writes a JSON spec to `output/tv-features.json`
 * plus PNGs to `output/screens/`. Future SuperCharts work uses this spec as a
 * source of truth for what each feature looks like and which controls fire it.
 *
 * The recorder is intentionally tolerant — TradingView's DOM changes often,
 * so each probe is best-effort: if a selector is missing, the spec records
 * `available: false` rather than aborting the whole run.
 */

import { chromium, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FeatureProbeResult {
  id: string;
  label: string;
  available: boolean;
  selectors: string[];
  notes?: string;
  screenshot?: string;
}

interface RecordingOutput {
  recordedAt: string;
  tvUrl: string;
  features: FeatureProbeResult[];
}

const PROFILE_DIR = resolve(process.cwd(), '.tv-profile');
const OUTPUT_DIR  = resolve(process.cwd(), 'output');
const SCREENS_DIR = resolve(OUTPUT_DIR, 'screens');
const SPEC_PATH   = resolve(OUTPUT_DIR, 'tv-features.json');

async function main(): Promise<void> {
  mkdirSync(SCREENS_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  console.log('[tv-recorder] navigating to TradingView chart…');
  await page.goto('https://www.tradingview.com/chart/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // If the user is not logged in, surface a hint but continue — public charts
  // still expose most of the UX we care about.
  const isLoggedIn = await page.locator('[data-name="header-user-menu-button"]').isVisible().catch(() => false);
  console.log(`[tv-recorder] logged in: ${isLoggedIn}`);

  const features: FeatureProbeResult[] = [];

  features.push(await probe(page, 'symbol_search', 'Symbol search', [
    '[data-name="symbol-search-items-dialog"]',
    'input[data-role="search"]',
    'button[id*="header-toolbar-symbol-search"]',
  ], async (p) => {
    await p.keyboard.press('/');
    await p.waitForTimeout(800);
    await p.keyboard.press('Escape');
  }));

  features.push(await probe(page, 'interval_picker', 'Interval picker', [
    '[id*="header-toolbar-intervals"]',
    '[data-name="time-interval"]',
  ]));

  features.push(await probe(page, 'chart_type', 'Chart type', [
    '[id*="header-toolbar-chart-styles"]',
    'div[data-name="chart-styles-menu-container"]',
  ]));

  features.push(await probe(page, 'indicator_dialog', 'Indicators dialog', [
    '[data-name="open-indicators-dialog"]',
    '[data-dialog-name="indicators"]',
  ], async (p) => {
    const btn = p.locator('[data-name="open-indicators-dialog"]').first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await p.waitForTimeout(1200);
      await p.keyboard.press('Escape');
    }
  }));

  features.push(await probe(page, 'compare_symbol', 'Compare symbol', [
    '[data-name="compare-button"]',
  ]));

  features.push(await probe(page, 'layout_picker', 'Multi-chart layout', [
    '[id*="header-layout"]',
    '[data-name="multi-chart-layouts-menu-container"]',
    'div[class*="multipleChartsLayouts"]',
  ]));

  features.push(await probe(page, 'replay_bar', 'Bar replay', [
    '[data-name="market-replay"]',
    '[id*="header-toolbar-replay"]',
  ]));

  features.push(await probe(page, 'drawing_toolbar', 'Drawing toolbar (left rail)', [
    'div[class*="drawingToolbar"]',
    '[data-name="drawing-toolbar"]',
  ]));

  features.push(await probe(page, 'order_panel', 'Trading panel (bottom)', [
    '[data-name="bottom-toolbar"]',
    '[data-name="header-toolbar-trading"]',
    'div[class*="orderPanel"]',
  ]));

  features.push(await probe(page, 'alerts', 'Alerts manager', [
    '[data-name="alerts-toolbar"]',
    '[data-name="alerts-list"]',
  ]));

  features.push(await probe(page, 'screener', 'Stock screener', [
    'div[class*="screener-"]',
    '[data-name="bottom-screener-button"]',
  ]));

  features.push(await probe(page, 'watchlist', 'Watchlist panel (right rail)', [
    'div[class*="watchlist"]',
    'div[data-name="watchlist"]',
  ]));

  // Full chart screenshot for visual reference.
  const fullPng = resolve(SCREENS_DIR, 'tv-full.png');
  await page.screenshot({ path: fullPng, fullPage: false });
  console.log('[tv-recorder] full chart →', fullPng);

  const out: RecordingOutput = {
    recordedAt: new Date().toISOString(),
    tvUrl: page.url(),
    features,
  };
  writeFileSync(SPEC_PATH, JSON.stringify(out, null, 2));
  console.log('[tv-recorder] wrote spec →', SPEC_PATH);

  await ctx.close();
}

async function probe(
  page: Page,
  id: string,
  label: string,
  selectors: string[],
  beforeShot?: (page: Page) => Promise<void>,
): Promise<FeatureProbeResult> {
  let available = false;
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) {
      available = true;
      break;
    }
  }
  let screenshot: string | undefined;
  try {
    if (beforeShot) await beforeShot(page);
    const out = resolve(SCREENS_DIR, `${id}.png`);
    await page.screenshot({ path: out, fullPage: false });
    screenshot = `screens/${id}.png`;
  } catch {
    /* ignore */
  }
  console.log(`[tv-recorder] ${id} · ${label} · available=${available}`);
  return { id, label, available, selectors, screenshot };
}

main().catch((err) => {
  console.error('[tv-recorder] record failed', err);
  process.exit(1);
});
