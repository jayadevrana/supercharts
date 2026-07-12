import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * At-rest encryption for broker secrets (api_secret, access_token, headless creds).
 * AES-256-GCM under ENCRYPTION_KEY (64-char hex → 32 bytes). Stored format:
 *   v1$<ivHex>$<authTagHex>$<cipherHex>
 * GCM authenticates: any tamper or wrong key throws `decrypt_failed` instead of
 * returning garbage.
 */
function keyBuffer(keyHex = process.env.ENCRYPTION_KEY): Buffer {
  if (!keyHex || keyHex.length < 64) throw new Error('encryption_key_missing');
  return Buffer.from(keyHex.slice(0, 64), 'hex');
}

export function encryptSecret(plain: string, keyHex?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1$${iv.toString('hex')}$${cipher.getAuthTag().toString('hex')}$${enc.toString('hex')}`;
}

export function decryptSecret(stored: string, keyHex?: string): string {
  const [version, ivHex, tagHex, dataHex] = stored.split('$');
  if (version !== 'v1' || !ivHex || !tagHex || !dataHex) throw new Error('decrypt_failed');
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBuffer(keyHex), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch (err) {
    if (err instanceof Error && err.message === 'encryption_key_missing') throw err;
    throw new Error('decrypt_failed');
  }
}
