import { describe, expect, it } from 'vitest';
import { resolvePlanAccess, resolvePlanUpdate } from '../apps/api/src/plan';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

describe('resolvePlanAccess', () => {
  it('admin always has access regardless of plan/expiry', () => {
    expect(resolvePlanAccess({ role: 'admin', plan: 'free' }, NOW)).toEqual({ allowed: true, tier: 'pro', reason: 'admin' });
    expect(resolvePlanAccess({ role: 'admin', plan: 'pro', planExpiresAt: NOW - DAY }, NOW)).toMatchObject({ allowed: true, reason: 'admin' });
  });

  it('a free user is denied', () => {
    expect(resolvePlanAccess({ role: 'user', plan: 'free' }, NOW)).toEqual({ allowed: false, tier: 'free', reason: 'free' });
    // Missing plan column defaults to free.
    expect(resolvePlanAccess({ role: 'user' }, NOW)).toMatchObject({ allowed: false, reason: 'free' });
  });

  it('a pro user with no expiry (lifetime) has access', () => {
    expect(resolvePlanAccess({ role: 'user', plan: 'pro', planExpiresAt: null }, NOW)).toEqual({ allowed: true, tier: 'pro', reason: 'active' });
  });

  it('a pro user with a future expiry has access; an expired one is denied', () => {
    expect(resolvePlanAccess({ role: 'user', plan: 'pro', planExpiresAt: NOW + DAY }, NOW)).toMatchObject({ allowed: true, reason: 'active' });
    expect(resolvePlanAccess({ role: 'user', plan: 'pro', planExpiresAt: NOW - 1 }, NOW)).toEqual({ allowed: false, tier: 'pro', reason: 'expired' });
    // Exactly at the boundary counts as expired.
    expect(resolvePlanAccess({ role: 'user', plan: 'pro', planExpiresAt: NOW }, NOW)).toMatchObject({ allowed: false, reason: 'expired' });
  });
});

describe('resolvePlanUpdate', () => {
  it('free clears the expiry', () => {
    expect(resolvePlanUpdate({ plan: 'free' }, NOW)).toEqual({ plan: 'free', expiresAt: null });
    expect(resolvePlanUpdate({ plan: 'free', durationDays: 30 }, NOW)).toEqual({ plan: 'free', expiresAt: null });
  });

  it('pro with durationDays computes a future expiry', () => {
    expect(resolvePlanUpdate({ plan: 'pro', durationDays: 30 }, NOW)).toEqual({ plan: 'pro', expiresAt: NOW + 30 * DAY });
  });

  it('pro with an explicit expiresAt uses it', () => {
    expect(resolvePlanUpdate({ plan: 'pro', expiresAt: NOW + 5 * DAY }, NOW)).toEqual({ plan: 'pro', expiresAt: NOW + 5 * DAY });
  });

  it('pro with neither is lifetime (null expiry)', () => {
    expect(resolvePlanUpdate({ plan: 'pro' }, NOW)).toEqual({ plan: 'pro', expiresAt: null });
  });
});
