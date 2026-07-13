import { describe, expect, it } from 'vitest';
import { evaluateAutomationGate } from '../apps/api/src/broker/automation-gate';

describe('evaluateAutomationGate — caps + kill-switch (GW-7)', () => {
  it('allows when nothing blocks it', () => {
    expect(evaluateAutomationGate({ killSwitchHalted: false, tradesToday: 0 })).toEqual({ allowed: true });
  });

  it('blocks when the dd-breaker kill-switch is halted', () => {
    const r = evaluateAutomationGate({ killSwitchHalted: true, tradesToday: 0, maxTradesPerDay: 5 });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('kill_switch');
  });

  it('kill-switch takes precedence over the daily cap', () => {
    const r = evaluateAutomationGate({ killSwitchHalted: true, tradesToday: 99, maxTradesPerDay: 3 });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('kill_switch');
  });

  it('blocks when the alert has hit its daily cap', () => {
    const r = evaluateAutomationGate({ killSwitchHalted: false, tradesToday: 3, maxTradesPerDay: 3 });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe('daily_cap');
  });

  it('allows the last trade under the cap', () => {
    expect(evaluateAutomationGate({ killSwitchHalted: false, tradesToday: 2, maxTradesPerDay: 3 }).allowed).toBe(true);
  });

  it('treats an omitted / non-positive cap as unlimited (still kill-switch gated)', () => {
    expect(evaluateAutomationGate({ killSwitchHalted: false, tradesToday: 1000 }).allowed).toBe(true);
    expect(evaluateAutomationGate({ killSwitchHalted: false, tradesToday: 1000, maxTradesPerDay: 0 }).allowed).toBe(true);
  });
});
