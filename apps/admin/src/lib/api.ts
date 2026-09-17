import { useAdminAuth } from '@/store/auth';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || '';
const BASE = `${API_URL}/api/v1/admin`;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data?: any) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const { refreshToken, setTokens, logout } = useAdminAuth.getState();
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) })
      .then(async (r) => {
        if (!r.ok) {
          logout();
          return false;
        }
        const j = await r.json();
        setTokens(j.accessToken, j.refreshToken);
        return true;
      })
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 100));
  }
  return refreshing;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const { accessToken } = useAdminAuth.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${BASE}${path}`, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && opts.retry !== false && accessToken && !path.startsWith('/auth/')) {
    if (await refresh()) return api<T>(path, { ...opts, retry: false });
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
  const res = await fetch(`${BASE}/files/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error('file');
  return URL.createObjectURL(await res.blob());
}
