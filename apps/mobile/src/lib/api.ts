import { useAuth } from '@/store/auth';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || '';
const BASE = `${API_URL}/api/v1`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public data?: any,
  ) {
    super(message);
  }
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem('somex.device');
    if (!id) {
      id = `web-${crypto.randomUUID()}`;
      localStorage.setItem('somex.device', id);
    }
    return id;
  } catch {
    return 'web-unknown';
  }
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const { refreshToken, setTokens, logout } = useAuth.getState();
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId() }, body: JSON.stringify({ refreshToken }) })
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

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData; headers?: Record<string, string>; retry?: boolean } = {}): Promise<T> {
  const { accessToken } = useAuth.getState();
  const headers: Record<string, string> = { 'X-Device-Id': deviceId(), ...(opts.headers || {}) };
  if (!opts.form) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${BASE}${path}`, { method: opts.method || (opts.body || opts.form ? 'POST' : 'GET'), headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  if (res.status === 401 && opts.retry !== false && accessToken) {
    if (await refreshTokens()) return api<T>(path, { ...opts, retry: false });
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text };
  }
  if (!res.ok) {
    const msg = Array.isArray(json?.message) ? json.message.join(', ') : json?.message || `Ошибка ${res.status}`;
    throw new ApiError(res.status, json?.code || 'ERROR', msg, json);
  }
  return json as T;
}

export function fileUrl(id: string | null | undefined) {
  return id ? `${BASE}/files/${id}` : '';
}

/** Fetch a private file as an object URL (auth header required, so no plain <img src>). */
export async function fetchFileBlob(id: string): Promise<string> {
  const { accessToken } = useAuth.getState();
  const res = await fetch(`${BASE}/files/${id}`, { headers: { Authorization: `Bearer ${accessToken}`, 'X-Device-Id': deviceId() } });
  if (!res.ok) throw new Error('file');
  return URL.createObjectURL(await res.blob());
}
