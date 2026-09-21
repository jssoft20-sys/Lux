import { get, post, put } from '../api.js';
import { el, esc, fmt, svg, toast, bindCopy, phoneInput, normalizeDigits } from '/js/ui.js';
import { state } from '../app.js';

const SECTIONS = [['company', 'Компания'], ['site', 'Сайт'], ['rates', 'Курсы'], ['optima', 'Optima ELQR'], ['crypto', 'USDT'], ['mail', 'Почта'], ['whatsapp', 'WhatsApp'], ['security', 'Безопасность']];
const field = (label, name, value, { type = 'text', ph = '', full = false, hint = '' } = {}) => `<div class="field ${full ? 'full' : ''}"><label>${label}</label><input class="input" name="${name}" type="${type}" value="${esc(value ?? '')}" placeholder="${esc(ph)}" ${type === 'password' ? 'autocomplete="new-password"' : ''}>${hint ? `<div class="note">${hint}</div>` : ''}</div>`;
const toggle = (label, name, on, sub = '') => `<label class="switch"><div><b>${label}</b>${sub ? `<span>${sub}</span>` : ''}</div><div class="toggle ${on ? 'on' : ''}" data-toggle="${name}"></div></label>`;
const check = (lc) => lc ? `<div class="result ${lc.ok ? 'ok' : 'bad'}">${esc(lc.message)} <small class="dim">· ${esc(fmt.dt(lc.at))}</small></div>` : '';

export default async function settings({ params, navigate }) {
  let data = await get('/api/admin/settings');
  let section = params[0] && SECTIONS.some(([k]) => k === params[0]) ? params[0] : 'company';
  const view = el(`<div class="view"><div class="admin-head"><h1>Настройки</h1></div><div class="tabs" id="tabs"></div><div id="body"></div></div>`);
  const body = view.querySelector('#body');
  const s = () => data.settings;

  function collect(root) {
    const out = {};
    root.querySelectorAll('[name]').forEach((i) => { if (i.type === 'number') out[i.name] = i.value === '' ? '' : Number(i.value); else out[i.name] = i.value; });
    root.querySelectorAll('[data-toggle]').forEach((t) => { out[t.dataset.toggle] = t.classList.contains('on'); });
    return out;
  }
  function bindToggles(root) { root.querySelectorAll('[data-toggle]').forEach((t) => t.addEventListener('click', () => t.classList.toggle('on'))); }
  async function save(sec, patch, msg = 'Сохранено') {
    try { const r = await put(`/api/admin/settings/${sec}`, patch); data.settings = r.settings; toast(msg, 'ok'); return true; } catch (err) { toast(err.message, 'error', 5000); return false; }
  }

  const renderers = {
    company() {
      const c = s().company;
      body.innerHTML = `<div class="panel"><div class="form-grid">${field('Название', 'name', c.name)}${field('Телефон', 'phone', c.phone, { ph: '+996 555 000 000' })}${field('WhatsApp (номер)', 'whatsapp', c.whatsapp, { ph: '996555000000' })}${field('Адрес', 'address', c.address, { full: true })}${field('Режим работы', 'hours', c.hours)}${field('Instagram', 'instagram', c.instagram, { ph: 'luxar_autorent' })}${field('Telegram', 'telegram', c.telegram, { ph: 'username' })}</div><button class="btn primary" id="save">Сохранить</button></div>`;
      body.querySelector('#save').addEventListener('click', () => save('company', collect(body)));
    },
    site() {
      const t = s().site;
      body.innerHTML = `<div class="panel"><div class="form-grid">
        ${field('Публичный адрес сайта', 'baseUrl', t.baseUrl, { full: true, ph: 'http://1.2.3.4:7088', hint: 'Используется в ссылках в сообщениях. Пусто — определяется автоматически по адресу, с которого открывают сайт.' })}
        ${field('Часовой пояс', 'timezone', t.timezone)}${field('Символ валюты', 'currencySymbol', t.currencySymbol)}
        ${field('Начало работы', 'workStart', t.workStart, { type: 'time' })}${field('Конец работы', 'workEnd', t.workEnd, { type: 'time' })}${field('Шаг времени, мин', 'timeStepMinutes', t.timeStepMinutes, { type: 'number' })}
        ${field('Мин. срок, дней', 'minDays', t.minDays, { type: 'number' })}${field('Макс. срок, дней', 'maxDays', t.maxDays, { type: 'number' })}${field('Холд без оплаты, мин', 'holdMinutes', t.holdMinutes, { type: 'number', hint: 'Сколько минут машина удерживается за клиентом до оплаты' })}
        ${field('Стоимость доставки, $', 'deliveryFeeUsd', t.deliveryFeeUsd, { type: 'number' })}
        <div class="field full"><label>Условия аренды (по строке)</label><textarea class="textarea" name="conditions">${esc((t.conditions || []).join('\n'))}</textarea></div>
      </div>${toggle('Доставка автомобиля', 'deliveryEnabled', t.deliveryEnabled)}${toggle('Продление онлайн', 'extendEnabled', t.extendEnabled !== false, 'Клиент продлевает и оплачивает сам по ссылке')}<button class="btn primary" id="save">Сохранить</button></div>`;
      bindToggles(body);
      body.querySelector('#save').addEventListener('click', () => save('site', collect(body)));
    },
    rates() {
      const r = s().rates;
      body.innerHTML = `<div class="panel"><p class="help">Цены на сайте в долларах. По курсам считаются суммы к оплате в сомах (ELQR) и USDT.</p><div class="form-grid">${field('1 $ = сом', 'kgsPerUsd', r.kgsPerUsd, { type: 'number' })}${field('1 $ = USDT', 'usdtPerUsd', r.usdtPerUsd, { type: 'number' })}</div>
        <div class="panel" style="padding:6px 16px;margin-bottom:14px" id="preview"></div>
        <button class="btn primary" id="save">Сохранить</button>${r.updatedAt ? `<div class="note mt">Обновлено ${esc(fmt.dt(r.updatedAt))}</div>` : ''}</div>`;
      const prev = () => { const v = collect(body); body.querySelector('#preview').innerHTML = [100, 250].map((usd) => `<div class="kv"><span>$${usd}</span><b>${fmt.kgs(usd * v.kgsPerUsd)} · ${fmt.usdt(usd * v.usdtPerUsd)}</b></div>`).join(''); };
      body.querySelectorAll('input').forEach((i) => i.addEventListener('input', prev)); prev();
      body.querySelector('#save').addEventListener('click', () => save('rates', collect(body), 'Курсы обновлены'));
    },
    optima() {
      const o = s().optima;
      const cb = `${(s().site.baseUrl || location.origin).replace(/\/$/, '')}/api/v1/callback`;
      body.innerHTML = `<div class="panel">
        <p class="help">Достаточно ID компании и API-ключа из интернет-банка Optima Business (категория «Генерация QR» + «Статус QR-платежа»). Торговая точка и касса определяются автоматически.</p>
        ${toggle('Приём оплат ELQR', 'enabled', o.enabled, 'Показывать способ «ELQR · любой банк» на сайте')}
        <div class="form-grid">${field('ID компании (legalPartyId)', 'legalPartyId', o.legalPartyId, { ph: '248' })}${field('API-ключ', 'apiKey', o.apiKey, { type: 'password', ph: o.hasApiKey ? 'сохранён' : 'вставьте ключ' })}${field('Срок жизни QR, мин', 'qrTtlMinutes', o.qrTtlMinutes, { type: 'number' })}</div>
        <div class="btn-row"><button class="btn primary" id="save">Сохранить</button><button class="btn secondary" id="check">Проверить и найти точку</button></div>
        ${check(o.lastCheck)}
        ${o.salePointName ? `<div class="result ok">Торговая точка: ${esc(o.salePointName)} · код ${esc(o.salePointCode)} / касса ${esc(o.cashCode)}${o.account ? ' · счёт ' + esc(o.account) : ''}</div>` : ''}
        ${(o.salePoints || []).length > 1 ? `<div class="radio-list mt"><label style="font-size:13px;color:var(--text-2);font-weight:700">Выбрать другую точку</label>${o.salePoints.map((p) => `<div class="switch ${String(p.salePointCode) === String(o.salePointCode) && String(p.cashCode) === String(o.cashCode) ? 'active' : ''}" data-sp="${p.salePointCode}" data-cash="${p.cashCode}"><div><b>${esc(p.salePointName || 'Точка ' + p.salePointCode)} · ${esc(p.cashName || 'касса ' + p.cashCode)}</b><span>${esc(p.address || '')} · счёт ${esc(p.account)}</span></div></div>`).join('')}</div>` : ''}
      </div>
      <div class="panel mt"><b>Callback от банка (необязательно)</b><p class="help" style="margin-top:6px">Статусы оплат проверяются автоматически опросом каждые 4 секунды. Callback ускоряет подтверждение, но банк требует HTTPS-адрес. Если у сайта появится домен с сертификатом — укажите в банке этот URL и логин/пароль.</p>
        <div class="copy-field"><div class="txt"><small>URL для банка</small>${esc(cb)}</div><button data-copy="${esc(cb)}">Копировать</button></div>
        <div class="form-grid mt">${field('Логин callback', 'callbackLogin', o.callbackLogin)}${field('Пароль callback', 'callbackPassword', o.callbackPassword, { type: 'password' })}</div>
        <button class="btn secondary sm" id="saveCb">Сохранить</button></div>`;
      bindToggles(body); bindCopy(body);
      const main = () => { const v = collect(body); return { enabled: v.enabled, legalPartyId: v.legalPartyId, apiKey: v.apiKey, qrTtlMinutes: v.qrTtlMinutes }; };
      body.querySelector('#save').addEventListener('click', async () => { if (await save('optima', main())) render(); });
      body.querySelector('#saveCb').addEventListener('click', async () => { const v = collect(body); await save('optima', { callbackLogin: v.callbackLogin, callbackPassword: v.callbackPassword }); });
      body.querySelector('#check').addEventListener('click', async () => { const btn = body.querySelector('#check'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; try { const v = main(); const r = await post('/api/admin/settings/optima/check', { legalPartyId: v.legalPartyId, apiKey: v.apiKey }); data.settings = r.settings; toast(r.selected ? 'Точка найдена и выбрана' : 'Подключение работает, точек нет', r.selected ? 'ok' : 'error', 4000); } catch (err) { data = await get('/api/admin/settings'); toast(err.message, 'error', 6000); } render(); });
      body.querySelectorAll('[data-sp]').forEach((x) => x.addEventListener('click', async () => { try { const r = await put('/api/admin/settings/optima/select', { salePointCode: x.dataset.sp, cashCode: x.dataset.cash }); data.settings = r.settings; toast('Точка выбрана', 'ok'); render(); } catch (err) { toast(err.message, 'error'); } }));
    },
    crypto() {
      const c = s().crypto;
      body.innerHTML = `<div class="panel">
        ${toggle('Приём USDT', 'enabled', c.enabled, 'Показывать способ «USDT» на сайте')}
        <p class="help">Вставьте адреса кошельков из Binance (Пополнение → USDT → сеть). Включите только те сети, где есть адрес. Клиент видит адрес, QR и точную сумму.</p>
        <div id="nets">${(c.networks || []).map((n, i) => `<div class="panel" style="padding:12px 14px;margin-bottom:8px"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px"><b>${esc(n.label || n.id)}</b><div class="toggle ${n.enabled ? 'on' : ''}" data-net-toggle="${i}"></div></div><input class="input mono" data-net-addr="${i}" value="${esc(n.address)}" placeholder="Адрес ${esc(n.id)}" style="height:48px;font-size:14px"><input class="input" data-net-memo="${i}" value="${esc(n.memo || '')}" placeholder="Memo / Tag (если нужен)" style="height:44px;font-size:14px;margin-top:6px"></div>`).join('')}</div>
        <div class="form-grid">${field('Binance Pay ID (необязательно)', 'binancePayId', c.binancePayId, { hint: 'Перевод внутри Binance без комиссии. Показывается клиенту рядом с адресом.' })}${field('Окно оплаты, мин', 'paymentWindowMinutes', c.paymentWindowMinutes, { type: 'number' })}</div>
        ${toggle('Уникальные копейки', 'uniqueCents', c.uniqueCents, 'К сумме добавляются копейки, чтобы платёж определялся по письму автоматически')}
        ${toggle('Автоподтверждение по письму Binance', 'autoConfirmByEmail', c.autoConfirmByEmail !== false, 'Требует настроенной почты (IMAP)')}
        <button class="btn primary" id="save">Сохранить</button></div>`;
      bindToggles(body); body.querySelectorAll('[data-net-toggle]').forEach((t) => t.addEventListener('click', () => t.classList.toggle('on')));
      body.querySelector('#save').addEventListener('click', async () => {
        const v = collect(body);
        const networks = (c.networks || []).map((n, i) => ({ id: n.id, label: n.label, address: body.querySelector(`[data-net-addr="${i}"]`).value.trim(), memo: body.querySelector(`[data-net-memo="${i}"]`).value.trim(), enabled: body.querySelector(`[data-net-toggle="${i}"]`).classList.contains('on') }));
        const bad = networks.find((n) => n.enabled && !n.address);
        if (bad) return toast(`Укажите адрес для ${bad.label}`, 'error');
        await save('crypto', { enabled: v.enabled, binancePayId: v.binancePayId, paymentWindowMinutes: v.paymentWindowMinutes, uniqueCents: v.uniqueCents, autoConfirmByEmail: v.autoConfirmByEmail, networks });
      });
    },
    mail() {
      const m = s().mail; const presets = data.presets;
      body.innerHTML = `<div class="panel">
        ${toggle('Почта включена', 'enabled', m.enabled, 'Отправка писем и проверка поступлений USDT по уведомлениям Binance')}
        <div class="field"><label>Почтовый сервис</label><div class="select-wrap"><select class="select" name="preset">${Object.entries(presets).map(([k, p]) => `<option value="${k}" ${m.preset === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></div><div class="note" id="hint">${esc((presets[m.preset] || {}).hint || '')}</div></div>
        <div class="form-grid">${field('Почта', 'email', m.email, { ph: 'name@gmail.com' })}${field('Пароль (пароль приложения)', 'password', m.password, { type: 'password', ph: m.hasPassword ? 'сохранён' : '' })}${field('Email для уведомлений админу', 'adminEmail', m.adminEmail)}${field('Имя отправителя', 'fromName', m.fromName)}</div>
        <div class="form-grid">${field('IMAP сервер', 'imapHost', m.imapHost)}${field('IMAP порт', 'imapPort', m.imapPort, { type: 'number' })}${field('SMTP сервер', 'smtpHost', m.smtpHost)}${field('SMTP порт', 'smtpPort', m.smtpPort, { type: 'number' })}${field('Папка', 'folder', m.folder)}${field('Фильтр отправителя', 'senderFilter', m.senderFilter, { hint: 'Часть адреса отправителя писем о пополнении, например binance' })}${field('Проверять каждые, сек', 'pollSeconds', m.pollSeconds, { type: 'number' })}</div>
        <div class="btn-row"><button class="btn primary" id="save">Сохранить</button><button class="btn secondary" id="smtp">Тест SMTP</button><button class="btn secondary" id="imap">Тест IMAP</button></div>
        ${check(m.lastCheck)}
        <p class="help mt">В Binance включите уведомления на почту о пополнениях (Настройки → Уведомления → Депозит). Письмо с суммой USDT автоматически подтверждает оплату клиента.</p></div>`;
      bindToggles(body);
      const presetSel = body.querySelector('[name=preset]');
      presetSel.addEventListener('change', () => { const p = presets[presetSel.value]; if (p) { if (presetSel.value !== 'custom') { body.querySelector('[name=imapHost]').value = p.imapHost; body.querySelector('[name=smtpHost]').value = p.smtpHost; body.querySelector('[name=imapPort]').value = p.imapPort; body.querySelector('[name=smtpPort]').value = p.smtpPort; } body.querySelector('#hint').textContent = p.hint; } });
      body.querySelector('#save').addEventListener('click', () => save('mail', collect(body)));
      const test = (kind) => async () => { const btn = body.querySelector('#' + kind); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; try { const r = await post(`/api/admin/settings/mail/test-${kind}`, collect(body)); toast(r.message, 'ok', 6000); } catch (err) { toast(err.message, 'error', 8000); } data = await get('/api/admin/settings'); render(); };
      body.querySelector('#smtp').addEventListener('click', test('smtp')); body.querySelector('#imap').addEventListener('click', test('imap'));
    },
    whatsapp() {
      const w = s().whatsapp; const t = w.templates || {};
      const vars = '{code} {car} {name} {phone} {start} {end} {endTime} {days} {pickup} {total} {amount} {method} {link} {adminLink} {hours}';
      body.innerHTML = `<div class="panel">
        ${toggle('WhatsApp включён', 'enabled', w.enabled, 'Через wappi.pro: подтверждения клиентам, напоминания о продлении, уведомления вам')}
        <div class="form-grid">${field('Profile ID', 'profileId', w.profileId)}${field('API токен', 'token', w.token, { type: 'password', ph: w.hasToken ? 'сохранён' : '' })}${field('Ваш номер для уведомлений', 'adminPhone', w.adminPhone, { ph: '996555000000' })}${field('Напоминать за, часов', 'reminderHours', w.reminderHours, { type: 'number', hint: 'За сколько часов до конца аренды клиенту уходит ссылка на продление' })}</div>
        ${toggle('Уведомлять клиента', 'notifyClient', w.notifyClient !== false)}${toggle('Уведомлять администратора', 'notifyAdmin', w.notifyAdmin !== false)}
        <div class="btn-row"><button class="btn primary" id="save">Сохранить</button><button class="btn secondary" id="status">Проверить</button><button class="btn secondary" id="test">Тест на мой номер</button></div>
        ${check(w.lastCheck)}
        <p class="help mt">В кабинете wappi.pro создайте профиль, отсканируйте QR с телефона компании и скопируйте Profile ID и токен.</p></div>
        <div class="panel mt"><b>Шаблоны сообщений</b><div class="hint-vars mt">${vars.split(' ').map((v) => `<code>${v}</code>`).join('')}</div>
        ${[['bookingConfirmed', 'Клиенту: бронь подтверждена'], ['reminder', 'Клиенту: напоминание + ссылка на продление'], ['extensionConfirmed', 'Клиенту: продление подтверждено'], ['adminNewBooking', 'Вам: новая бронь'], ['adminExtension', 'Вам: продление'], ['adminPaymentCheck', 'Вам: клиент сообщил об оплате USDT'], ['adminEndingSoon', 'Вам: скоро окончание аренды']].map(([k, l]) => `<div class="field"><label>${l}</label><textarea class="textarea" data-tpl="${k}">${esc(t[k] || '')}</textarea></div>`).join('')}
        <button class="btn secondary sm" id="saveTpl">Сохранить шаблоны</button></div>`;
      bindToggles(body);
      body.querySelector('#save').addEventListener('click', () => save('whatsapp', collect(body)));
      body.querySelector('#saveTpl').addEventListener('click', () => { const templates = {}; body.querySelectorAll('[data-tpl]').forEach((x) => { templates[x.dataset.tpl] = x.value; }); save('whatsapp', { templates }, 'Шаблоны сохранены'); });
      body.querySelector('#status').addEventListener('click', async () => { try { const r = await post('/api/admin/settings/whatsapp/status', collect(body)); toast(r.message, r.ok ? 'ok' : 'error', 6000); } catch (err) { toast(err.message, 'error', 6000); } data = await get('/api/admin/settings'); render(); });
      body.querySelector('#test').addEventListener('click', async () => { try { await save('whatsapp', collect(body)); const r = await post('/api/admin/settings/whatsapp/test', {}); toast(r.message, 'ok', 5000); } catch (err) { toast(err.message, 'error', 6000); } });
    },
    security() {
      body.innerHTML = `<div class="panel"><div class="form-grid">${field('Логин', 'newLogin', data.admin.login)}${field('Текущий пароль', 'currentPassword', '', { type: 'password' })}${field('Новый пароль (мин. 8 символов)', 'newPassword', '', { type: 'password' })}</div><button class="btn primary" id="save">Изменить</button><p class="help mt">Сессия в браузере хранится год и не слетает. Выйти можно в меню слева (на компьютере) — после смены пароля другие устройства нужно будет авторизовать заново.</p></div>`;
      body.querySelector('#save').addEventListener('click', async () => { const v = collect(body); try { await post('/api/admin/settings/security', v); toast('Пароль изменён', 'ok'); data = await get('/api/admin/settings'); render(); } catch (err) { toast(err.message, 'error', 5000); } });
    },
  };
  function render() {
    view.querySelector('#tabs').innerHTML = SECTIONS.map(([k, l]) => `<button class="chip ${section === k ? 'active' : ''}" data-s="${k}">${l}</button>`).join('');
    view.querySelectorAll('#tabs .chip').forEach((b) => b.addEventListener('click', () => { section = b.dataset.s; history.replaceState({}, '', '/admin/settings/' + section); render(); }));
    renderers[section]();
  }
  render();
  return view;
}
