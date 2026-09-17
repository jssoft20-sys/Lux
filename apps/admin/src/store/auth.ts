import { create } from 'zustand';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  totpEnabled: boolean;
  mustChangePassword: boolean;
}

/** Access token and admin profile live in memory only; the refresh token is an httpOnly cookie. */
interface S {
  accessToken: string | null;
  admin: AdminUser | null;
  restored: boolean;
  setAccess: (a: string | null) => void;
  setAdmin: (a: AdminUser | null) => void;
  setRestored: () => void;
  logout: () => void;
}

export const useAdminAuth = create<S>()((set) => ({
  accessToken: null,
  admin: null,
  restored: false,
  setAccess: (accessToken) => set({ accessToken }),
  setAdmin: (admin) => set({ admin }),
  setRestored: () => set({ restored: true }),
  logout: () => set({ accessToken: null, admin: null }),
}));

export const can = (role: string | undefined, ...roles: string[]) => !!role && (role === 'SUPERADMIN' || roles.includes(role));
