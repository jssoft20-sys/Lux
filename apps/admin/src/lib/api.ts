import { useAdminAuth } from '@/store/auth';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || '';
const BASE = `${API_URL}/api/v1/admin`;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: any) {
    super(message);
  }
}

const CSRF_HEADERS = { 'X-Client': 'web', 'X-Requested-With': 'XMLHttpRequest' };

let refreshing: Promise<boolean> | null = null;
export async function refreshSession(): Promise<boolean> {
  const { setAccess, logout } = useAdminAuth.getState();
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...CSRF_HEADERS }, body: '{}' })
      .then(async (r) => {
        if (!r.ok) {
          logout();
          return false;
        }
        const j = await r.json();
        setAccess(j.accessToken);
        if (j.admin) useAdminAuth.getState().setAdmin(j.admin);
        return true;
      })
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 100));
  }
  return refreshing;
}

export async function restoreSession(): Promise<void> {
  const st = useAdminAuth.getState();
  try {
    if (await refreshSession()) {
      const me = await api<any>('/auth/me', { retry: false });
      st.setAdmin(me);
    }
  } catch {
    st.logout();
  } finally {
    useAdminAuth.getState().setRestored();
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const { accessToken } = useAdminAuth.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...CSRF_HEADERS };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${BASE}${path}`, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers, credentials: 'include', body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && opts.retry !== false && accessToken && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, { ...opts, retry: false });
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text };
  }
  if (!res.ok) throw new ApiError(res.status, json?.code || 'ERROR', Array.isArray(json?.message) ? json.message.join(', ') : json?.message || `Ошибка ${res.status}`, json);
  return json as T;
}

export function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function fetchAdminFile(id: string): Promise<string> {
  const { accessToken } = useAdminAuth.getState();
  const res = await fetch(`${BASE}/files/${id}`, { headers: { Authorization: `Bearer ${accessToken}`, ...CSRF_HEADERS }, credentials: 'include' });
  if (!res.ok) throw new Error('file');
  return URL.createObjectURL(await res.blob());
}
