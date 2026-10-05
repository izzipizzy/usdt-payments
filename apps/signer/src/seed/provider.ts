import { readFileSync } from 'node:fs';
import { hexToBytes } from '@noble/hashes/utils';
import { decryptSecret, type EncryptedBlob } from './crypto.js';

/** Returns secret bytes exactly once per call; callers must zero them when done. */
export interface SecretProvider {
  load(): Uint8Array;
  describe(): string;
}

export class EncryptedFileSecretProvider implements SecretProvider {
  constructor(
    private readonly path: string,
    private readonly passphrase: string,
  ) {}

  load(): Uint8Array {
    const blob = JSON.parse(readFileSync(this.path, 'utf8')) as EncryptedBlob;
    return decryptSecret(blob, this.passphrase);
  }

  describe(): string {
    return `encrypted-file:${this.path}`;
  }
}

/** Development only (Nile). */
export class EnvHexSecretProvider implements SecretProvider {
  constructor(private readonly hex: string) {}

  load(): Uint8Array {
    return hexToBytes(this.hex);
  }

  describe(): string {
    return 'env-hex (dev only)';
  }
}

export function readPassphrase(direct?: string, file?: string): string {
  if (direct) return direct;
  if (file) return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  throw new Error('no passphrase configured');
}
