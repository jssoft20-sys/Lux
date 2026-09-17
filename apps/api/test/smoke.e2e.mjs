import { authenticator } from 'otplib';
// Smoke test against a running dev API (OTP_DEV_ECHO=true, DEV_SIMULATE_CHAIN=true, seeded DB).
// Run: node test/smoke.e2e.mjs   (API_URL env to override http://localhost:4000)
const API = (process.env.API_URL || 'http://localhost:4000') + '/api/v1';
const log = (...a) => console.log(...a);
async function call(method, path, body, token, extraHeaders = {}) {
  const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', 'X-Device-Id': extraHeaders.device || 'smoke-device-0001', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) { throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 400)}`); }
  return json;
}
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
async function login(phone, device) {
  await new Promise((r) => setTimeout(r, 4000));
  const req = await call('POST', '/auth/otp/request', { phone }, null, { device });
  assert(req.devCode, 'dev code echoed');
  const v = await call('POST', '/auth/otp/verify', { phone, code: req.devCode, device: { platform: 'ios', model: 'iPhone 15', appVersion: '1.0.0' } }, null, { device });
  return { ...v, device };
}
(async () => {
  // 1. new user registers
  const BUYER_PHONE = '0700 ' + String(Math.floor(100000 + Math.random() * 899999)).replace(/(\d{3})(\d{3})/, '$1 $2');
  const buyer = await login(BUYER_PHONE, 'buyer-device-' + Date.now());
  log('✔ buyer registered', buyer.user.phone, 'newUser=', buyer.isNewUser);
  const bt = buyer.accessToken;
  // invalid phone rejected
  await call('POST', '/auth/otp/request', { phone: '+79161234567' }).then(() => assert(false, 'should reject RU phone')).catch((e) => assert(/INVALID_PHONE/.test(e.message), 'RU phone rejected: ' + e.message));
  log('✔ non-KG phone rejected');
  // 2. KYC sandbox
  const k0 = await call('POST', '/kyc/session', {}, bt);
  assert(k0.mode === 'sandbox', 'sandbox mode');
  const k1 = await call('POST', '/kyc/sandbox/complete', { fullName: 'Абдыкадыров Бекжан Асанович', documentNumber: 'ID' + Math.floor(1000000 + Math.random() * 8999999), dateOfBirth: '1996-03-14' }, bt);
  assert(k1.status === 'APPROVED', 'kyc approved ' + JSON.stringify(k1));
  log('✔ KYC approved (sandbox), level', k1.level);
  // 3. payment method
  const pm = await call('POST', '/me/payment-methods', { bankCode: 'OPTIMA', accountNumber: '4169 58' + String(Math.floor(1000000000 + Math.random() * 8999999999)) }, bt);
  assert(pm.holderName === 'Абдыкадыров Бекжан Асанович', 'holder from KYC');
  log('✔ payment method added', pm.bankShort, pm.accountMasked, 'holder=', pm.holderName);
  // 4. market
  const ads = await call('GET', '/p2p/ads?side=BUY&bank=OPTIMA&amount=50000', null, bt);
  assert(ads.items.length > 0, 'ads found');
  const ad = ads.items[0];
  log('✔ ads listed', ads.total, 'best:', ad.advertiser.name, ad.price, ad.bank.shortName);
  // 5. order
  const order = await call('POST', '/p2p/orders', { adId: ad.id, amountFiat: '50000', agreedToRules: true }, bt);
  assert(order.status === 'CREATED' && order.payment.accountNumber, 'order created with revealed requisites');
  log('✔ order created #' + order.number, order.amountUsdt, 'USDT for', order.amountFiat, 'KGS; pay to', order.payment.holderName, order.payment.accountNumber, 'senderMustBe=', order.payment.senderMustBe);
  // seller side
  const SELLER_PHONES = { AltynTrade: '+996700111222', KGS_Exchange: '+996555777888', Bishkek_Crypto: '+996777333444', Naryn_USDT: '+996999555666', Eldar_Osh: '+996550101010' };
  const seller = await login(SELLER_PHONES[ad.advertiser.name], 'seller-device-1');
  const st = seller.accessToken;
  const sview = await call('GET', `/p2p/orders/${order.id}`, null, st);
  assert(sview.role === 'SELLER' && sview.expected.senderName === 'Абдыкадыров Бекжан Асанович', 'seller sees expected sender');
  assert(!sview.payment, 'seller does not get payment block');
  log('✔ seller view: expect', sview.expected.amountFiat, 'KGS from', sview.expected.senderName, 'via', sview.expected.senderBank);
  // release before payment must fail
  await call('POST', `/p2p/orders/${order.id}/release`, { checkedBankApp: true, senderNameMatches: true, amountMatches: true }, st).then(() => assert(false, 'release before paid')).catch((e) => assert(/STATE/.test(e.message), 'release blocked before PAID'));
  log('✔ release blocked before buyer marks paid');
  // chat + flag
  const msg = await call('POST', `/p2p/orders/${order.id}/messages`, { text: 'Давай в whatsapp перейдём +996 555 111 222' }, bt);
  assert(msg.flagged, 'off-platform message flagged');
  log('✔ chat message flagged:', msg.flagReason);
  // upload receipt (1x1 png)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData(); fd.append('file', new Blob([png], { type: 'image/png' }), 'receipt.png');
  const up = await fetch(API + '/files?kind=RECEIPT', { method: 'POST', headers: { Authorization: `Bearer ${bt}`, 'X-Device-Id': 'buyer-device-1' }, body: fd }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j; });
  log('✔ receipt uploaded', up.mime, up.size, 'bytes, scan=', up.scanStatus);
  // exe upload must be rejected
  const bad = new FormData(); bad.append('file', new Blob([Buffer.from('MZ\x90\x00this is not an image at all, definitely not')], { type: 'image/png' }), 'x.png');
  const badRes = await fetch(API + '/files?kind=RECEIPT', { method: 'POST', headers: { Authorization: `Bearer ${bt}`, 'X-Device-Id': 'buyer-device-1' }, body: bad });
  assert(badRes.status === 400, 'fake png rejected');
  log('✔ disguised file rejected by magic-byte check');
  // declare payment
  const paid = await call('POST', `/p2p/orders/${order.id}/declare-payment`, { bankCode: 'OPTIMA', ownAccountConfirmed: true, exactAmountConfirmed: true, nameAndBankConfirmed: true, receiptFileId: up.id }, bt);
  assert(paid.status === 'PAID', 'order paid');
  log('✔ payment declared, status', paid.status);
  // name check helper
  const nc = await call('POST', `/p2p/orders/${order.id}/check-sender`, { observedName: 'Бекжан Абдыкадыров' }, st);
  assert(nc.matches === true, 'name match');
  const nc2 = await call('POST', `/p2p/orders/${order.id}/check-sender`, { observedName: 'Айжан Абдыкадырова' }, st);
  assert(nc2.matches === false, 'name mismatch');
  log('✔ sender name check: match/mismatch OK');
  // release
  const rel = await call('POST', `/p2p/orders/${order.id}/release`, { checkedBankApp: true, senderNameMatches: true, amountMatches: true }, st);
  let released = rel;
  if (rel.otpRequired) { log('  release requires OTP (risk/cooldown) → confirming with dev code'); released = await call('POST', `/p2p/orders/${order.id}/release`, { checkedBankApp: true, senderNameMatches: true, amountMatches: true, otpCode: rel.otp.devCode }, st); }
  assert(released.order.status === 'RELEASED', 'released');
  const me = await call('GET', '/me', null, bt);
  log('✔ escrow released; buyer balance =', me.balance.available, 'USDT');
  assert(Number(me.balance.available) > 500, 'buyer got USDT');
  await call('POST', `/p2p/orders/${order.id}/rate`, { stars: 5, comment: 'Быстро' }, bt);
  log('✔ rated seller');
  // withdrawal
  const q = await call('POST', '/wallet/withdrawals/quote', { network: 'TRON', amount: '100' }, bt);
  log('  quote ok=', q.ok, q.problems);
  const w = await call('POST', '/wallet/withdrawals', { network: 'TRON', address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: '100' }, bt, { 'X-Idempotency-Key': 'smoke-w-' + Date.now() });
  assert(w.otpRequired && w.otp.devCode, 'withdraw otp');
  const wc = await call('POST', `/wallet/withdrawals/${w.withdrawal.id}/confirm`, { code: w.otp.devCode }, bt);
  log('✔ withdrawal confirmed →', wc.withdrawal.status, '(risk', w.withdrawal.riskAction + ')');
  const me2 = await call('GET', '/me', null, bt);
  log('  balance after withdrawal lock: available', me2.balance.available, 'locked', me2.balance.locked);
  // admin
  const al = await call('POST', '/admin/auth/login', { email: 'admin@somex.kg', password: 'ChangeMe!2026' });
  assert(al.mfaRequired && al.mfaSetupRequired && al.setup.secret, 'admin mfa setup enforced');
  const code = authenticator.generate(al.setup.secret);
  const at = await call('POST', '/admin/auth/totp', { tmpToken: al.tmpToken, code });
  assert(at.accessToken, 'admin logged in');
  log('✔ admin login with enforced TOTP enrolment');
  const stats = await call('GET', '/admin/dashboard/stats', null, at.accessToken);
  log('  stats: users', stats.users.total, 'escrow', stats.money.escrowLocked, 'fees', stats.money.feesCollected, 'queues', JSON.stringify(stats.queues));
  const users = await call('GET', '/admin/users?q=' + encodeURIComponent(BUYER_PHONE), null, at.accessToken);
  assert(users.items.length === 1, 'user search');
  const detail = await call('GET', `/admin/users/${users.items[0].id}`, null, at.accessToken);
  log('  user detail: risk', detail.riskScore, 'orders', detail.orders.length, 'riskEvents', detail.riskEvents.length, 'devices', detail.devices.length);
  const orders = await call('GET', '/admin/p2p/orders', null, at.accessToken);
  const od = await call('GET', `/admin/p2p/orders/${orders.items[0].id}`, null, at.accessToken);
  log('  admin order view: events', od.events.length, 'messages', od.messages.length, 'payment.accountNumber visible:', !!od.payment.accountNumber);
  const av = await call('GET', '/admin/audit/verify', null, at.accessToken);
  assert(av.ok, 'audit chain ok');
  log('✔ audit hash chain verified over', av.checked, 'rows');
  const rec = await call('GET', '/admin/wallet/reconcile', null, at.accessToken);
  assert(rec.ok, 'ledger reconciles ' + JSON.stringify(rec).slice(0, 300));
  log('✔ ledger reconciliation ok: userLiabilities', rec.userLiabilities, 'platform', JSON.stringify(rec.platform));
  const settings = await call('GET', '/admin/settings', null, at.accessToken);
  log('  settings groups', Object.keys(settings.groups).length, 'items', settings.items.length);
  await call('PUT', '/admin/settings', { values: { 'wappi.token': 'test-token-1234', 'risk.review_threshold': '45' } }, at.accessToken);
  const s2 = await call('GET', '/admin/settings', null, at.accessToken);
  const tok = s2.items.find((i) => i.key === 'wappi.token');
  assert(tok.value.startsWith('••••') && tok.value.endsWith('1234'), 'secret masked');
  log('✔ settings saved; secret masked as', tok.value);
  await call('PUT', '/admin/settings', { values: { 'wappi.token': '' } }, at.accessToken);
  const test = await call('POST', '/admin/settings/test/clamav', {}, at.accessToken);
  log('  clamav test:', JSON.stringify(test).slice(0, 120));
  const sim = await call('POST', '/admin/dev/simulate-deposit', { userId: users.items[0].id, amount: '250' }, at.accessToken);
  log('✔ simulated deposit →', sim.status, sim.amount);
  // viewer role restrictions
  const vl = await call('POST', '/admin/auth/login', { email: 'support@somex.kg', password: 'ChangeMe!2026' });
  const vcode = authenticator.generate(vl.setup.secret);
  const vt = await call('POST', '/admin/auth/totp', { tmpToken: vl.tmpToken, code: vcode });
  await call('GET', '/admin/settings', null, vt.accessToken).then(() => assert(false, 'support cannot read settings')).catch((e) => assert(/403/.test(e.message), 'RBAC works'));
  log('✔ RBAC: SUPPORT denied on settings');
  // refresh is bound to the device that logged in: another device fingerprint is rejected
  await call('POST', '/auth/refresh', { refreshToken: seller.refreshToken }, null, { device: 'stolen-device-9' }).then(() => assert(false, 'device mismatch')).catch((e) => assert(/401/.test(e.message), 'device-bound refresh rejected: ' + e.message));
  log('✔ refresh token bound to the login device (mismatch -> session revoked)');
  // refresh rotation + reuse detection
  const r1 = await call('POST', '/auth/refresh', { refreshToken: buyer.refreshToken }, null, { device: buyer.device });
  await call('POST', '/auth/refresh', { refreshToken: buyer.refreshToken }, null, { device: buyer.device }).then(() => assert(false, 'reuse')).catch((e) => assert(/401/.test(e.message), 'reuse detected'));
  await call('GET', '/me', null, r1.accessToken).then(() => assert(false, 'family revoked')).catch((e) => assert(/401/.test(e.message), 'family revoked after reuse'));
  log('✔ refresh rotation + reuse detection revokes the family');
  await new Promise((r) => setTimeout(r, 12000));
  const ws = await call('GET', '/wallet/withdrawals', null, buyer.accessToken).catch(() => null);
  const wlist = await call('GET', '/admin/withdrawals', null, at.accessToken);
  log('  withdrawal processor status:', wlist.items[0].status, wlist.items[0].txHash);
  log('\nALL SMOKE CHECKS PASSED');
})().catch((e) => { console.error('SMOKE FAILED:', e.message); process.exit(1); });
