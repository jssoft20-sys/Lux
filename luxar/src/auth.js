import crypto from 'node:crypto';
import { store } from './store.js';
import { config } from './config.js';
import { uuid } from './utils/ids.js';

const COOKIE = 'luxar_admin';
const SESSION_TTL_MS = 365 * 24 * 3600 * 1000; // сессия живёт год и продлевается при каждом запросе
const loginAttempts = new Map(); // ip -> { count, until }

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, auth) {
  if (!auth || !auth.salt || !auth.hash) return false;
  const { hash } = hashPassword(password, auth.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(auth.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function ensureAdmin() {
  if (store.data.auth && store.data.auth.hash) return;
  const password = config.adminPassword || 'luxar2026';
  store.data.auth = { login: config.adminLogin, ...hashPassword(password), createdAt: new Date().toISOString(), defaultPassword: !config.adminPassword };
  store.flush();
  console.log(`[auth] Создан администратор: логин "${config.adminLogin}", пароль "${password}". Смените пароль в админке → Настройки → Безопасность.`);
}

export function setAdminCredentials(login, password) {
  store.data.auth = { ...store.data.auth, login: login || store.data.auth.login, ...hashPassword(password), defaultPassword: false, updatedAt: new Date().toISOString() };
  store.data.sessions = [];
  store.flush();
}

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

export function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function createSession(req, res) {
  const id = uuid();
  const now = Date.now();
  store.insert('sessions', { id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_TTL_MS).toISOString(), ip: clientIp(req), ua: String(req.headers['user-agent'] || '').slice(0, 200) });
  // чистим просроченные
  store.data.sessions = store.data.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  const value = `${id}.${sign(id)}`;
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`);
  return id;
}

export function destroySession(req, res) {
  const s = getSession(req);
  if (s) store.remove('sessions', s.id);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function getSession(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [id, sig] = raw.split('.');
  if (!id || !sig) return null;
  const expected = sign(id);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const session = store.get('sessions', id);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) { store.remove('sessions', id); return null; }
  // скользящее продление: обновляем срок не чаще раза в сутки
  if (new Date(session.expiresAt).getTime() - Date.now() < SESSION_TTL_MS - 86400000) { session.expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString(); store.touch(); }
  return session;
}

export function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Требуется вход в админку' });
  req.session = session;
  next();
}

export function clientIp(req) {
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || '';
}

/* Защита от перебора пароля: 8 попыток, затем пауза 10 минут */
export function checkLoginAllowed(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return true;
  if (rec.until && rec.until > Date.now()) return false;
  if (rec.until && rec.until <= Date.now()) loginAttempts.delete(ip);
  return true;
}

export function registerLoginFailure(ip) {
  const rec = loginAttempts.get(ip) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= 8) { rec.until = Date.now() + 10 * 60 * 1000; rec.count = 0; }
  loginAttempts.set(ip, rec);
}

export function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}
