import { bytesToHex } from '@noble/hashes/utils';
import { loadDotenv } from '@usdt-trx/shared/env';
loadDotenv();
import { loadConfig } from './config.js';
import { AuditLog } from './audit.js';
import { EncryptedFileSecretProvider, EnvHexSecretProvider, readPassphrase, type SecretProvider } from './seed/provider.js';
import { WalletStore } from './wallet-store.js';
import { buildServer, poolKeyFromHex, type PoolKey } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();

  let wallet: WalletStore;
  let seedSource: string;
  if (config.SEED_SOURCE === 'env') {
    const seed = new EnvHexSecretProvider(config.SEED_HEX!).load();
    wallet = WalletStore.fromSeed(seed, { main: config.MAIN_WALLET_PATH, pool: config.POOL_WALLET_PATH });
    seed.fill(0);
    seedSource = 'env-hex (dev only)';
  } else {
    wallet = new WalletStore({ seedFile: config.SEED_FILE, passphrase: readPassphrase(config.SEED_PASSPHRASE, config.SEED_PASSPHRASE_FILE), network: config.NETWORK, paths: { main: config.MAIN_WALLET_PATH, pool: config.POOL_WALLET_PATH } });
    seedSource = wallet.loadIfPresent() ? `encrypted-file:${config.SEED_FILE}` : `none yet (create or import via API; will be saved to ${config.SEED_FILE})`;
  }

  let pool: PoolKey | null = null;
  if (config.POOL_KEY_SOURCE !== 'none') {
    const provider: SecretProvider =
      config.POOL_KEY_SOURCE === 'env'
        ? new EnvHexSecretProvider(config.POOL_KEY_HEX!)
        : new EncryptedFileSecretProvider(
            config.POOL_KEY_FILE,
            readPassphrase(config.POOL_KEY_PASSPHRASE ?? config.SEED_PASSPHRASE, config.POOL_KEY_PASSPHRASE_FILE ?? config.SEED_PASSPHRASE_FILE),
          );
    const raw = provider.load();
    pool = poolKeyFromHex(bytesToHex(raw));
    raw.fill(0);
  }

  const audit = new AuditLog(config.AUDIT_LOG_PATH);
  const app = await buildServer({ config, wallet, pool, audit });
  await audit.write({ kind: 'startup', ok: true, error: `seed=${seedSource} collector=${config.COLLECTOR_ADDRESS ?? 'main wallet (derived)'}` });
  await app.listen({ host: config.SIGNER_HOST, port: config.SIGNER_PORT });
  app.log.info(
    { network: config.NETWORK, collector: config.COLLECTOR_ADDRESS ?? 'main wallet (derived)', pool: pool?.address ?? (wallet.initialized() ? wallet.get().pool().address : null), walletInitialized: wallet.initialized(), seedSource },
    'signer ready',
  );

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('signer failed to start:', (e as Error).message);
  process.exit(1);
});
