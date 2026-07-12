import { afterEach, describe, expect, it } from 'vitest';
import { emailConfigured, emailVerificationRequired, generateCode } from '../apps/api/src/email';

const KEYS = ['RESEND_API_KEY', 'EMAIL_DEV_LOG'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('email verification gating', () => {
  it('generateCode returns a zero-padded 6-digit numeric string', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('is NOT required when no email is configured (site stays instant-signup)', () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_DEV_LOG;
    expect(emailConfigured()).toBe(false);
    expect(emailVerificationRequired()).toBe(false);
  });

  it('is required once a Resend key is present', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.EMAIL_DEV_LOG;
    expect(emailConfigured()).toBe(true);
    expect(emailVerificationRequired()).toBe(true);
  });

  it('the dev-log flag forces verification without real sending', () => {
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_DEV_LOG = '1';
    expect(emailConfigured()).toBe(false); // no real provider
    expect(emailVerificationRequired()).toBe(true); // but still gated (dev)
  });
});
