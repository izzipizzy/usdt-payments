import { Inject, Injectable, Logger } from '@nestjs/common';
import { decodeUint256, encodeBalanceOf, encodeIsBlackListed, toBase58Address, toHexAddress, transferParameter, type TronTxJson } from '@usdt-trx/shared';
import { CONFIG, type AppConfig } from '../config/config.js';

export class TronRpcError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = 'TronRpcError';
  }
}

export interface TxLog {
  address: string; // 41-prefixed hex, normalised
  topics: string[];
  data: string;
}

export interface TxInfo {
  id: string;
  blockNumber: number;
  blockTimeStamp: number;
  receipt?: { result?: string; energy_usage_total?: number; energy_usage?: number; net_usage?: number; net_fee?: number; energy_fee?: number };
  fee?: number;
  result?: string; // "FAILED" when execution failed
  resMessage?: string;
  contractResult?: string[];
  log?: TxLog[];
}

export interface BlockInfo {
  number: number;
  blockId: string;
  timestampMs: number;
}

export interface AccountResource {
  energyLimit: number;
  energyUsed: number;
  energyAvailable: number;
  freeNetLimit: number;
  freeNetUsed: number;
  netLimit: number;
  netUsed: number;
  bandwidthAvailable: number;
  totalEnergyLimit: number;
  totalEnergyWeight: number;
}

export interface BroadcastResult {
  ok: boolean;
  code: string;
  message?: string;
  txid?: string;
}

interface Endpoint {
  url: string;
  downUntil: number;
}

/**
 * Thin HTTP client for java-tron's REST API with endpoint failover.
 * `wallet/*` = head (unconfirmed) state, `walletsolidity/*` = solidified state.
 */
@Injectable()
export class TronNodeClient {
  private readonly log = new Logger(TronNodeClient.name);
  private readonly endpoints: Endpoint[];
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.endpoints = cfg.rpcUrls.map((url) => ({ url: url.replace(/\/+$/, ''), downUntil: 0 }));
    if (this.endpoints.length === 0) throw new Error('TRON_RPC_URLS is empty');
    this.timeoutMs = cfg.TRON_HTTP_TIMEOUT_MS;
    this.headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (cfg.TRONGRID_API_KEY) this.headers['TRON-PRO-API-KEY'] = cfg.TRONGRID_API_KEY;
  }

  // ---------------------------------------------------------------- transport

  async call<T = unknown>(path: string, body?: unknown, method: 'POST' | 'GET' = 'POST'): Promise<T> {
    const now = Date.now();
    const candidates = this.endpoints.filter((e) => e.downUntil <= now);
    const order = candidates.length ? candidates : this.endpoints;
    let lastErr: Error | null = null;
    for (const ep of order) {
      try {
        return await this.request<T>(ep.url, path, body, method);
      } catch (e) {
        lastErr = e as Error;
        const retryable = !(e instanceof TronRpcError) || e.retryable;
        if (!retryable) throw e;
        ep.downUntil = Date.now() + 30_000;
        this.log.warn(`endpoint ${ep.url} failed on ${path}: ${(e as Error).message}; trying next`);
      }
    }
    throw new TronRpcError(`all TRON endpoints failed for ${path}: ${lastErr?.message}`, true);
  }

  private async request<T>(base: string, path: string, body: unknown, method: 'POST' | 'GET'): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${base}/${path}`, {
        method,
        headers: this.headers,
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) throw new TronRpcError(`HTTP ${res.status} from ${base}`, true, base);
      if (!res.ok) throw new TronRpcError(`HTTP ${res.status} from ${base}: ${text.slice(0, 200)}`, false, base);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new TronRpcError(`invalid JSON from ${base}${path}`, true, base);
      }
    } catch (e) {
      if (e instanceof TronRpcError) throw e;
      throw new TronRpcError(`${(e as Error).name}: ${(e as Error).message}`, true, base);
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------- blocks

  private parseBlock(raw: { blockID?: string; block_header?: { raw_data?: { number?: number; timestamp?: number } } }): BlockInfo {
    const number = raw.block_header?.raw_data?.number;
    if (!raw.blockID || number === undefined) throw new TronRpcError('malformed block response', true);
    return { number, blockId: raw.blockID, timestampMs: raw.block_header?.raw_data?.timestamp ?? 0 };
  }

  async getNowSolidBlock(): Promise<BlockInfo> {
    return this.parseBlock(await this.call('walletsolidity/getnowblock'));
  }

  async getNowBlock(): Promise<BlockInfo> {
    return this.parseBlock(await this.call('wallet/getnowblock'));
  }

  async getSolidBlockByNum(num: number): Promise<BlockInfo> {
    return this.parseBlock(await this.call('walletsolidity/getblockbynum', { num }));
  }

  /** All transaction infos (receipts + logs) of a solidified block. Empty array for empty blocks. */
  async getSolidTransactionInfoByBlock(num: number): Promise<TxInfo[]> {
    const raw = await this.call<unknown>('walletsolidity/gettransactioninfobyblocknum', { num });
    if (Array.isArray(raw)) return raw.map((info) => this.normaliseTxInfo(info as TxInfo));
    // java-tron answers `[]` for an empty block. Anything else (`{"Error": ...}`, HTML, null) is a broken
    // response: throw so the cursor does not move past a block whose deposits we never saw.
    if (raw && typeof raw === 'object' && Object.keys(raw).length === 0) return [];
    throw new TronRpcError(`malformed gettransactioninfobyblocknum response for block ${num}: ${JSON.stringify(raw).slice(0, 200)}`, true);
  }

  private normaliseTxInfo(info: TxInfo): TxInfo {
    const log = (info.log ?? []).map((l) => ({
      address: this.normaliseHex(l.address),
      topics: (l.topics ?? []).map((t) => t.replace(/^0x/, '').toLowerCase()),
      data: (l.data ?? '').replace(/^0x/, '').toLowerCase(),
    }));
    return { ...info, log };
  }

  private normaliseHex(address: string): string {
    const a = address.replace(/^0x/, '').toLowerCase();
    return a.length === 40 ? `41${a}` : a;
  }

  // ---------------------------------------------------------------- accounts

  /** null when the account does not exist on-chain (not activated). */
  async getAccount(address: string): Promise<{ balanceSun: bigint; raw: Record<string, unknown> } | null> {
    const raw = await this.call<Record<string, unknown>>('wallet/getaccount', { address: toBase58Address(address), visible: true });
    if (!raw || Object.keys(raw).length === 0 || raw.address === undefined) return null;
    return { balanceSun: BigInt(String(raw.balance ?? 0)), raw };
  }

  async getAccountResource(address: string): Promise<AccountResource> {
    const r = await this.call<Record<string, number>>('wallet/getaccountresource', { address: toBase58Address(address), visible: true });
    const energyLimit = r.EnergyLimit ?? 0;
    const energyUsed = r.EnergyUsed ?? 0;
    const freeNetLimit = r.freeNetLimit ?? 0;
    const freeNetUsed = r.freeNetUsed ?? 0;
    const netLimit = r.NetLimit ?? 0;
    const netUsed = r.NetUsed ?? 0;
    return {
      energyLimit,
      energyUsed,
      energyAvailable: Math.max(0, energyLimit - energyUsed),
      freeNetLimit,
      freeNetUsed,
      netLimit,
      netUsed,
      bandwidthAvailable: Math.max(0, freeNetLimit - freeNetUsed) + Math.max(0, netLimit - netUsed),
      totalEnergyLimit: r.TotalEnergyLimit ?? 0,
      totalEnergyWeight: r.TotalEnergyWeight ?? 0,
    };
  }

  // ---------------------------------------------------------------- contracts

  async triggerConstant(
    owner: string,
    contract: string,
    functionSelector: string,
    parameterHex: string,
  ): Promise<{ energyUsed: number; constantResult: string[]; ok: boolean; message?: string; reverted: boolean }> {
    const raw = await this.call<{
      result?: { result?: boolean; message?: string; code?: string };
      energy_used?: number;
      constant_result?: string[];
      transaction?: { ret?: Array<{ ret?: string }> };
    }>('wallet/triggerconstantcontract', {
      owner_address: toBase58Address(owner),
      contract_address: toBase58Address(contract),
      function_selector: functionSelector,
      parameter: parameterHex,
      visible: true,
    });
    const message = raw.result?.message ? safeHexToUtf8(raw.result.message) : raw.result?.code;
    const reverted = raw.transaction?.ret?.some((r) => r.ret && r.ret !== 'SUCCESS') === true || Boolean(raw.result?.message);
    const ok = raw.result?.result === true && !reverted;
    return { energyUsed: raw.energy_used ?? 0, constantResult: raw.constant_result ?? [], ok, message, reverted };
  }

  async usdtBalanceOf(address: string): Promise<bigint> {
    const data = encodeBalanceOf(address);
    const res = await this.triggerConstant(address, this.cfg.usdtContract, 'balanceOf(address)', data.slice(8));
    if (!res.ok) throw new TronRpcError(`balanceOf failed: ${res.message ?? 'unknown'}`, true);
    return decodeUint256(res.constantResult[0] ?? '0');
  }

  async isBlackListed(address: string): Promise<boolean> {
    const data = encodeIsBlackListed(address);
    const res = await this.triggerConstant(address, this.cfg.usdtContract, 'isBlackListed(address)', data.slice(8));
    if (!res.ok) return false;
    return decodeUint256(res.constantResult[0] ?? '0') === 1n;
  }

  /**
   * Energy a transfer(to, amount) from `owner` would use right now.
   * `ok` is false only when the simulated call reverted (mainnet USDT uses require()). USDT's transfer()
   * has no return value, so the returned data is deliberately NOT interpreted.
   */
  async estimateTransferEnergy(owner: string, to: string, amount: bigint): Promise<{ energy: number; ok: boolean; message?: string }> {
    const res = await this.triggerConstant(owner, this.cfg.usdtContract, 'transfer(address,uint256)', transferParameter(to, amount));
    return { energy: res.energyUsed, ok: res.ok, message: res.message };
  }

  // ---------------------------------------------------------------- transactions

  async broadcast(signed: TronTxJson): Promise<BroadcastResult> {
    const raw = await this.call<{ result?: boolean; code?: string; message?: string; txid?: string }>('wallet/broadcasttransaction', signed);
    if (raw.result === true) return { ok: true, code: 'SUCCESS', txid: raw.txid ?? signed.txID };
    const code = raw.code ?? 'UNKNOWN';
    const message = raw.message ? safeHexToUtf8(raw.message) : undefined;
    // java-tron reports an already-known transaction as DUP_TRANSACTION_ERROR (protocol.proto response_code).
    // That is a success for us: the bytes we signed are in the network, so the caller must NOT build a new tx.
    const duplicate = code === 'DUP_TRANSACTION_ERROR' || code === 'DUP_TRANSACTION';
    return { ok: duplicate, code, message, txid: raw.txid ?? signed.txID };
  }

  async getSolidTransactionInfo(txId: string): Promise<TxInfo | null> {
    const raw = await this.call<TxInfo | Record<string, never>>('walletsolidity/gettransactioninfobyid', { value: txId });
    if (!raw || !('id' in raw)) return null;
    return this.normaliseTxInfo(raw as TxInfo);
  }

  async getTransactionInfo(txId: string): Promise<TxInfo | null> {
    const raw = await this.call<TxInfo | Record<string, never>>('wallet/gettransactioninfobyid', { value: txId });
    if (!raw || !('id' in raw)) return null;
    return this.normaliseTxInfo(raw as TxInfo);
  }

  async getChainParameters(): Promise<Record<string, number>> {
    const raw = await this.call<{ chainParameter?: Array<{ key: string; value?: number }> }>('wallet/getchainparameters', undefined, 'GET');
    const out: Record<string, number> = {};
    for (const p of raw.chainParameter ?? []) out[p.key] = p.value ?? 0;
    return out;
  }

  usdtHex(): string {
    return toHexAddress(this.cfg.usdtContract);
  }
}

function safeHexToUtf8(hex: string): string {
  try {
    return Buffer.from(hex, 'hex').toString('utf8');
  } catch {
    return hex;
  }
}
