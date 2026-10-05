import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config/config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LabelsService, type LabelsFile } from './labels.service.js';

const address = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const backup: LabelsFile = { version: 1, network: 'nile', xpub: 'test-xpub', addresses: [{ index: 1, address, alias: '=label', suspended: false }], payouts: [] };
function fixture(path?: string) {
  const cfg = loadConfig({ DATABASE_URL: 'postgresql://local', SIGNER_TOKEN: 'test', LABELS_FILE: path });
  const db = {
    wallet: { findUnique: vi.fn(async () => ({ id: 1n, xpub: 'test-xpub' })) },
    depositAddress: {
      findMany: vi.fn(async () => [{ derivationIndex: 1, address, alias: '=label', metadata: null, status: 'assigned', suspendReason: null }]),
      findUnique: vi.fn(async () => ({ id: 2n, walletId: 1n, derivationIndex: 1, status: 'assigned' })),
      update: vi.fn(),
    },
    payout: { findMany: vi.fn(async () => []), findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (fn) => fn(db));
  return { db, service: new LabelsService(cfg, db as unknown as PrismaService) };
}

describe('labels backup', () => {
  it('rejects a backup from a different network or wallet before writing', async () => {
    const { db, service } = fixture();
    await expect(service.apply({ ...backup, network: 'mainnet' })).rejects.toThrow(/network/);
    await expect(service.apply({ ...backup, xpub: 'other-xpub' })).rejects.toThrow(/wallet/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('matches both address and derivation index and only restores labels', async () => {
    const { db, service } = fixture();
    expect(await service.apply(backup)).toEqual({ applied: 1, skipped: [] });
    expect(db.depositAddress.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ alias: '=label' }) }));
    expect(await service.apply({ ...backup, addresses: [{ ...backup.addresses[0], index: 9 }] })).toEqual({ applied: 0, skipped: [address] });
    expect(db.depositAddress.update).toHaveBeenCalledOnce();
    expect(db.payout.update).not.toHaveBeenCalled();
  });

  it('serializes concurrent backup requests into complete, readable JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usdt-labels-test-'));
    try {
      const path = join(dir, 'labels.json');
      const { service } = fixture(path);
      service.scheduleWrite();
      service.scheduleWrite();
      await service.onModuleDestroy();
      expect(JSON.parse(await readFile(path, 'utf8')).addresses[0].alias).toBe('=label');
      expect(service.readFile()?.xpub).toBe('test-xpub');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('escapes spreadsheet formulas in CSV labels', async () => {
    expect(await fixture().service.csv()).toContain('"\'=label"');
  });

  it('restores a payout note by matching decimal USDT against the stored raw amount', async () => {
    const { db, service } = fixture();
    db.payout.findUnique.mockResolvedValue({ id: 3n, toAddress: address, amount: 1_500_000n });
    const payout = { externalId: 'invoice', to: address, amount: '1.5', note: 'payment', createdAt: new Date().toISOString() };
    expect(await service.apply({ ...backup, addresses: [], payouts: [payout] })).toEqual({ applied: 1, skipped: [] });
    expect(db.payout.update).toHaveBeenCalledWith({ where: { id: 3n }, data: { note: 'payment' } });
  });
});
