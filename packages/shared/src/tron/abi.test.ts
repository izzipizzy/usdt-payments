import { describe, expect, it } from 'vitest';
import { decodeTransferCalldata, decodeTransferLog, encodeBalanceOf, encodeTransfer } from './abi.js';
import { TRANSFER_TOPIC, USDT_CONTRACT } from './constants.js';

const USDT_EVM = 'a614f803b6fd780986a42c78ec9c7f77e6ded13c';

describe('abi', () => {
  it('encodes transfer(address,uint256)', () => {
    const data = encodeTransfer(USDT_CONTRACT.mainnet, 1_500_000n);
    expect(data).toBe(
      'a9059cbb' + '000000000000000000000000' + USDT_EVM + '000000000000000000000000000000000000000000000000000000000016e360',
    );
    expect(data.length).toBe(8 + 64 + 64);
  });

  it('encodes balanceOf(address)', () => {
    expect(encodeBalanceOf(USDT_CONTRACT.mainnet)).toBe('70a08231' + '000000000000000000000000' + USDT_EVM);
  });

  it('round-trips transfer calldata', () => {
    const decoded = decodeTransferCalldata(encodeTransfer(USDT_CONTRACT.mainnet, 123n));
    expect(decoded.to).toBe(USDT_CONTRACT.mainnet);
    expect(decoded.toHex).toBe(`41${USDT_EVM}`);
    expect(decoded.amount).toBe(123n);
    expect(() => decodeTransferCalldata('70a08231' + '0'.repeat(128))).toThrow(/selector/);
  });

  it('decodes Transfer logs and ignores others', () => {
    const topics = [
      TRANSFER_TOPIC,
      '000000000000000000000000' + USDT_EVM,
      '000000000000000000000000' + USDT_EVM,
    ];
    const log = decodeTransferLog(topics, '0000000000000000000000000000000000000000000000000000000000989680');
    expect(log?.amount).toBe(10_000_000n);
    expect(log?.to).toBe(USDT_CONTRACT.mainnet);
    expect(log?.toHex).toBe(`41${USDT_EVM}`);
    expect(decodeTransferLog(['aa'.repeat(32), topics[1], topics[2]], '00')).toBeNull();
    expect(decodeTransferLog([TRANSFER_TOPIC, topics[1]], '00')).toBeNull();
  });
});
