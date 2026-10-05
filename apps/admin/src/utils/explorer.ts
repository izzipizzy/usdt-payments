/** Build explorer links; prefer DTO-provided `explorerUrl` when present. */
const trimBase = (base: string): string => base.replace(/\/+$/, '');

export const txUrl = (explorerBase: string | undefined, txId: string | null | undefined, explorerUrl?: string | null): string | null => {
  if (explorerUrl) return explorerUrl;
  if (!txId || !explorerBase) return null;
  return `${trimBase(explorerBase)}/transaction/${txId}`;
};

export const addressUrl = (explorerBase: string | undefined, address: string | null | undefined, explorerUrl?: string | null): string | null => {
  if (explorerUrl) return explorerUrl;
  if (!address || !explorerBase) return null;
  return `${trimBase(explorerBase)}/address/${address}`;
};
