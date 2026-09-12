#!/usr/bin/env node
// LuxOn Optima — Chromium login helper.
//
// Drives the real optimabusiness.kg login form in a headless Chromium so that
// Google reCAPTCHA Enterprise produces a valid `captoken` (impossible from a
// plain HTTP client), enters the TOTP second factor, and prints the resulting
// authenticated session cookies as a single JSON line on stdout.
//
// Credentials are read from the environment only (never argv, so they never
// show up in `ps`): OPTIMA_ID, OPTIMA_PASSWORD, OPTIMA_TOTP (base32 secret).
//
// Optional env:
//   OPTIMA_CHROMIUM_PATH  explicit Chromium executable (else Playwright default)
//   OPTIMA_HTTPS_PROXY    upstream proxy for Chromium (else HTTPS_PROXY)
//   OPTIMA_TLS_MAX        cap TLS version, e.g. "tls1.2" (for MITM proxies)
//   OPTIMA_HEADLESS       "0" to show the browser (debugging)
//   OPTIMA_LOGIN_TIMEOUT  overall budget in ms (default 90000)
//   OPTIMA_ROOT           base URL (default https://optimabusiness.kg)
//
// Exit code 0 on success, non-zero on failure. Human logs go to stderr.

import crypto from 'node:crypto';

const ROOT = (process.env.OPTIMA_ROOT || 'https://optimabusiness.kg').replace(/\/+$/, '');
const ID = process.env.OPTIMA_ID || '';
const PASSWORD = process.env.OPTIMA_PASSWORD || '';
const SECRET = process.env.OPTIMA_TOTP || '';
const HEADLESS = process.env.OPTIMA_HEADLESS !== '0';
const BUDGET = Math.max(20000, parseInt(process.env.OPTIMA_LOGIN_TIMEOUT || '90000', 10));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const log = (...a) => console.error('[optima-login]', ...a);
function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function fail(stage, error) { emit({ ok: false, stage, error: String(error && error.message || error) }); process.exit(2); }

// ---- TOTP (RFC 6238, SHA1, 6 digits, 30s) ---------------------------------
function totp(secret, atMs = Date.now()) {
  const b32 = secret.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '');
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of b32) { const v = alpha.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const key = Buffer.from(bytes);
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8); buf.writeBigInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const num = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(num % 1e6).padStart(6, '0');
}
function secondsIntoWindow() { return Math.floor(Date.now() / 1000) % 30; }

function launchArgs() {
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled'];
  const proxy = process.env.OPTIMA_HTTPS_PROXY || process.env.HTTPS_PROXY || '';
  if (proxy) { args.push('--proxy-server=' + proxy); log('using proxy', proxy); }
  const tlsMax = process.env.OPTIMA_TLS_MAX || (proxy ? 'tls1.2' : '');
  if (tlsMax) { args.push('--ssl-version-max=' + tlsMax); log('capping TLS at', tlsMax); }
  return args;
}

async function main() {
  if (!ID || !PASSWORD || !SECRET) return fail('input', 'OPTIMA_ID, OPTIMA_PASSWORD and OPTIMA_TOTP are required');
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { try { ({ chromium } = await import('playwright-core')); } catch (e) { return fail('import', 'playwright is not installed: ' + e.message); } }

  const launchOpts = { headless: HEADLESS, args: launchArgs() };
  if (process.env.OPTIMA_CHROMIUM_PATH) launchOpts.executablePath = process.env.OPTIMA_CHROMIUM_PATH;

  let browser;
  const killer = setTimeout(() => { log('overall timeout, aborting'); try { browser && browser.close(); } catch {} fail('timeout', 'login exceeded ' + BUDGET + 'ms'); }, BUDGET);

  try {
    browser = await chromium.launch(launchOpts);
  } catch (e) { clearTimeout(killer); return fail('launch', e); }

  try {
    const ctx = await browser.newContext({ locale: 'ru-RU', userAgent: UA, viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();

    // Watch the first-factor response so we can give precise errors.
    let firstFactor = null;
    page.on('response', async (res) => {
      if (/\/api\/v1\/login(\?|$)/.test(res.url()) && res.request().method() === 'GET') {
        try { firstFactor = { status: res.status(), body: await res.json() }; } catch { firstFactor = { status: res.status() }; }
      }
    });

    log('opening login page');
    await page.goto(ROOT + '/auth/login', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1200);

    log('entering credentials');
    await page.getByLabel('ID клиента').fill(ID);
    await page.getByLabel('Пароль').fill(PASSWORD);
    await page.getByRole('button', { name: 'Продолжить' }).click();

    // Wait for either the OTP field or a credential error.
    const otpSel = 'input[maxlength="6"]';
    try {
      await page.waitForSelector(otpSel, { timeout: 20000 });
    } catch {
      const ff = firstFactor;
      if (ff && ff.status && ff.status >= 400) return fail('credentials', 'first factor rejected (http ' + ff.status + ')');
      if (ff && ff.body && ff.body.state && ff.body.state !== 'CONFIRMED') return fail('credentials', 'unexpected login state: ' + ff.body.state);
      const err = await page.locator('.error, .q-field--error, [role=alert]').first().innerText().catch(() => '');
      return fail('credentials', 'OTP prompt did not appear' + (err ? ': ' + err.trim().slice(0, 120) : ' (check ID/password)'));
    }

    // Avoid submitting a code that is about to roll over.
    if (secondsIntoWindow() > 27) { log('TOTP window almost over, waiting'); await page.waitForTimeout((31 - secondsIntoWindow()) * 1000); }
    const code = totp(SECRET);
    log('submitting TOTP');
    await page.fill(otpSel, code);
    await page.waitForTimeout(300);
    const btn = page.getByRole('button', { name: /Продолжить|Подтвердить|Войти|Далее/ });
    if (await btn.count()) { await btn.first().click().catch(() => {}); } else { await page.keyboard.press('Enter'); }

    // Confirm the session is live by calling an authenticated GraphQL op.
    log('verifying session');
    let verified = null;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(700);
      verified = await page.evaluate(async () => {
        try {
          const r = await fetch('/ob-access-control-service/graphql', {
            method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ operationName: 'employeeSecure', query: 'query employeeSecure { employeeSecure { id fullName userReferenceId userContracts { orgReferenceId companyName contractNum __typename } __typename } }', variables: {} })
          });
          if (r.status !== 200) return { status: r.status };
          const j = await r.json();
          const emp = j && j.data && j.data.employeeSecure;
          if (!emp) return { status: 200, empty: true };
          return { status: 200, employee: emp };
        } catch (e) { return { error: String(e && e.message || e) }; }
      });
      if (verified && verified.employee) break;
    }
    if (!verified || !verified.employee) {
      const err = await page.locator('.error, [role=alert]').first().innerText().catch(() => '');
      return fail('totp', 'session not established after TOTP' + (err ? ': ' + err.trim().slice(0, 120) : ' (check TOTP secret)'));
    }

    const emp = verified.employee;
    const legalPartyId = emp.userContracts && emp.userContracts[0] && emp.userContracts[0].orgReferenceId;

    const cookiesArr = await ctx.cookies();
    const cookies = {};
    for (const c of cookiesArr) { if (/optimabusiness\.kg$/.test(c.domain) || c.domain === 'optimabusiness.kg') cookies[c.name] = c.value; }

    let sessionExpiresAt = await page.evaluate(() => {
      try { return localStorage.getItem('session-expires-at-time') || localStorage.getItem('session-expires-at') || ''; } catch { return ''; }
    });

    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    clearTimeout(killer);
    await browser.close();
    emit({
      ok: true,
      cookies,
      cookieHeader,
      sessionExpiresAt: sessionExpiresAt || null,
      legalPartyId: legalPartyId != null ? String(legalPartyId) : '',
      employee: { id: emp.id, fullName: emp.fullName, userReferenceId: emp.userReferenceId,
        companyName: emp.userContracts && emp.userContracts[0] && emp.userContracts[0].companyName || '',
        contractNum: emp.userContracts && emp.userContracts[0] && emp.userContracts[0].contractNum || '' }
    });
    process.exit(0);
  } catch (e) {
    clearTimeout(killer);
    try { await browser.close(); } catch {}
    return fail('run', e);
  }
}

main().catch((e) => fail('fatal', e));
