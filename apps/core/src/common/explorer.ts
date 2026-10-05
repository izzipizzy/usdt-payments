import { TRONSCAN_URL, type Network } from '@usdt-trx/shared';

export const explorerBase = (network: Network): string => TRONSCAN_URL[network];
export const explorerTx = (network: Network, txId: string): string => `${TRONSCAN_URL[network]}/transaction/${txId}`;
export const explorerAddress = (network: Network, address: string): string => `${TRONSCAN_URL[network]}/address/${address}`;
