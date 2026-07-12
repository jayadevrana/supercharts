import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../apps/api/src/auth';

describe('password hashing (scrypt)', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('s3cret-pass');
    expect(verifyPassword('s3cret-Pass', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('salts — the same password hashes differently each time', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(verifyPassword('same-password', a)).toBe(true);
    expect(verifyPassword('same-password', b)).toBe(true);
  });

  it('produces the scrypt$salt$hash shape', () => {
    const stored = hashPassword('shape-check');
    const parts = stored.split('$');
    expect(parts[0]).toBe('scrypt');
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte salt hex
    expect(parts[2]).toMatch(/^[0-9a-f]{128}$/); // 64-byte hash hex
  });

  it('rejects null/empty/malformed stored values without throwing', () => {
    expect(verifyPassword('x', null)).toBe(false);
    expect(verifyPassword('x', undefined)).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'bcrypt$aa$bb')).toBe(false);
  });
});
