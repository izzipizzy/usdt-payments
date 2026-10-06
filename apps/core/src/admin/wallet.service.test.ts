import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WalletService } from './wallet.service.js';

function fixture() {
  const signer = {
    walletStatus: vi.fn().mockResolvedValue({
      initialized: true, network: 'mainnet', xpub: 'test-xpub',
      payoutAddress: 'main-address',
    }),
  };
  const node = {
    getAccount: vi.fn().mockResolvedValue({ balanceSun: 2_000_000n, raw: {} }),
    getAccountResource: vi.fn().mockResolvedValue({ energyAvailable: 100 }),
    usdtBalanceOf: vi.fn().mockResolvedValue(25_000_000n),
  };
  const collector = { get: vi.fn().mockResolvedValue('main-address'), external: () => false };
  const deps = [
    { network: 'mainnet' }, { depositAddress: { count: vi.fn().mockResolvedValue(3) } },
    signer, node, {}, {}, { get: vi.fn().mockResolvedValue('pool-address') }, collector, {},
  ] as unknown as ConstructorParameters<typeof WalletService>;
  return { service: new WalletService(...deps), signer, node, collector };
}

describe('wallet network status', () => {
  it('returns the funded main address and its real activation status', async () => {
    const { service } = fixture();
    const status = await service.status();
    expect(status.main).toMatchObject({ address: 'main-address', activated: true, usdtBalance: '25', trxBalance: '2' });
    expect(status.collectorUsdt).toBe('25');
  });

  it.each(['getAccount', 'getAccountResource', 'usdtBalanceOf'] as const)(
    'does not turn a failed %s request into an inactive address or zero balance', async (method) => {
      const { service, node } = fixture();
      node[method].mockRejectedValue(new Error('HTTP 429'));
      await expect(service.status()).rejects.toBeInstanceOf(ServiceUnavailableException);
    },
  );

  it('does not turn an unavailable signer into a new wallet setup', async () => {
    const { service, signer } = fixture();
    signer.walletStatus.mockRejectedValue(new Error('connection refused'));
    await expect(service.status()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports a failed main-address lookup even when the pool and USDT balance are available', async () => {
    const { service, node } = fixture();
    node.getAccount.mockImplementation(async (address: string) => {
      if (address === 'main-address') throw new Error('HTTP 429');
      return { balanceSun: 2_000_000n, raw: {} };
    });
    await expect(service.status()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('still distinguishes a successful empty account response from a network failure', async () => {
    const { service, node } = fixture();
    node.getAccount.mockResolvedValue(null);
    const status = await service.status();
    expect(status.main).toMatchObject({ activated: false, usdtBalance: '25' });
  });
});
