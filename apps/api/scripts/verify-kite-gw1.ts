// GW-1 live verification. READ mode by default (profile/positions/orders).
//   pnpm tsx apps/api/scripts/verify-kite-gw1.ts            # reads only
//   pnpm tsx apps/api/scripts/verify-kite-gw1.ts --write    # + far-limit AMO place->cancel
// Requires KITE_API_KEY / KITE_ACCESS_TOKEN in the root .env (KITE_API_SECRET for token exchange).
// Never prints secret values — only the key's last-4 and call results.
import { loadEnvFile } from '../src/env';
import { KiteGateway } from '../src/broker/kite-gateway';

loadEnvFile();
const apiKey = process.env.KITE_API_KEY ?? '';
const accessToken = process.env.KITE_ACCESS_TOKEN ?? '';
if (!apiKey || !accessToken) {
  console.error('missing KITE_API_KEY / KITE_ACCESS_TOKEN in .env');
  process.exit(1);
}

async function main(): Promise<void> {
  const gw = new KiteGateway({ apiKey, accessToken });
  const meta = await gw.validate();
  console.log(`[validate] OK — account ${meta.accountId} (${meta.name}) key …${apiKey.slice(-4)}`);
  const positions = await gw.getPositions();
  console.log(`[positions] ${positions.length} net position(s)`);
  const orders = await gw.getOrders();
  console.log(`[orders] ${orders.length} order(s) today`);

  if (process.argv.includes('--write')) {
    // SAFE write probe: 1-qty LIMIT far below market as AMO (works when market closed), then cancel.
    const intent = {
      symbol: 'IDEA', exchange: 'NSE', side: 'buy', quantity: 1,
      orderType: 'limit', product: 'cnc', price: 1.0, variety: 'amo',
    } as const;
    console.log(`[write] placing ${JSON.stringify(intent)}`);
    const ref = await gw.placeOrder(intent);
    console.log(`[write] placed AMO order ${ref.brokerOrderId} — cancelling…`);
    await gw.cancelOrder(ref.brokerOrderId, 'amo');
    console.log('[write] cancelled OK — write plane verified');
  }
}

main().catch((err) => {
  console.error('[verify] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
