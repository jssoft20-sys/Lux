import type { KycLevel } from './enums.js';

/** Default trading / withdrawal limits per KYC level (USDT). Editable in admin settings. */
export const DEFAULT_LIMITS: Record<KycLevel, { p2pPerOrder: number; p2pDaily: number; withdrawDaily: number; withdrawSingle: number; canTrade: boolean }> = {
  BASIC: { p2pPerOrder: 0, p2pDaily: 0, withdrawDaily: 0, withdrawSingle: 0, canTrade: false },
  VERIFIED: { p2pPerOrder: 2000, p2pDaily: 5000, withdrawDaily: 3000, withdrawSingle: 2000, canTrade: true },
  ADVANCED: { p2pPerOrder: 20000, p2pDaily: 50000, withdrawDaily: 30000, withdrawSingle: 15000, canTrade: true },
};

export const USDT_DECIMALS = 6;
export const KGS_DECIMALS = 2;
export const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const BSC_USDT_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';
