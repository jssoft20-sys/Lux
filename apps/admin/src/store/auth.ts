import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  totpEnabled: boolean;
  mustChangePassword: boolean;
}

interface S {
  accessToken: string | null;
  refreshToken: string | null;
  admin: AdminUser | null;
  setTokens: (a: string, r: string) => void;
  setAdmin: (a: AdminUser | null) => void;
  logout: () => void;
}

export const useAdminAuth = create<S>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      admin: null,
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setAdmin: (admin) => set({ admin }),
      logout: () => set({ accessToken: null, refreshToken: null, admin: null }),
    }),
    { name: 'somex.admin' },
  ),
);

export const can = (role: string | undefined, ...roles: string[]) => !!role && (role === 'SUPERADMIN' || roles.includes(role));
