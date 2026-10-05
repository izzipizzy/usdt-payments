import { createHash } from 'node:crypto';
import {
  ENERGY_TRANSFER_NONZERO_RECIPIENT,
  ENERGY_TRANSFER_ZERO_RECIPIENT,
  TRANSFER_TOPIC,
  decodeTransferLog,
  decodeTransferCalldata,
  hexToBase58,
  recoverSigner,
  toBase58Address,
  toEvmHex,
  toHexAddress,
  txContracts,
  txField,
  type TronTxJson,
} from '@usdt-trx/shared';
import type { AccountResource, BlockInfo, BroadcastResult, TxInfo } from '../tron/tron-node.client.js';

interface Account {
  activated: boolean;
  balanceSun: bigint;
  energyLimit: number;
  energyUsed: number;
  freeNetUsed: number;
}

const ENERGY_PER_TRX = 12;
const ENERGY_FEE = 100;
const FREE_NET = 600;
const TRANSFER_BYTES = 345;

/**
 * In-memory TRON stand-in with the subset of semantics the pipeline depends on:
 * activation on first TRX transfer, energy delegation, USDT transfer energy/bandwidth accounting,
 * signature verification and solid-block receipts/logs. Time moves only with `mineBlock()`.
 */
export class FakeTronNode {
  private height = 1000;
  private readonly blocks = new Map<number, TxInfo[]>();
  private readonly txIndex = new Map<string, TxInfo>();
  private readonly pending: Array<{ tx: TronTxJson | null; exec: () => TxInfo }> = [];
  readonly accounts = new Map<string, Account>();
  readonly usdt = new Map<string, bigint>();
  readonly broadcasts: string[] = [];

  constructor(private readonly usdtContract: string) {}

  // ------------------------------------------------------------ helpers for tests

  account(addr: string): Account {
    const key = toBase58Address(addr);
    let a = this.accounts.get(key);
    if (!a) {
      a = { activated: false, balanceSun: 0n, energyLimit: 0, energyUsed: 0, freeNetUsed: 0 };
      this.accounts.set(key, a);
    }
    return a;
  }

  fund(addr: string, trxSun: bigint, opts: { energy?: number } = {}): void {
    const a = this.account(addr);
    a.activated = true;
    a.balanceSun += trxSun;
    if (opts.energy) a.energyLimit += opts.energy;
  }

  setUsdt(addr: string, amount: bigint): void {
    this.usdt.set(toBase58Address(addr), amount);
  }

  usdtOf(addr: string): bigint {
    return this.usdt.get(toBase58Address(addr)) ?? 0n;
  }

  /** Queue an external USDT deposit; it lands in the next mined block. */
  externalDeposit(to: string, amount: bigint, from = 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy'): string {
    const txId = createHash('sha256').update(`deposit:${to}:${amount}:${Math.random()}`).digest('hex');
    this.pending.push({
      tx: null,
      exec: () => {
        this.usdt.set(toBase58Address(to), this.usdtOf(to) + amount);
        return this.info(txId, 'SUCCESS', [this.transferLog(from, to, amount)], { energy: ENERGY_TRANSFER_NONZERO_RECIPIENT });
      },
    });
    return txId;
  }

  mineBlock(): number {
    const num = ++this.height;
    const infos: TxInfo[] = [];
    for (const p of this.pending.splice(0)) {
      const info = p.exec();
      info.blockNumber = num;
      info.blockTimeStamp = Date.now();
      infos.push(info);
      this.txIndex.set(info.id, info);
    }
    this.blocks.set(num, infos);
    return num;
  }

  /** What TronGrid's account-history API would answer: every USDT transfer touching `addr`, oldest first. */
  transfersOf(addr: string): Array<{ txId: string; from: string; to: string; value: bigint; timestampMs: number }> {
    const target = toBase58Address(addr);
    const out: Array<{ txId: string; from: string; to: string; value: bigint; timestampMs: number }> = [];
    for (const [, infos] of [...this.blocks.entries()].sort((a, b) => a[0] - b[0])) {
      for (const info of infos) {
        if ((info.receipt?.result ?? 'SUCCESS') !== 'SUCCESS') continue;
        for (const log of info.log ?? []) {
          const t = decodeTransferLog(log.topics, log.data);
          if (!t) continue;
          const from = toBase58Address(t.fromHex);
          const to = toBase58Address(t.toHex);
          if (from === target || to === target) out.push({ txId: info.id, from, to, value: t.amount, timestampMs: info.blockTimeStamp });
        }
      }
    }
    return out;
  }

  mineBlocks(n: number): void {
    for (let i = 0; i < n; i++) this.mineBlock();
  }

  private blockId(num: number): string {
    return num.toString(16).padStart(16, '0') + createHash('sha256').update(`block:${num}`).digest('hex').slice(16);
  }

  private info(id: string, result: string, log: TxInfo['log'], usage: { energy?: number; net?: number; feeSun?: bigint } = {}): TxInfo {
    return {
      id,
      blockNumber: this.height,
      blockTimeStamp: Date.now(),
      receipt: { result, energy_usage_total: usage.energy ?? 0, net_usage: usage.net ?? 0, net_fee: 0, energy_fee: Number(usage.feeSun ?? 0n) },
      fee: Number(usage.feeSun ?? 0n),
      result: result === 'SUCCESS' ? undefined : 'FAILED',
      log,
    };
  }

  private transferLog(from: string, to: string, amount: bigint) {
    return {
      address: toHexAddress(this.usdtContract),
      topics: [TRANSFER_TOPIC, '0'.repeat(24) + toEvmHex(from), '0'.repeat(24) + toEvmHex(to)],
      data: amount.toString(16).padStart(64, '0'),
    };
  }

  // ------------------------------------------------------------ TronNodeClient surface

  async getNowSolidBlock(): Promise<BlockInfo> {
    return { number: this.height, blockId: this.blockId(this.height), timestampMs: Date.now() };
  }

  async getNowBlock(): Promise<BlockInfo> {
    return this.getNowSolidBlock();
  }

  async getSolidBlockByNum(num: number): Promise<BlockInfo> {
    return { number: num, blockId: this.blockId(num), timestampMs: Date.now() };
  }

  async getSolidTransactionInfoByBlock(num: number): Promise<TxInfo[]> {
    return this.blocks.get(num) ?? [];
  }

  async getAccount(address: string): Promise<{ balanceSun: bigint; raw: Record<string, unknown> } | null> {
    const a = this.accounts.get(toBase58Address(address));
    if (!a || !a.activated) return null;
    return { balanceSun: a.balanceSun, raw: { address, balance: Number(a.balanceSun) } };
  }

  async getAccountResource(address: string): Promise<AccountResource> {
    const a = this.account(address);
    const freeNetLimit = a.activated ? FREE_NET : 0;
    return {
      energyLimit: a.energyLimit,
      energyUsed: a.energyUsed,
      energyAvailable: Math.max(0, a.energyLimit - a.energyUsed),
      freeNetLimit,
      freeNetUsed: a.freeNetUsed,
      netLimit: 0,
      netUsed: 0,
      bandwidthAvailable: Math.max(0, freeNetLimit - a.freeNetUsed),
      totalEnergyLimit: 180_000_000_000,
      totalEnergyWeight: 15_000_000_000,
    };
  }

  async usdtBalanceOf(address: string): Promise<bigint> {
    return this.usdtOf(address);
  }

  async isBlackListed(): Promise<boolean> {
    return false;
  }

  async estimateTransferEnergy(owner: string, to: string, amount: bigint): Promise<{ energy: number; ok: boolean; message?: string }> {
    const ok = this.usdtOf(owner) >= amount;
    return { energy: this.usdtOf(to) > 0n ? ENERGY_TRANSFER_NONZERO_RECIPIENT : ENERGY_TRANSFER_ZERO_RECIPIENT, ok, message: ok ? undefined : 'insufficient balance' };
  }

  async triggerConstant(): Promise<{ energyUsed: number; constantResult: string[]; ok: boolean }> {
    return { energyUsed: 0, constantResult: [], ok: true };
  }

  async getChainParameters(): Promise<Record<string, number>> {
    return { getEnergyFee: ENERGY_FEE, getTransactionFee: 1000, getCreateNewAccountFeeInSystemContract: 1_000_000, getCreateAccountFee: 100_000 };
  }

  usdtHex(): string {
    return toHexAddress(this.usdtContract);
  }

  async getSolidTransactionInfo(txId: string): Promise<TxInfo | null> {
    return this.txIndex.get(txId) ?? null;
  }

  async getTransactionInfo(txId: string): Promise<TxInfo | null> {
    return this.getSolidTransactionInfo(txId);
  }

  async broadcast(signed: TronTxJson): Promise<BroadcastResult> {
    if (this.txIndex.has(signed.txID) || this.pending.some((p) => p.tx?.txID === signed.txID)) return { ok: true, code: 'DUP_TRANSACTION_ERROR' }; // what java-tron actually answers
    const [contract] = txContracts(signed);
    const ownerHex = String(contract.parameter.value.owner_address);
    const owner = hexToBase58(ownerHex);
    const sig = signed.signature?.[0];
    if (!sig || recoverSigner(signed.txID, sig) !== ownerHex.toLowerCase()) return { ok: false, code: 'SIGERROR', message: 'bad signature' };
    if (Number(txField(signed, 'expiration')) < Date.now()) return { ok: false, code: 'TRANSACTION_EXPIRATION_ERROR' };
    const acc = this.account(owner);
    if (!acc.activated) return { ok: false, code: 'CONTRACT_VALIDATE_ERROR', message: 'account does not exist' };
    const freeLeft = FREE_NET - acc.freeNetUsed;
    if (freeLeft < TRANSFER_BYTES && acc.balanceSun < BigInt(TRANSFER_BYTES) * 1000n) return { ok: false, code: 'BANDWITH_ERROR' };
    this.broadcasts.push(signed.txID);
    this.pending.push({ tx: signed, exec: () => this.execute(signed, contract.type, contract.parameter.value, owner, acc) });
    return { ok: true, code: 'SUCCESS', txid: signed.txID };
  }

  private execute(tx: TronTxJson, type: string, value: Record<string, unknown>, owner: string, acc: Account): TxInfo {
    if (FREE_NET - acc.freeNetUsed >= TRANSFER_BYTES) acc.freeNetUsed += TRANSFER_BYTES;
    else acc.balanceSun -= BigInt(TRANSFER_BYTES) * 1000n;
    switch (type) {
      case 'TransferContract': {
        const to = hexToBase58(String(value.to_address));
        const amount = BigInt(String(value.amount));
        const target = this.account(to);
        let fee = 0n;
        if (!target.activated) {
          target.activated = true;
          fee = 1_000_000n;
        }
        acc.balanceSun -= amount + fee;
        target.balanceSun += amount;
        return this.info(tx.txID, 'SUCCESS', [], { net: TRANSFER_BYTES, feeSun: fee });
      }
      case 'DelegateResourceContract':
      case 'UnDelegateResourceContract': {
        const receiver = this.account(hexToBase58(String(value.receiver_address)));
        if (!receiver.activated) return this.info(tx.txID, 'FAILED', [], {});
        const energy = Math.floor((Number(BigInt(String(value.balance))) / 1e6) * ENERGY_PER_TRX);
        if (type === 'DelegateResourceContract') {
          receiver.energyLimit += energy;
          acc.energyLimit -= energy;
        } else {
          receiver.energyLimit = Math.max(0, receiver.energyLimit - energy);
          receiver.energyUsed = Math.min(receiver.energyUsed, receiver.energyLimit);
          acc.energyLimit += energy;
        }
        return this.info(tx.txID, 'SUCCESS', [], { net: 280 });
      }
      case 'TriggerSmartContract': {
        const contractAddr = hexToBase58(String(value.contract_address));
        if (contractAddr !== this.usdtContract) return this.info(tx.txID, 'REVERT', [], {});
        const call = decodeTransferCalldata(String(value.data));
        const need = this.usdtOf(call.to) > 0n ? ENERGY_TRANSFER_NONZERO_RECIPIENT : ENERGY_TRANSFER_ZERO_RECIPIENT;
        const available = acc.energyLimit - acc.energyUsed;
        let feeSun = 0n;
        if (available < need) {
          const burn = BigInt(need - Math.max(0, available)) * BigInt(ENERGY_FEE);
          const feeLimit = BigInt(String(txField(tx, 'fee_limit') ?? 0));
          if (burn > feeLimit || acc.balanceSun < burn) {
            acc.energyUsed = acc.energyLimit;
            return this.info(tx.txID, 'OUT_OF_ENERGY', [], { energy: Math.max(0, available) });
          }
          acc.balanceSun -= burn;
          acc.energyUsed = acc.energyLimit;
          feeSun = burn;
        } else {
          acc.energyUsed += need;
        }
        if (this.usdtOf(owner) < call.amount) return this.info(tx.txID, 'REVERT', [], { energy: need });
        this.usdt.set(owner, this.usdtOf(owner) - call.amount);
        this.usdt.set(call.to, this.usdtOf(call.to) + call.amount);
        return this.info(tx.txID, 'SUCCESS', [this.transferLog(owner, call.to, call.amount)], { energy: need, net: TRANSFER_BYTES, feeSun });
      }
      default:
        return this.info(tx.txID, 'FAILED', [], {});
    }
  }
}
