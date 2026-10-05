#!/usr/bin/env node
/**
 * signer-cli keygen   --out secrets/seed.enc.json [--label "mainnet master"]   (SEED_PASSPHRASE env or prompt)
 * signer-cli poolkey  --out secrets/pool.enc.json                              (POOL_KEY_PASSPHRASE / SEED_PASSPHRASE env or prompt)
 * signer-cli xpub     --file secrets/seed.enc.json                              prints xpub + first 3 addresses
 * signer-cli inspect  --file secrets/pool.enc.json                              prints the pool address
 *
 * Nothing secret is ever printed. Run keygen on an offline machine and back the file + passphrase up separately.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { bytesToHex } from '@noble/hashes/utils';
import { decryptSecret, encryptSecret, type EncryptedBlob } from './seed/crypto.js';
import { HdWallet } from './hd/wallet.js';
import { poolKeyFromHex } from './server.js';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Prompt without echoing the typed characters (they must not land in scrollback or terminal recordings). */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const muted = rl as unknown as { _writeToOutput?: (s: string) => void };
    stdout.write(prompt);
    muted._writeToOutput = () => undefined;
    rl.question('', (answer) => {
      rl.close();
      stdout.write('\n');
      resolve(answer);
    });
    rl.on('SIGINT', () => {
      rl.close();
      stdout.write('\n');
      reject(new Error('aborted'));
    });
  });
}

async function passphrase(envName: string, confirm: boolean): Promise<string> {
  const fromEnv = process.env[envName] ?? process.env.SEED_PASSPHRASE;
  if (fromEnv) return fromEnv;
  const p1 = await askHidden('Passphrase (min 12 chars): ');
  if (confirm) {
    const p2 = await askHidden('Repeat passphrase: ');
    if (p1 !== p2) throw new Error('passphrases do not match');
  }
  return p1;
}

function writeBlob(path: string, blob: EncryptedBlob): void {
  if (existsSync(path)) throw new Error(`${path} already exists; refusing to overwrite`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(blob, null, 2)}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'keygen': {
      const out = arg('out', 'secrets/seed.enc.json')!;
      const pass = await passphrase('SEED_PASSPHRASE', true);
      const seed = randomBytes(32);
      const blob = encryptSecret(seed, pass, arg('label', 'master-seed'));
      writeBlob(out, blob);
      const wallet = HdWallet.fromSeed(seed);
      seed.fill(0);
      console.log(`seed file: ${out}`);
      console.log(`xpub (m/44'/195'/0'): ${wallet.xpub()}`);
      for (let i = 0; i < 3; i++) console.log(`address[${i}]: ${wallet.derive(i).address}`);
      return;
    }
    case 'poolkey': {
      const out = arg('out', 'secrets/pool.enc.json')!;
      const pass = await passphrase('POOL_KEY_PASSPHRASE', true);
      const key = randomBytes(32);
      writeBlob(out, encryptSecret(key, pass, arg('label', 'energy-pool-key')));
      const pool = poolKeyFromHex(bytesToHex(key));
      key.fill(0);
      console.log(`pool key file: ${out}`);
      console.log(`pool address: ${pool.address}`);
      return;
    }
    case 'xpub': {
      const file = arg('file', 'secrets/seed.enc.json')!;
      const pass = await passphrase('SEED_PASSPHRASE', false);
      const seed = decryptSecret(JSON.parse(readFileSync(file, 'utf8')) as EncryptedBlob, pass);
      const wallet = HdWallet.fromSeed(seed);
      seed.fill(0);
      console.log(`xpub: ${wallet.xpub()}`);
      for (let i = 0; i < 3; i++) console.log(`address[${i}]: ${wallet.derive(i).address}`);
      return;
    }
    case 'inspect': {
      const file = arg('file', 'secrets/pool.enc.json')!;
      const pass = await passphrase('POOL_KEY_PASSPHRASE', false);
      const key = decryptSecret(JSON.parse(readFileSync(file, 'utf8')) as EncryptedBlob, pass);
      console.log(`pool address: ${poolKeyFromHex(bytesToHex(key)).address}`);
      key.fill(0);
      return;
    }
    default:
      console.log('usage: signer-cli <keygen|poolkey|xpub|inspect> [--out path] [--file path] [--label text]');
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
