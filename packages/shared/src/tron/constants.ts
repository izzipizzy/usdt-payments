export type Network = 'mainnet' | 'nile';

/** USDT TRC-20 contract per network (base58). */
export const USDT_CONTRACT: Record<Network, string> = {
  mainnet: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  nile: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
};

export const USDT_DECIMALS = 6;
export const SUN_PER_TRX = 1_000_000n;

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** 4-byte selectors of the TRC-20 methods we touch. */
export const SELECTOR = {
  transfer: 'a9059cbb',
  balanceOf: '70a08231',
  isBlackListed: 'e47d6060',
} as const;

/** Energy needed by a USDT transfer, used as floor for estimates. */
export const ENERGY_TRANSFER_NONZERO_RECIPIENT = 65_000;
export const ENERGY_TRANSFER_ZERO_RECIPIENT = 131_000;
/** Bytes of a signed TRC-20 transfer, roughly. */
export const BANDWIDTH_TRANSFER_BYTES = 350;

/** Default Tronscan base URLs, used by API responses and the admin UI. */
export const TRONSCAN_URL: Record<Network, string> = {
  mainnet: 'https://tronscan.org/#',
  nile: 'https://nile.tronscan.org/#',
};

export const DERIVATION_ACCOUNT_PATH = "m/44'/195'/0'";
export const derivationPath = (index: number): string => `${DERIVATION_ACCOUNT_PATH}/0/${index}`;
