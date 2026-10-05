import { describe, expect, it } from 'vitest';
import { TronWeb } from 'tronweb';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import {
  buildDelegateResourceTx,
  buildFreezeBalanceV2Tx,
  buildUnfreezeBalanceV2Tx,
  buildTrxTransferTx,
  buildUsdtTransferTx,
  makeBlockHeader,
  recoverSigner,
  refBlockParams,
  signTx,
  txContracts,
  txField,
  verifyTxConsistency,
} from './tx.js';
import { USDT_CONTRACT } from './constants.js';
import { decodeTransferCalldata } from './abi.js';
import { toHexAddress } from './address.js';

const BLOCK_ID = '0000000003a4b7c8f0e1d2c3b4a5968778695a4b3c2d1e0f1122334455667788';
const header = makeBlockHeader(61126600, BLOCK_ID, { nowMs: 1_800_000_000_000, ttlMs: 600_000 });

function randomKey() {
  const priv = bytesToHex(secp256k1.utils.randomPrivateKey());
  const address = TronWeb.address.fromPrivateKey(priv) as string;
  return { priv, address };
}

describe('tx', () => {
  it('computes TAPOS fields', () => {
    expect(refBlockParams(61126600, BLOCK_ID)).toEqual({ ref_block_bytes: 'b7c8', ref_block_hash: 'f0e1d2c3b4a59687' });
  });

  it('builds a consistent USDT transfer offline', async () => {
    const owner = randomKey();
    const collector = randomKey();
    const tx = await buildUsdtTransferTx({
      owner: owner.address,
      contract: USDT_CONTRACT.mainnet,
      to: collector.address,
      amount: 20_000_000n,
      feeLimitSun: 15_000_000n,
      blockHeader: header,
    });
    expect(verifyTxConsistency(tx)).toBe(true);
    const [contract] = txContracts(tx);
    expect(contract.type).toBe('TriggerSmartContract');
    expect(contract.parameter.value.contract_address).toBe(toHexAddress(USDT_CONTRACT.mainnet));
    expect(contract.parameter.value.owner_address).toBe(toHexAddress(owner.address));
    const decoded = decodeTransferCalldata(contract.parameter.value.data as string);
    expect(decoded.to).toBe(collector.address);
    expect(decoded.amount).toBe(20_000_000n);
    expect(txField<number>(tx, 'fee_limit')).toBe(15_000_000);
    expect(txField<number>(tx, 'expiration')).toBe(header.expiration);
    expect(txField<string>(tx, 'ref_block_bytes')).toBe('b7c8');

    // tampering with raw_data breaks consistency
    const tampered = structuredClone(tx);
    (tampered.raw_data as { fee_limit: number }).fee_limit = 1;
    expect(verifyTxConsistency(tampered)).toBe(false);
  });

  it('signs and recovers the signer', async () => {
    const owner = randomKey();
    const tx = await buildTrxTransferTx({
      from: owner.address,
      to: randomKey().address,
      amountSun: 100_000n,
      blockHeader: header,
    });
    expect(verifyTxConsistency(tx)).toBe(true);
    const sig = signTx(owner.priv, tx);
    expect(sig).toMatch(/^[0-9a-f]{130}$/);
    expect(recoverSigner(tx.txID, sig)).toBe(toHexAddress(owner.address));
    expect(tx.signature).toBeUndefined(); // input not mutated
  });

  it('builds stake 2.0 freeze/unfreeze offline', async () => {
    const owner = randomKey();
    const freeze = await buildFreezeBalanceV2Tx({ owner: owner.address, amountSun: 100_000_000n, resource: 'ENERGY', blockHeader: header });
    expect(verifyTxConsistency(freeze)).toBe(true);
    expect(txContracts(freeze)[0].type).toBe('FreezeBalanceV2Contract');
    expect(txContracts(freeze)[0].parameter.value.frozen_balance).toBe(100_000_000);
    const unfreeze = await buildUnfreezeBalanceV2Tx({ owner: owner.address, amountSun: 50_000_000n, resource: 'BANDWIDTH', blockHeader: header });
    expect(verifyTxConsistency(unfreeze)).toBe(true);
    expect(txContracts(unfreeze)[0].type).toBe('UnfreezeBalanceV2Contract');
  });

  it('builds delegate resource offline', async () => {
    const owner = randomKey();
    const tx = await buildDelegateResourceTx({
      owner: owner.address,
      receiver: randomKey().address,
      amountSun: 5_000_000_000n,
      resource: 'ENERGY',
      blockHeader: header,
    });
    expect(verifyTxConsistency(tx)).toBe(true);
    expect(txContracts(tx)[0].type).toBe('DelegateResourceContract');
  });
});
