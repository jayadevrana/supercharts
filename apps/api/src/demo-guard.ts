/**
 * Read-only DEMO mode.
 *
 * When DEMO_MODE is on (set for a public demo tunnel), the API becomes safe to expose to
 * strangers: it serves charts + read-only dashboards but refuses anything that could
 * mutate state, leak the owner's secrets, or abuse the Telegram/MT5 integrations.
 *
 * The app has no real auth yet (every request is the `demo` user — Phase 5 #20), so this
 * is the safety boundary for the public link. The alert engine keeps running normally on
 * the owner's machine; this only gates the HTTP surface.
 */
import type { FastifyInstance } from 'fastify';

export function isDemoMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.DEMO_MODE === '1' || env.DEMO_MODE === 'true';
}

// Pure, read-only POSTs that only compute over existing data — safe to keep enabled so the
// demo can show backtests / optimizer / walk-forward / sizer / ad-hoc heat baskets.
const READONLY_POSTS: RegExp[] = [
  /\/backtest$/,
  /\/optimize$/,
  /\/walk-forward$/,
  /\/sizer-preview$/,
];

// GETs that would leak the owner's private config — blocked even though they're reads.
const BLOCKED_GETS: RegExp[] = [
  /^\/api\/alerts\/telegram/, // bot tokens (last-4), chat ids, discovered chats
  /^\/api\/mt5/, // broker account info
  /^\/api\/billing/, // Stripe
];

/**
 * Install the demo guard. No-op unless DEMO_MODE is set. Registered as an onRequest hook
 * so it runs before every route handler regardless of registration order.
 */
export function registerDemoGuard(app: FastifyInstance, env: NodeJS.ProcessEnv = process.env): void {
  if (!isDemoMode(env)) return;
  app.log.warn('[api] DEMO_MODE active — public read-only demo: mutations + secret routes are blocked');

  app.addHook('onRequest', async (req, reply) => {
    const method = req.method.toUpperCase();
    const path = (req.url.split('?')[0] ?? req.url).toLowerCase();

    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      if (BLOCKED_GETS.some((re) => re.test(path))) {
        return reply.code(403).send({ error: 'demo_hidden', message: 'Hidden in read-only demo.' });
      }
      return; // all other reads allowed
    }

    // Any state-changing method: allow only the explicit read-only compute POSTs.
    if (method === 'POST' && READONLY_POSTS.some((re) => re.test(path))) return;

    return reply.code(403).send({ error: 'demo_read_only', message: 'This is a read-only demo — changes are disabled.' });
  });
}
