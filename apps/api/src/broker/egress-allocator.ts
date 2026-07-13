/**
 * Egress-IP allocation for the order write-plane (GW-5), pure so the SEBI rule is unit-tested.
 *
 * SEBI retail-algo framework: a broker whitelists a static IP **per client**, and the same IP
 * may NOT map to two clients of the SAME broker. So one IP can carry 1 Zerodha + 1 Angel + 1 Dhan
 * simultaneously, but never 2 Zerodha. We bin-pack: a new (broker, user) fills a free broker-slot
 * on an already-used IP before we ever provision a fresh one — mixed-broker growth is near-free.
 */
export interface EgressIpRow {
  id: string;
  source: 'vm' | 'proxy' | 'vps';
  status: 'active' | 'disabled';
}

export interface EgressAssignmentRow {
  egressIpId: string;
  broker: string;
  userId: string;
}

export type AllocationResult =
  | { kind: 'existing'; egressIpId: string }
  | { kind: 'already'; egressIpId: string }
  | { kind: 'needs_new_ip' };

/**
 * Decide which egress IP a (broker, user) should use.
 * - `already`  — the user already holds a slot for this broker (idempotent).
 * - `existing` — an active IP has a free slot for this broker; bin-pack onto the fullest one.
 * - `needs_new_ip` — every active IP already serves another client of this broker.
 */
export function allocateEgress(
  pool: EgressIpRow[],
  assignments: EgressAssignmentRow[],
  broker: string,
  userId: string,
): AllocationResult {
  const mine = assignments.find((a) => a.broker === broker && a.userId === userId);
  if (mine) return { kind: 'already', egressIpId: mine.egressIpId };

  // An IP is BLOCKED for this broker if it already serves any client of that broker.
  const blocked = new Set(assignments.filter((a) => a.broker === broker).map((a) => a.egressIpId));

  const candidates = pool
    .filter((ip) => ip.status === 'active' && !blocked.has(ip.id))
    .map((ip) => ({ ip, load: assignments.filter((a) => a.egressIpId === ip.id).length }))
    // Bin-pack: fill the fullest usable IP first (fewest new IPs overall); stable by id.
    .sort((a, b) => b.load - a.load || a.ip.id.localeCompare(b.ip.id));

  const chosen = candidates[0];
  return chosen ? { kind: 'existing', egressIpId: chosen.ip.id } : { kind: 'needs_new_ip' };
}
