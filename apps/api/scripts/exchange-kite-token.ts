// Daily Kite token refresh (owner CLI — the GW-2 wizard automates this in the UI).
//
//   Step 1:  pnpm tsx apps/api/scripts/exchange-kite-token.ts
//            → prints YOUR login URL. Open it, log in to Zerodha, and you land on a
//              redirect URL containing `request_token=XXXX`.
//   Step 2:  pnpm tsx apps/api/scripts/exchange-kite-token.ts XXXX
//            → exchanges it, writes the fresh KITE_ACCESS_TOKEN into the root .env,
//              and validates by fetching your profile.
//
// Secrets never leave this machine; nothing secret is printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { findEnvFile, loadEnvFile } from '../src/env';
import { KiteGateway } from '../src/broker/kite-gateway';

loadEnvFile();
const apiKey = process.env.KITE_API_KEY ?? '';
const apiSecret = process.env.KITE_API_SECRET ?? '';
if (!apiKey || !apiSecret) {
  console.error('missing KITE_API_KEY / KITE_API_SECRET in .env');
  process.exit(1);
}

const requestToken = process.argv[2];

async function main(): Promise<void> {
  if (!requestToken) {
    console.log('Open this URL, log in, then re-run with the request_token from the redirect:');
    console.log(`  https://kite.zerodha.com/connect/login?v=3&api_key=${apiKey}`);
    console.log(`Then:  pnpm tsx apps/api/scripts/exchange-kite-token.ts <request_token>`);
    return;
  }
  const { accessToken, meta } = await KiteGateway.exchangeRequestToken(apiKey, apiSecret, requestToken);
  const envPath = findEnvFile();
  if (!envPath) throw new Error('.env not found');
  const src = readFileSync(envPath, 'utf8');
  const line = `KITE_ACCESS_TOKEN=${accessToken}`;
  const next = /^KITE_ACCESS_TOKEN=.*$/m.test(src)
    ? src.replace(/^KITE_ACCESS_TOKEN=.*$/m, line)
    : `${src.trimEnd()}\n${line}\n`;
  writeFileSync(envPath, next);
  console.log(`[exchange] OK — token refreshed in .env for account ${meta.accountId} (${meta.name})`);
  const gw = new KiteGateway({ apiKey, accessToken });
  const profile = await gw.validate();
  console.log(`[validate] OK — ${profile.accountId} live`);
}

main().catch((err) => {
  console.error('[exchange] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
