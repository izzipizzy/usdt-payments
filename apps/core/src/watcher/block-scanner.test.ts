import { describe, expect, it } from 'vitest';
import { TRANSFER_TOPIC, toHexAddress, USDT_CONTRACT } from '@usdt-trx/shared';
import { BlockScannerService } from './block-scanner.service.js';
import type { TxInfo } from '../tron/tron-node.client.js';

const USDT = toHexAddress(USDT_CONTRACT.nile);
const OURS = '41' + 'ab'.repeat(20);
const OTHER = '41' + 'cd'.repeat(20);
const word = (hex41: string) => '0'.repeat(24) + hex41.slice(2);

function info(partial: Partial<TxInfo>): TxInfo {
  return { id: 'a'.repeat(64), blockNumber: 100, blockTimeStamp: 1_700_000_000_000, receipt: { result: 'SUCCESS' }, log: [], ...partial };
}

describe('BlockScannerService.extract', () => {
  it('keeps only successful USDT transfers to our addresses, with the right log index', () => {
    const infos: TxInfo[] = [
      info({
        id: 'b'.repeat(64),
        log: [
          { address: OTHER, topics: [TRANSFER_TOPIC, word(OTHER), word(OURS)], data: '01' }, // other token
          { address: USDT, topics: [TRANSFER_TOPIC, word(OTHER), word(OTHER)], data: '02' }, // not ours
          { address: USDT, topics: [TRANSFER_TOPIC, word(OTHER), word(OURS)], data: '0f4240' }, // ours, 1 USDT
        ],
      }),
      info({ id: 'c'.repeat(64), receipt: { result: 'REVERT' }, log: [{ address: USDT, topics: [TRANSFER_TOPIC, word(OTHER), word(OURS)], data: '01' }] }),
      info({ id: 'd'.repeat(64), result: 'FAILED', receipt: undefined, log: [{ address: USDT, topics: [TRANSFER_TOPIC, word(OTHER), word(OURS)], data: '01' }] }),
      info({ id: 'e'.repeat(64), receipt: undefined, log: undefined }), // plain TRX transfer
    ];
    const events = BlockScannerService.extract(infos, USDT, (to) => to === OURS);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ txId: 'b'.repeat(64), logIndex: 2, toHex: OURS, fromHex: OTHER, amount: 1_000_000n, blockNumber: 100 });
  });

  it('ignores non-Transfer events on the USDT contract', () => {
    const approval = 'aa'.repeat(32);
    const infos = [info({ log: [{ address: USDT, topics: [approval, word(OTHER), word(OURS)], data: '01' }] })];
    expect(BlockScannerService.extract(infos, USDT, () => true)).toHaveLength(0);
  });
});
