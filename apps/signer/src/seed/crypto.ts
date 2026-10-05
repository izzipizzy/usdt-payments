import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Envelope format for secrets at rest (seed, pool key).
 * Key = scrypt(passphrase, salt, N=2^17, r=8, p=1, 32 bytes); AES-256-GCM with 12-byte IV.
 * The blob is JSON so it can be inspected without tools; nothing in it is secret except `ct`.
 */
export interface EncryptedBlob {
  v: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string; // hex
  iv: string; // hex
  tag: string; // hex
  ct: string; // hex
  /** Free-form label, e.g. "master-seed nile". */
  label?: string;
  createdAt: string;
}

const DEFAULT_N = 2 ** 17;
const DEFAULT_R = 8;
const DEFAULT_P = 1;

function deriveKey(passphrase: string, salt: Buffer, N: number, r: number, p: number): Buffer {
  return scryptSync(passphrase.normalize('NFKC'), salt, 32, { N, r, p, maxmem: 512 * 1024 * 1024 });
}

export function encryptSecret(secret: Uint8Array, passphrase: string, label?: string, kdf?: { N?: number }): EncryptedBlob {
  if (passphrase.length < 12) throw new Error('passphrase must be at least 12 characters');
  const N = kdf?.N ?? DEFAULT_N;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt, N, DEFAULT_R, DEFAULT_P);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(secret);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  plain.fill(0);
  key.fill(0);
  return {
    v: 1,
    kdf: 'scrypt',
    N,
    r: DEFAULT_R,
    p: DEFAULT_P,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ct: ct.toString('hex'),
    label,
    createdAt: new Date().toISOString(),
  };
}

export function decryptSecret(blob: EncryptedBlob, passphrase: string): Uint8Array {
  if (blob.v !== 1 || blob.kdf !== 'scrypt') throw new Error('unsupported blob format');
  const key = deriveKey(passphrase, Buffer.from(blob.salt, 'hex'), blob.N, blob.r, blob.p);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
    const pt = Buffer.concat([decipher.update(Buffer.from(blob.ct, 'hex')), decipher.final()]);
    const out = new Uint8Array(pt);
    pt.fill(0); // the caller owns exactly one plaintext copy and must wipe it
    return out;
  } catch {
    throw new Error('decryption failed: wrong passphrase or corrupted file');
  } finally {
    key.fill(0);
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
