import { Inject, Injectable } from '@nestjs/common';
import {
  buildDelegateResourceTx,
  buildTrxTransferTx,
  buildUndelegateResourceTx,
  buildUsdtTransferTx,
  makeBlockHeader,
  type BlockHeader,
  type TronTxJson,
} from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';
import { TronNodeClient } from './tron-node.client.js';

/** Builds transactions locally against a fresh solid block header. */
@Injectable()
export class TxBuilderService {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly node: TronNodeClient,
  ) {}

  async header(ttlMs = this.cfg.TX_TTL_MS): Promise<BlockHeader> {
    const block = await this.node.getNowSolidBlock();
    return makeBlockHeader(block.number, block.blockId, { ttlMs });
  }

  async usdtTransfer(owner: string, to: string, amount: bigint, feeLimitSun: bigint, ttlMs?: number): Promise<TronTxJson> {
    return buildUsdtTransferTx({
      owner,
      contract: this.cfg.usdtContract,
      to,
      amount,
      feeLimitSun,
      blockHeader: await this.header(ttlMs),
    });
  }

  async trxTransfer(from: string, to: string, amountSun: bigint): Promise<TronTxJson> {
    return buildTrxTransferTx({ from, to, amountSun, blockHeader: await this.header(60_000) });
  }

  async delegateEnergy(owner: string, receiver: string, amountSun: bigint): Promise<TronTxJson> {
    return buildDelegateResourceTx({ owner, receiver, amountSun, resource: 'ENERGY', blockHeader: await this.header(60_000) });
  }

  async undelegateEnergy(owner: string, receiver: string, amountSun: bigint): Promise<TronTxJson> {
    return buildUndelegateResourceTx({ owner, receiver, amountSun, resource: 'ENERGY', blockHeader: await this.header(60_000) });
  }
}
