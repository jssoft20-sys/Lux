import type { Request } from 'express';

export function clientIp(req: Request): string {
  const xf = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ip = xf || req.ip || req.socket?.remoteAddress || '';
  return ip.replace(/^::ffff:/, '');
}

export function userAgent(req: Request): string {
  return (req.headers['user-agent'] as string | undefined)?.slice(0, 300) || '';
}

export function deviceFingerprintHeader(req: Request): string | undefined {
  const v = req.headers['x-device-id'];
  return typeof v === 'string' && v.length >= 8 && v.length <= 128 ? v : undefined;
}
