import type { Request, Response } from 'express';
import { loadEnv } from '../../config/env';

export const USER_REFRESH_COOKIE = 'sx_rt';
export const ADMIN_REFRESH_COOKIE = 'sx_art';
export const USER_COOKIE_PATH = '/api/v1/auth';
export const ADMIN_COOKIE_PATH = '/api/v1/admin/auth';

export function isSecureRequest(req: Request): boolean {
  return req.secure || (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() === 'https';
}

/**
 * Refresh tokens for browser clients live in an httpOnly, SameSite=Strict cookie scoped to the auth path:
 * scripts injected by XSS cannot read it, other sites cannot send it, and it is never exposed to the SPA.
 */
export function setRefreshCookie(req: Request, res: Response, name: string, path: string, value: string, maxAgeMs: number) {
  res.cookie(name, value, { httpOnly: true, secure: isSecureRequest(req), sameSite: 'strict', path, maxAge: maxAgeMs });
}

export function clearRefreshCookie(req: Request, res: Response, name: string, path: string) {
  res.cookie(name, '', { httpOnly: true, secure: isSecureRequest(req), sameSite: 'strict', path, maxAge: 0 });
}

/** Browser clients identify themselves; native apps keep tokens in secure storage and get them in the body. */
export function isWebClient(req: Request): boolean {
  return (req.headers['x-client'] as string | undefined)?.toLowerCase() === 'web';
}

/**
 * CSRF defence for cookie-authenticated requests: a custom header that cross-site forms cannot set,
 * plus an Origin/Referer check against the request host and the configured CORS allow-list.
 */
export function csrfCheck(req: Request): { ok: boolean; reason?: string } {
  const xrw = (req.headers['x-requested-with'] as string | undefined) ?? '';
  if (xrw.toLowerCase() !== 'xmlhttprequest') return { ok: false, reason: 'MISSING_XRW' };
  const origin = (req.headers.origin as string | undefined) || (req.headers.referer as string | undefined);
  if (!origin) return { ok: true }; // same-origin fetches may omit both (privacy modes); SameSite=Strict still applies
  try {
    const u = new URL(origin);
    const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.headers.host || '';
    const allowed = loadEnv().CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
    if (u.host === host || allowed.includes(u.origin)) return { ok: true };
    return { ok: false, reason: 'ORIGIN_MISMATCH' };
  } catch {
    return { ok: false, reason: 'BAD_ORIGIN' };
  }
}
