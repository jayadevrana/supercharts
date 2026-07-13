import type { AppDB } from '../db';
import type { BrokerGateway } from './types';
import { KiteGateway } from './kite-gateway';
import { getGatewayCredentials } from './store';
import { assignEgress, dispatcherFor, getUserEgress } from './egress-store';

/**
 * Builds a per-request execution gateway from a user's decrypted broker credentials, optionally
 * routed through the user's assigned egress-IP proxy (GW-5). Injectable so both the HTTP trading
 * routes AND the GW-7 alert-order executor can be unit-tested against a stub without hitting Kite.
 */
export type BrokerGatewayFactory = (
  creds: { apiKey: string; accessToken: string },
  dispatcher?: unknown,
) => BrokerGateway;

/** The real Kite factory used in production by both the trade routes and the alert executor. */
export const defaultKiteGatewayFactory: BrokerGatewayFactory = (creds, dispatcher) =>
  new KiteGateway({ apiKey: creds.apiKey, accessToken: creds.accessToken, proxyDispatcher: dispatcher });

export interface ResolvedWriteGateway {
  /** Main-VM-IP gateway for READS (positions/orders) — brokers don't IP-restrict reads. */
  readGw: BrokerGateway;
  /** Egress-IP-routed gateway for WRITES (place/modify/cancel/exit) — the SEBI-whitelisted path. */
  writeGw: BrokerGateway;
  egressIp: string;
}

/** Honest failure reasons, mapped to HTTP codes by the route and to skip-reasons by the executor. */
export type WriteGatewayResolution =
  | { ok: true; value: ResolvedWriteGateway }
  | { ok: false; code: 404 | 409; error: string; message: string; ip?: string };

/**
 * THE single audited write-plane resolver (spec §3.1/§3.7-3: order code lives in the gateway
 * module only). Resolves the user's Kite credentials + assigned egress IP, requires the IP to be
 * whitelisted before any order can leave, and returns both a read gateway (main IP) and a write
 * gateway (egress proxy). Any missing precondition returns a typed error instead of throwing.
 */
export function resolveWriteGateway(
  db: AppDB,
  gatewayFactory: BrokerGatewayFactory,
  userId: string,
  broker: 'kite',
): WriteGatewayResolution {
  const creds = getGatewayCredentials(db, userId, broker);
  if (!creds) {
    return { ok: false, code: 404, error: 'not_connected', message: 'Connect your Kite app first.' };
  }
  if (!creds.accessToken) {
    return { ok: false, code: 409, error: 'token_expired', message: 'Reconnect Kite for a fresh daily token before trading.' };
  }
  let egress = getUserEgress(db, broker, userId);
  if (!egress) {
    const a = assignEgress(db, broker, userId);
    if (a.status === 'needs_ip') {
      return { ok: false, code: 409, error: 'no_egress_ip', message: 'No order-routing IP is available yet — contact support to add one.' };
    }
    egress = getUserEgress(db, broker, userId);
  }
  if (!egress || !egress.whitelisted) {
    return {
      ok: false,
      code: 409,
      error: 'ip_not_whitelisted',
      message: `Whitelist your order-routing IP ${egress?.ip ?? ''} in your Kite app, then confirm — SEBI requires it before placing orders.`,
      ip: egress?.ip,
    };
  }
  const gwCreds = { apiKey: creds.apiKey, accessToken: creds.accessToken };
  return {
    ok: true,
    value: {
      readGw: gatewayFactory(gwCreds),
      writeGw: gatewayFactory(gwCreds, dispatcherFor(egress)),
      egressIp: egress.ip,
    },
  };
}
