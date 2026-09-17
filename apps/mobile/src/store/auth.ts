import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Profile {
  id: string;
  phone: string;
  phoneFormatted: string;
  status: string;
  nickname: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  avatarFileId: string | null;
  language: string;
  kyc: { level: 'BASIC' | 'VERIFIED' | 'ADVANCED'; status: string };
  security: { pinSet: boolean; biometricEnabled: boolean; devices: number; sensitiveOpsLockedUntil: string | null; withdrawalsFrozen: boolean; tradingFrozen: boolean };
  balance: { available: string; locked: string; asset: string };
  stats: { completedOrders: number; activeOrders: number; rating: number | null; completionRate: number; memberSince: string };
  limits: { canTrade: boolean; p2pPerOrder: number; p2pDaily: number; withdrawDaily: number; withdrawSingle: number };
  paymentMethods: PaymentMethod[];
  createdAt: string;
}

export interface PaymentMethod {
  id: string;
  bankCode: string;
  bankName: string;
  bankShort: string;
  showsSenderName: boolean;
  holderName: string;
  accountMasked: string;
  status: string;
  nameMatchesKyc: boolean;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: Profile | null;
  onboarded: boolean;
  pendingPhone: string | null;
  setTokens: (a: string, r: string) => void;
  setUser: (u: Profile | null) => void;
  setPendingPhone: (p: string | null) => void;
  setOnboarded: () => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      onboarded: false,
      pendingPhone: null,
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setUser: (user) => set({ user }),
      setPendingPhone: (pendingPhone) => set({ pendingPhone }),
      setOnboarded: () => set({ onboarded: true }),
      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'somex.auth', partialize: (s) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user, onboarded: s.onboarded }) },
  ),
);
