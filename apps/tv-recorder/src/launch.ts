/**
 * Open a persistent Chromium that the user logs into TradingView with.
 *
 * The user runs `pnpm --filter @supercharts/tv-recorder launch` once and logs
 * in manually. The session cookies live under `.tv-profile/` and are reused
 * by every subsequent recorder run, so the user never has to give Claude
 * their TradingView credentials.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PROFILE_DIR = resolve(process.cwd(), '.tv-profile');

async function main(): Promise<void> {
  mkdirSync(PROFILE_DIR, { recursive: true });
  console.log('[tv-recorder] launching Chromium with persistent profile at', PROFILE_DIR);
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--start-maximized'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('https://www.tradingview.com/chart/', { waitUntil: 'domcontentloaded' });
  console.log('\n[tv-recorder] Browser is open.');
  console.log('  1) Log into TradingView in this window if you are not already.');
  console.log('  2) Once you see the chart, close the browser window when done.');
  console.log('  3) Future `record` runs will reuse this session — no need to log in again.');

  await new Promise<void>((resolveDone) => {
    ctx.on('close', () => resolveDone());
  });
  console.log('[tv-recorder] profile saved.');
}

main().catch((err) => {
  console.error('[tv-recorder] launch failed', err);
  process.exit(1);
});
