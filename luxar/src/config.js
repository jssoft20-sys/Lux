import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/* Minimal .env loader (no external dependency). Existing env vars win. */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
export const PUBLIC_DIR = path.join(ROOT, 'public');

for (const dir of [DATA_DIR, UPLOAD_DIR, path.join(DATA_DIR, 'backups')]) {
  fs.mkdirSync(dir, { recursive: true });
}

function sessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  port: Number(process.env.PORT) || 7088,
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'production',
  sessionSecret: sessionSecret(),
  adminLogin: process.env.ADMIN_LOGIN || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  trustProxy: process.env.TRUST_PROXY === '1',
  publicUrl: process.env.PUBLIC_URL || '',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 12,
};
