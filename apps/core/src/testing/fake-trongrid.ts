import type { Trc20Transfer } from '../tron/trongrid.client.js';
import type { FakeTronNode } from './fake-node.js';

/** TronGridClient stand-in backed by the fake node's mined blocks. */
export class FakeTronGrid {
  constructor(private readonly node: FakeTronNode) {}

  async usdtTransfers(address: string): Promise<Trc20Transfer[]> {
    return this.node.transfersOf(address);
  }
}
