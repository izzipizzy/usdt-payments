import { HDKey } from '@scure/bip32';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  DERIVATION_ACCOUNT_PATH,
  addressFromPublicKey,
  decodeTransferCalldata,
  signTx,
  toHexAddress,
  txContracts,
  type DeriveResponse,
  type SignResponse,
  type TronTxJson,
} from '@usdt-trx/shared';
import { SignerPolicyError } from '../signer/signer.client.js';

/** In-process stand-in for the signer service, with the same recipient policy. */
export class FakeSigner {
  private readonly account: HDKey;
  private readonly payoutKey: { privateKeyHex: string; address: string; addressHex: string };
  private readonly tempAccount: HDKey;
  readonly poolPrivateKeyHex: string;
  readonly poolAddress: string;
  readonly poolAddressHex: string;

  constructor(
    seedHex: string,
    poolKeyHex: string,
    private readonly network: string,
    private readonly collectorHex: string,
    private readonly usdtHex: string,
  ) {
    const master = HDKey.fromMasterSeed(hexToBytes(seedHex));
    this.account = master.derive(DERIVATION_ACCOUNT_PATH);
    this.tempAccount = master.derive("m/44'/195'/3'");
    const payoutNode = master.derive("m/44'/195'/2'/0/0");
    const pk = addressFromPublicKey(payoutNode.publicKey!);
    this.payoutKey = { privateKeyHex: bytesToHex(payoutNode.privateKey!), address: pk.base58, addressHex: pk.hex };
    this.poolPrivateKeyHex = poolKeyHex;
    const { base58, hex } = addressFromPublicKey(secp256k1.getPublicKey(poolKeyHex, true));
    this.poolAddress = base58;
    this.poolAddressHex = hex;
  }

  private child(index: number): HDKey {
    return this.account.deriveChild(0).deriveChild(index);
  }

  async health() {
    return { ok: true, network: this.network, collector: this.collectorHex, pool: this.poolAddress };
  }

  get payoutAddress(): string {
    return this.payoutKey.address;
  }

  async walletStatus() {
    return { initialized: true, network: this.network, xpub: this.account.publicExtendedKey, poolAddress: this.poolAddress, payoutAddress: this.payoutKey.address, mainAddress: this.payoutKey.address, collectorAddress: this.payoutKey.address, collectorExternal: false };
  }

  async xpub() {
    return { xpub: this.account.publicExtendedKey, path: DERIVATION_ACCOUNT_PATH, network: this.network };
  }

  async derive(index: number): Promise<DeriveResponse> {
    const k = this.child(index);
    const { base58, hex } = addressFromPublicKey(k.publicKey!);
    return { index, address: base58, addressHex: hex, publicKey: bytesToHex(k.publicKey!) };
  }

  async deriveBatch(indices: number[]): Promise<DeriveResponse[]> {
    return Promise.all(indices.map((i) => this.derive(i)));
  }

  async signSweep(index: number, tx: TronTxJson): Promise<SignResponse> {
    const k = this.child(index);
    const { hex } = addressFromPublicKey(k.publicKey!);
    const [c] = txContracts(tx);
    if (c.type !== 'TriggerSmartContract') throw new SignerPolicyError('CONTRACT_TYPE', c.type);
    if (String(c.parameter.value.owner_address) !== hex) throw new SignerPolicyError('WRONG_OWNER', 'owner mismatch');
    if (String(c.parameter.value.contract_address) !== this.usdtHex) throw new SignerPolicyError('WRONG_CONTRACT', 'not USDT');
    const decoded = decodeTransferCalldata(String(c.parameter.value.data));
    if (decoded.toHex !== this.collectorHex) throw new SignerPolicyError('WRONG_RECIPIENT', `recipient ${decoded.to} is not the collector`);
    return { txID: tx.txID, signature: signTx(bytesToHex(k.privateKey!), tx) };
  }

  private temp(index: number) {
    const node = this.tempAccount.deriveChild(0).deriveChild(index);
    const a = addressFromPublicKey(node.publicKey!);
    return { privateKeyHex: bytesToHex(node.privateKey!), address: a.base58, addressHex: a.hex, publicKey: bytesToHex(node.publicKey!) };
  }

  async deriveTemp(index: number): Promise<DeriveResponse> {
    const t = this.temp(index);
    return { index, address: t.address, addressHex: t.addressHex, publicKey: t.publicKey };
  }

  async signPayout(tx: TronTxJson, stage: 1 | 2, tempIndex: number): Promise<SignResponse> {
    const [c] = txContracts(tx);
    const t = this.temp(tempIndex);
    const owner = String(c.parameter.value.owner_address);
    const decoded = decodeTransferCalldata(String(c.parameter.value.data));
    if (String(c.parameter.value.contract_address) !== this.usdtHex) throw new SignerPolicyError('WRONG_CONTRACT', 'not USDT');
    if (stage === 1) {
      if (owner !== this.payoutKey.addressHex) throw new SignerPolicyError('WRONG_OWNER', 'not the main wallet');
      if (decoded.toHex !== t.addressHex) throw new SignerPolicyError('WRONG_RECIPIENT', 'stage 1 must go to the hop address');
      return { txID: tx.txID, signature: signTx(this.payoutKey.privateKeyHex, tx) };
    }
    if (owner !== t.addressHex) throw new SignerPolicyError('WRONG_OWNER', 'not the hop address');
    return { txID: tx.txID, signature: signTx(t.privateKeyHex, tx) };
  }

  async signPool(tx: TronTxJson): Promise<SignResponse> {
    const [c] = txContracts(tx);
    if (String(c.parameter.value.owner_address) !== toHexAddress(this.poolAddress)) throw new SignerPolicyError('WRONG_OWNER', 'not pool');
    return { txID: tx.txID, signature: signTx(this.poolPrivateKeyHex, tx) };
  }
}
