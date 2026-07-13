import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { decryptSecret, encryptSecret } from './crypto';
import type { AccountMeta, BrokerId, OrderIntent } from './types';

export interface BrokerConnectionSummary {
  id: string;
  broker: BrokerId;
  apiKeyLast4: string;
  status: string;
  accountMeta: AccountMeta | null;
  lastLoginAt: number | null;
  createdAt: number;
}

export function saveConnection(db: AppDB, input: {
  userId: string; broker: BrokerId; apiKey: string; apiSecret: string;
  accessToken: string | null; accountMeta: AccountMeta | null;
}): { id: string } {
  const now = Date.now();
  const existing = db.raw
    .prepare('SELECT id FROM broker_connections WHERE user_id = ? AND broker = ?')
    .get(input.userId, input.broker) as { id: string } | undefined;
  const id = existing?.id ?? `bc_${nanoid(14)}`;
  const status = input.accessToken ? 'active' : 'pending';
  const tokenEnc = input.accessToken ? encryptSecret(input.accessToken) : null;
  if (existing) {
    db.raw.prepare(
      `UPDATE broker_connections SET api_key=?, api_secret=?, access_token=?, status=?, account_meta=?,
         last_login_at=CASE WHEN ? IS NULL THEN last_login_at ELSE ? END, updated_at=? WHERE id=?`,
    ).run(input.apiKey, encryptSecret(input.apiSecret), tokenEnc, status,
      input.accountMeta ? JSON.stringify(input.accountMeta) : null, tokenEnc, now, now, id);
  } else {
    db.raw.prepare(
      `INSERT INTO broker_connections (id, user_id, broker, api_key, api_secret, access_token, status, account_meta, last_login_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.userId, input.broker, input.apiKey, encryptSecret(input.apiSecret), tokenEnc, status,
      input.accountMeta ? JSON.stringify(input.accountMeta) : null, input.accessToken ? now : null, now, now);
  }
  return { id };
}

export function listConnections(db: AppDB, userId: string): BrokerConnectionSummary[] {
  const rows = db.raw.prepare(
    `SELECT id, broker, api_key as apiKey, status, account_meta as accountMeta, last_login_at as lastLoginAt, created_at as createdAt
       FROM broker_connections WHERE user_id = ? ORDER BY created_at ASC`,
  ).all(userId) as Array<{
    id: string; broker: BrokerId; apiKey: string; status: string;
    accountMeta: string | null; lastLoginAt: number | null; createdAt: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    broker: r.broker,
    apiKeyLast4: r.apiKey.slice(-4),
    status: r.status,
    accountMeta: r.accountMeta ? (JSON.parse(r.accountMeta) as AccountMeta) : null,
    lastLoginAt: r.lastLoginAt,
    createdAt: r.createdAt,
  }));
}

/**
 * Compliance gate (spec §3.7-2): broker market data is served ONLY to users with their own
 * active connection for that broker — never fanned out to anyone else.
 */
export function hasActiveConnection(db: AppDB, userId: string | null | undefined, broker: BrokerId): boolean {
  if (!userId) return false;
  const row = db.raw
    .prepare("SELECT 1 as ok FROM broker_connections WHERE user_id = ? AND broker = ? AND status = 'active'")
    .get(userId, broker) as { ok: number } | undefined;
  return Boolean(row);
}

/** Newest ACTIVE connection's decrypted creds for a broker, any user — drives the boot-time feed. */
export function newestActiveCredentials(db: AppDB, broker: BrokerId):
  { apiKey: string; accessToken: string } | null {
  const row = db.raw
    .prepare(
      `SELECT api_key as apiKey, access_token as accessToken FROM broker_connections
        WHERE broker = ? AND status = 'active' AND access_token IS NOT NULL
        ORDER BY last_login_at DESC LIMIT 1`,
    )
    .get(broker) as { apiKey: string; accessToken: string } | undefined;
  if (!row?.accessToken) return null;
  return { apiKey: row.apiKey, accessToken: decryptSecret(row.accessToken) };
}

/** Decrypted credentials for building a gateway — SERVER-SIDE ONLY, never returned by a route. */
export function getGatewayCredentials(db: AppDB, userId: string, broker: BrokerId):
  { apiKey: string; apiSecret: string; accessToken: string | null } | null {
  const row = db.raw.prepare(
    'SELECT api_key as apiKey, api_secret as apiSecret, access_token as accessToken FROM broker_connections WHERE user_id = ? AND broker = ?',
  ).get(userId, broker) as { apiKey: string; apiSecret: string; accessToken: string | null } | undefined;
  if (!row) return null;
  return {
    apiKey: row.apiKey,
    apiSecret: decryptSecret(row.apiSecret),
    accessToken: row.accessToken ? decryptSecret(row.accessToken) : null,
  };
}

export function updateAccessToken(db: AppDB, userId: string, broker: BrokerId, accessToken: string): void {
  db.raw.prepare(
    "UPDATE broker_connections SET access_token = ?, status = 'active', last_login_at = ?, updated_at = ? WHERE user_id = ? AND broker = ?",
  ).run(encryptSecret(accessToken), Date.now(), Date.now(), userId, broker);
}

export function deleteConnection(db: AppDB, userId: string, broker: BrokerId): boolean {
  const res = db.raw.prepare('DELETE FROM broker_connections WHERE user_id = ? AND broker = ?').run(userId, broker);
  return Number(res.changes) > 0;
}

/**
 * Spec hard rule 5: the audit row lands BEFORE any request hits a broker.
 * `intent` is a full OrderIntent for placements/exits, or an action descriptor
 * (`{ action: 'modify' | 'cancel', … }`) for order mutations — both JSON-serialised verbatim.
 */
export function recordOrderAudit(db: AppDB, input: {
  userId: string; broker: BrokerId; intent: OrderIntent | Record<string, unknown>;
  placedVia: 'manual' | 'alert' | 'indicator'; egressIp: string | null;
}): string {
  const id = `bo_${nanoid(14)}`;
  const now = Date.now();
  db.raw.prepare(
    `INSERT INTO broker_orders (id, user_id, broker, intent, status, placed_via, egress_ip, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?)`,
  ).run(id, input.userId, input.broker, JSON.stringify(input.intent), input.placedVia, input.egressIp, now, now);
  return id;
}

export function completeOrderAudit(db: AppDB, auditId: string, result: {
  brokerOrderId?: string; status: string; error?: string;
}): void {
  db.raw.prepare(
    'UPDATE broker_orders SET broker_order_id = COALESCE(?, broker_order_id), status = ?, error = ?, updated_at = ? WHERE id = ?',
  ).run(result.brokerOrderId ?? null, result.status, result.error ?? null, Date.now(), auditId);
}
