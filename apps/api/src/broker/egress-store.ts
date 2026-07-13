import { nanoid } from 'nanoid';
import { ProxyAgent, type Dispatcher } from 'undici';
import type { AppDB } from '../db';
import { decryptSecret, encryptSecret } from './crypto';
import { allocateEgress, type EgressAssignmentRow, type EgressIpRow } from './egress-allocator';

/** Public pool view for the admin panel — NO proxy_url (a secret). */
export interface EgressIpSummary {
  id: string;
  ip: string;
  source: 'vm' | 'proxy' | 'vps';
  region: string | null;
  label: string | null;
  status: 'active' | 'disabled';
  createdAt: number;
  /** broker-slots currently taken on this IP (the SEBI capacity view). */
  brokersUsed: string[];
}

/** Where a user's orders egress from (server-side; carries the decrypted proxy for routing). */
export interface UserEgress {
  egressIpId: string;
  ip: string;
  source: 'vm' | 'proxy' | 'vps';
  proxyUrl: string | null; // decrypted; direct/VM when null
  whitelisted: boolean;
}

/** Seed the main VM IP as a `vm` egress (proxy_url NULL = direct fetch). Idempotent. */
export function seedVmEgress(db: AppDB, ip: string): void {
  const existing = db.raw.prepare("SELECT id FROM egress_ips WHERE source = 'vm'").get() as { id: string } | undefined;
  if (existing) return;
  db.raw
    .prepare("INSERT INTO egress_ips (id, ip, proxy_url, source, region, label, status, created_at) VALUES (?, ?, NULL, 'vm', ?, 'Main VM', 'active', ?)")
    .run(`eip_vm`, ip, process.env.EGRESS_VM_REGION ?? null, Date.now());
}

export function addEgressIp(db: AppDB, input: {
  ip: string; proxyUrl: string; source?: 'proxy' | 'vps'; region?: string | null; label?: string | null;
}): { id: string } {
  const id = `eip_${nanoid(12)}`;
  db.raw
    .prepare('INSERT INTO egress_ips (id, ip, proxy_url, source, region, label, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, input.ip, encryptSecret(input.proxyUrl), input.source ?? 'proxy', input.region ?? null, input.label ?? null, 'active', Date.now());
  return { id };
}

export function listEgressPool(db: AppDB): EgressIpSummary[] {
  const ips = db.raw
    .prepare('SELECT id, ip, source, region, label, status, created_at as createdAt FROM egress_ips ORDER BY created_at ASC')
    .all() as Array<Omit<EgressIpSummary, 'brokersUsed'>>;
  const assignments = db.raw.prepare('SELECT egress_ip_id as egressIpId, broker FROM ip_assignments').all() as Array<{ egressIpId: string; broker: string }>;
  return ips.map((ip) => ({ ...ip, brokersUsed: assignments.filter((a) => a.egressIpId === ip.id).map((a) => a.broker) }));
}

export function removeEgressIp(db: AppDB, id: string): boolean {
  const res = db.raw.prepare('DELETE FROM egress_ips WHERE id = ?').run(id);
  return Number(res.changes) > 0;
}

function poolRows(db: AppDB): EgressIpRow[] {
  return db.raw.prepare('SELECT id, source, status FROM egress_ips').all() as EgressIpRow[];
}
function assignmentRows(db: AppDB): EgressAssignmentRow[] {
  return db.raw.prepare('SELECT egress_ip_id as egressIpId, broker, user_id as userId FROM ip_assignments').all() as EgressAssignmentRow[];
}

/** Assign (or find) the user's egress IP for a broker via the bin-packing allocator. */
export function assignEgress(db: AppDB, broker: string, userId: string):
  { status: 'assigned' | 'already'; egressIpId: string; ip: string } | { status: 'needs_ip' } {
  const result = allocateEgress(poolRows(db), assignmentRows(db), broker, userId);
  if (result.kind === 'needs_new_ip') return { status: 'needs_ip' };
  if (result.kind === 'existing') {
    db.raw
      .prepare('INSERT INTO ip_assignments (id, egress_ip_id, broker, user_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(`ipa_${nanoid(12)}`, result.egressIpId, broker, userId, Date.now());
  }
  const ip = (db.raw.prepare('SELECT ip FROM egress_ips WHERE id = ?').get(result.egressIpId) as { ip: string }).ip;
  return { status: result.kind === 'already' ? 'already' : 'assigned', egressIpId: result.egressIpId, ip };
}

export function getUserEgress(db: AppDB, broker: string, userId: string): UserEgress | null {
  const row = db.raw
    .prepare(
      `SELECT e.id as egressIpId, e.ip as ip, e.source as source, e.proxy_url as proxyUrl, a.whitelisted_at as whitelistedAt
         FROM ip_assignments a JOIN egress_ips e ON e.id = a.egress_ip_id
        WHERE a.broker = ? AND a.user_id = ?`,
    )
    .get(broker, userId) as
    | { egressIpId: string; ip: string; source: UserEgress['source']; proxyUrl: string | null; whitelistedAt: number | null }
    | undefined;
  if (!row) return null;
  return {
    egressIpId: row.egressIpId,
    ip: row.ip,
    source: row.source,
    proxyUrl: row.proxyUrl ? decryptSecret(row.proxyUrl) : null,
    whitelisted: row.whitelistedAt != null,
  };
}

export function confirmWhitelist(db: AppDB, broker: string, userId: string): boolean {
  const res = db.raw
    .prepare('UPDATE ip_assignments SET whitelisted_at = ? WHERE broker = ? AND user_id = ? AND whitelisted_at IS NULL')
    .run(Date.now(), broker, userId);
  return Number(res.changes) > 0;
}

// Cache one ProxyAgent per proxy URL — building one per order would leak sockets.
const dispatcherCache = new Map<string, ProxyAgent>();

/** undici dispatcher for a user's egress, or undefined for direct/VM-IP routing. */
export function dispatcherFor(egress: UserEgress | null): Dispatcher | undefined {
  if (!egress?.proxyUrl) return undefined;
  let agent = dispatcherCache.get(egress.proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(egress.proxyUrl);
    dispatcherCache.set(egress.proxyUrl, agent);
  }
  return agent;
}
