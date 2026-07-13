import { describe, expect, it } from 'vitest';
import { allocateEgress, type EgressIpRow, type EgressAssignmentRow } from '../apps/api/src/broker/egress-allocator';

const ip = (id: string, source: EgressIpRow['source'] = 'proxy', status: EgressIpRow['status'] = 'active'): EgressIpRow => ({ id, source, status });
const asg = (egressIpId: string, broker: string, userId: string): EgressAssignmentRow => ({ egressIpId, broker, userId });

describe('SEBI-compliant egress allocation', () => {
  it('idempotent: a user who already holds a broker slot keeps the same IP', () => {
    const r = allocateEgress([ip('a')], [asg('a', 'kite', 'u1')], 'kite', 'u1');
    expect(r).toEqual({ kind: 'already', egressIpId: 'a' });
  });

  it('never puts two Zerodha clients on one IP — needs a new IP', () => {
    const r = allocateEgress([ip('a')], [asg('a', 'kite', 'u1')], 'kite', 'u2');
    expect(r).toEqual({ kind: 'needs_new_ip' });
  });

  it('lets 1 Zerodha + 1 Angel + 1 Dhan share ONE IP', () => {
    const assignments = [asg('a', 'kite', 'u1'), asg('a', 'angel', 'u2')];
    const r = allocateEgress([ip('a')], assignments, 'dhan', 'u3');
    expect(r).toEqual({ kind: 'existing', egressIpId: 'a' });
  });

  it('bin-packs onto the fullest usable IP before provisioning a new one', () => {
    const pool = [ip('a'), ip('b')];
    // a already serves an angel user; b is empty. A new kite user can go on either (no kite on
    // either yet) — pack onto the fuller one (a).
    const assignments = [asg('a', 'angel', 'u1')];
    const r = allocateEgress(pool, assignments, 'kite', 'u2');
    expect(r).toEqual({ kind: 'existing', egressIpId: 'a' });
  });

  it('skips IPs already holding that broker and uses the next free one', () => {
    const pool = [ip('a'), ip('b')];
    const assignments = [asg('a', 'kite', 'u1')]; // a is blocked for kite
    const r = allocateEgress(pool, assignments, 'kite', 'u2');
    expect(r).toEqual({ kind: 'existing', egressIpId: 'b' });
  });

  it('ignores disabled IPs', () => {
    const r = allocateEgress([ip('a', 'proxy', 'disabled')], [], 'kite', 'u1');
    expect(r).toEqual({ kind: 'needs_new_ip' });
  });

  it('empty pool → needs a new IP', () => {
    expect(allocateEgress([], [], 'kite', 'u1')).toEqual({ kind: 'needs_new_ip' });
  });
});
