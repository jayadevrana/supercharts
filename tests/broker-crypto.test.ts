import { describe, expect, it } from 'vitest';
import { encryptSecret, decryptSecret } from '../apps/api/src/broker/crypto';

const KEY = 'a'.repeat(64); // 32-byte hex test key

describe('broker secret encryption', () => {
  it('round-trips a secret', () => {
    const stored = encryptSecret('my-api-secret-123', KEY);
    expect(stored.startsWith('v1$')).toBe(true);
    expect(stored).not.toContain('my-api-secret-123');
    expect(decryptSecret(stored, KEY)).toBe('my-api-secret-123');
  });

  it('produces a different ciphertext each call (fresh IV)', () => {
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY));
  });

  it('fails loudly on tamper or wrong key', () => {
    const stored = encryptSecret('secret', KEY);
    const tampered = stored.slice(0, -2) + (stored.endsWith('00') ? '11' : '00');
    expect(() => decryptSecret(tampered, KEY)).toThrow('decrypt_failed');
    expect(() => decryptSecret(stored, 'b'.repeat(64))).toThrow('decrypt_failed');
  });

  it('requires a key', () => {
    const prev = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encryptSecret('x')).toThrow('encryption_key_missing');
    if (prev !== undefined) process.env.ENCRYPTION_KEY = prev;
  });
});
