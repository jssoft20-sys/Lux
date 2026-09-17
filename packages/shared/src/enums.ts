export const USER_STATUS = ['ACTIVE', 'RESTRICTED', 'FROZEN', 'BANNED'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const KYC_LEVEL = ['BASIC', 'VERIFIED', 'ADVANCED'] as const;
export type KycLevel = (typeof KYC_LEVEL)[number];

export const KYC_STATUS = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'APPROVED', 'DECLINED', 'EXPIRED'] as const;
export type KycStatus = (typeof KYC_STATUS)[number];

export const ORDER_STATUS = [
  'CREATED', // escrow locked, waiting for buyer payment
  'PAID', // buyer declared payment, waiting for seller confirmation
  'RELEASED', // seller released, completed
  'CANCELLED',
  'EXPIRED',
  'DISPUTED',
  'RESOLVED_RELEASE',
  'RESOLVED_REFUND',
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

export const AD_SIDE = ['BUY', 'SELL'] as const; // from the advertiser's perspective
export type AdSide = (typeof AD_SIDE)[number];

export const DEPOSIT_STATUS = ['DETECTED', 'CONFIRMING', 'SCREENING', 'HELD', 'CREDITED', 'REJECTED'] as const;
export type DepositStatus = (typeof DEPOSIT_STATUS)[number];

export const WITHDRAWAL_STATUS = [
  'AWAITING_OTP',
  'RISK_REVIEW',
  'APPROVAL_REQUIRED',
  'APPROVED',
  'BROADCASTING',
  'SENT',
  'CONFIRMED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUS)[number];

export const RISK_ACTION = ['ALLOW', 'REVIEW', 'BLOCK'] as const;
export type RiskAction = (typeof RISK_ACTION)[number];

export const NETWORKS = ['TRON', 'BSC'] as const;
export type Network = (typeof NETWORKS)[number];

export const ADMIN_ROLES = ['SUPERADMIN', 'COMPLIANCE', 'FINANCE', 'RISK', 'SUPPORT', 'VIEWER'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
