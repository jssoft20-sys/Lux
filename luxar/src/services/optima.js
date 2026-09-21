import crypto from 'node:crypto';
import { store } from '../store.js';
import { localIsoNoZone } from '../utils/time.js';

/*
 * Клиент API «Optima Business» (ОАО «Оптима Банк»), по руководству v1.0 от 12.06.2026:
 *  - GET  /api/v2/get-sale-point-infos/{legalPartyId}   — торговые точки и кассы (автоопределение)
 *  - POST /api/v2/generate/qr                            — генерация QR (v2, динамический)
 *  - GET  /api/v1/get-qr-transaction-info/{transactionId}— статус транзакции (PROCESSED / NOT_EXIST / ERROR)
 *  - GET  /api/v1/get-qr-operation-statement             — выписка по QR-платежам (≤ 14 дней)
 *  - GET  /api/v1/get-pos-operation-statement            — выписка по POS и QR
 *  - GET  /api/v1/get-account-infos-by-filter            — остатки по счетам
 * Заголовок аутентификации: X-API-KEY.
 */

export class OptimaError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message);
    this.name = 'OptimaError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const QR_TYPES_FALLBACK = ['DEEP_LINKS_BY_SALE_POINT', 'CALLBACK_WEB_PARTNER_BY_SALE_POINT', 'WEB_PARTNER_BY_SALE_POINT', 'PLATFORM_PARTNER_BY_SALE_POINT'];

function cfg() {
  return store.settings.optima;
}

export function isConfigured(c = cfg()) {
  return Boolean(c.enabled && String(c.legalPartyId || '').trim() && String(c.apiKey || '').trim());
}

export function hasCredentials(c = cfg()) {
  return Boolean(String(c.legalPartyId || '').trim() && String(c.apiKey || '').trim());
}

function baseUrl(c = cfg()) {
  return String(c.baseUrl || 'https://api.optimabusiness.kg').replace(/\/+$/, '');
}

async function request(path, { method = 'GET', body, query, timeoutMs = 20000, creds } = {}) {
  const c = creds || cfg();
  const url = new URL(baseUrl(c) + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'X-API-KEY': String(c.apiKey || '').trim(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new OptimaError(err.name === 'AbortError' ? 'Банк не ответил вовремя' : 'Нет связи с API банка: ' + err.message);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new OptimaError(humanError(res.status, msg), { status: res.status, code: data && data.code, body: data });
  }
  return data;
}

function humanError(status, msg) {
  if (status === 401) return 'Неверный API-ключ (401)';
  if (status === 403) return `Доступ запрещён: ${msg} (403). Проверьте, что ключ связан с ID компании и выбрана нужная категория доступа`;
  if (status === 404) return `Не найдено: ${msg} (404)`;
  if (status === 400) return `Ошибка запроса: ${msg} (400)`;
  if (status >= 500) return `Ошибка на стороне банка: ${msg} (${status})`;
  return `${msg} (${status})`;
}

/* Список торговых точек и касс, развёрнутый в плоский список */
export async function fetchSalePoints(creds) {
  const c = creds || cfg();
  const data = await request(`/api/v2/get-sale-point-infos/${encodeURIComponent(String(c.legalPartyId).trim())}`, { creds: c });
  const list = [];
  const accounts = Array.isArray(data) ? data : data && Array.isArray(data.data) ? data.data : [];
  for (const acc of accounts) {
    for (const sp of acc.salePointInfoDtoList || []) {
      const cashes = sp.cashDtoList && sp.cashDtoList.length ? sp.cashDtoList : [{ name: '', code: null }];
      for (const cash of cashes) {
        list.push({ account: acc.account, salePointCode: sp.code, salePointName: sp.name || '', address: sp.address || '', cashCode: cash.code, cashName: cash.name || '' });
      }
    }
  }
  return list;
}

/*
 * Проверка подключения + автоопределение торговой точки.
 * Достаточно указать в админке ID компании и API-ключ: точка и касса подставятся сами.
 */
export async function checkAndDiscover(creds) {
  const c = creds || cfg();
  if (!hasCredentials(c)) throw new OptimaError('Укажите ID компании и API-ключ');
  const salePoints = await fetchSalePoints(c);
  const current = cfg();
  let selected = salePoints.find((s) => String(s.salePointCode) === String(current.salePointCode) && String(s.cashCode) === String(current.cashCode)) || null;
  if (!selected) selected = salePoints.find((s) => s.cashCode !== null) || salePoints[0] || null;
  const patch = {
    salePoints,
    lastCheck: { ok: true, at: new Date().toISOString(), message: salePoints.length ? `Найдено торговых точек/касс: ${salePoints.length}` : 'Подключение работает, но торговые точки не найдены. Создайте точку продаж и кассу в Optima Business.' },
  };
  if (selected) {
    patch.salePointCode = selected.salePointCode;
    patch.cashCode = selected.cashCode;
    patch.account = selected.account;
    patch.salePointName = [selected.salePointName, selected.cashName].filter(Boolean).join(' · ');
  }
  store.updateSettings('optima', patch);
  return { ok: true, salePoints, selected };
}

export async function ensureSalePoint() {
  const c = cfg();
  if (c.salePointCode !== null && c.salePointCode !== undefined && c.salePointCode !== '' && c.cashCode !== null && c.cashCode !== undefined && c.cashCode !== '') return c;
  await checkAndDiscover();
  const after = cfg();
  if (after.salePointCode === null || after.salePointCode === undefined || after.cashCode === null || after.cashCode === undefined) {
    throw new OptimaError('У компании нет торговой точки с кассой в Optima Business');
  }
  return after;
}

/* Очистка назначения платежа: до 140 символов, без \ « » & < > */
export function sanitizeNote(str) {
  return String(str || 'Оплата')
    .replace(/[\\«»&<>"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140) || 'Оплата';
}

function isTypeProblem(err) {
  const text = `${err.message} ${JSON.stringify(err.body || {})}`.toLowerCase();
  return err.status === 400 || err.status === 403 ? /qrgeneratetype|type|not allowed|deep|callback|category|катег/.test(text) : false;
}

/* Генерация динамического QR (v2). При проблеме с типом QR — перебор совместимых типов. */
export async function generateQr({ amountKgs, note, ttlMinutes, transactionCount = 1 }) {
  const c = await ensureSalePoint();
  const preferred = c.qrGenerateType || 'DEEP_LINKS_BY_SALE_POINT';
  const types = [preferred, ...QR_TYPES_FALLBACK.filter((t) => t !== preferred)];
  const ttl = Number(ttlMinutes ?? c.qrTtlMinutes) || 0;
  const until = ttl > 0 ? localIsoNoZone(new Date(Date.now() + ttl * 60000), store.settings.site.timezone) : '';
  const errors = [];
  for (const type of types) {
    const body = {
      requisite: { salePointCode: Number(c.salePointCode), cashCode: Number(c.cashCode), legalPartyId: Number(c.legalPartyId) },
      sum: Math.round(Number(amountKgs) * 100) / 100,
      allowEditSum: false,
      note: sanitizeNote(note),
      qrGenerateType: type,
      transactionCount: Math.max(1, Number(transactionCount) || 1),
      untilDateTime: until,
      qrType: 'png',
      qrSize: Math.min(550, Math.max(150, Number(c.qrSize) || 300)),
      payerClientType: c.payerClientType || '',
    };
    let attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      try {
        const data = await request('/api/v2/generate/qr', { method: 'POST', body });
        if (!data || !data.transactionId) throw new OptimaError('Банк вернул ответ без transactionId', { body: data });
        return {
          transactionId: String(data.transactionId),
          qrBase64: data.qrBase64 || '',
          qrUrl: data.qrUrl || '',
          deepLinks: Array.isArray(data.deepLinks) ? data.deepLinks.map((d) => ({ name: d.bank_name || d.bankName || 'Банк', icon: d.bank_icon || d.bankIcon || '', url: d.bank_qr_deeplink || d.deeplink || d.url || '' })).filter((d) => d.url) : [],
          qrGenerateType: type,
          untilDateTime: body.untilDateTime,
          sum: body.sum,
          note: body.note,
        };
      } catch (err) {
        if (!(err instanceof OptimaError)) throw err;
        const text = `${err.message} ${JSON.stringify(err.body || {})}`.toLowerCase();
        if (attempt === 1 && body.untilDateTime && /untildatetime|future|date/.test(text)) { body.untilDateTime = ''; continue; }
        if (attempt === 1 && /allowedit|allow_edit/.test(text)) { delete body.allowEditSum; continue; }
        errors.push(`${type}: ${err.message}`);
        if (isTypeProblem(err)) break; // пробуем следующий тип
        throw err;
      }
    }
  }
  throw new OptimaError('Не удалось создать QR: ' + errors.join('; '));
}

export async function getTransactionInfo(transactionId) {
  const data = await request(`/api/v1/get-qr-transaction-info/${encodeURIComponent(transactionId)}`);
  return {
    status: String(data.status || '').toUpperCase(),
    sum: data.sum !== undefined ? Number(data.sum) : null,
    note: data.note || '',
    processedAt: data.transactionProcessedDateTime || null,
    payerClientType: data.payerClientType || '',
    raw: data,
  };
}

export async function getQrStatement({ startDate, endDate, salePointCodes }) {
  const c = cfg();
  const codes = salePointCodes || [...new Set((c.salePoints || []).map((s) => s.salePointCode).filter((x) => x !== null && x !== undefined))];
  if (!codes.length && c.salePointCode !== null && c.salePointCode !== undefined) codes.push(c.salePointCode);
  return request('/api/v1/get-qr-operation-statement', { query: { startDate, endDate, salePointCodes: codes.join(','), legalPartyId: String(c.legalPartyId).trim() } });
}

export async function getPosStatement({ startDate, endDate, accountNumber }) {
  const c = cfg();
  return request('/api/v1/get-pos-operation-statement', { query: { startDate, endDate, accountNumber: accountNumber || c.account } });
}

export async function getBalances(currencyIsoCodes = 'KGS,USD') {
  const c = cfg();
  return request('/api/v1/get-account-infos-by-filter', { query: { currencyIsoCodes, legalPartyId: String(c.legalPartyId).trim() } });
}

/* Проверка Basic Auth входящего callback от банка */
export function verifyCallbackAuth(header) {
  const c = cfg();
  if (!c.callbackLogin || !c.callbackPassword) return false;
  if (!header || !/^basic /i.test(header)) return false;
  const expected = Buffer.from(`${c.callbackLogin}:${c.callbackPassword}`).toString('base64');
  const given = header.slice(6).trim();
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
