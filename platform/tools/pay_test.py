#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Оплата брони: путь денег от QR до запуска поиска машины.

Выпуск кода делает банк, и снаружи его не подделать. Но всё остальное —
приём уведомления, сверка суммы, защита от повтора, переход заказа в поиск —
обязано работать и без банка. Здесь мы играем за банк сами: кладём выпущенный
код в базу и стучимся в наш же обработчик так, как это делает Оптима.

Запуск:  python3 tools/pay_test.py
"""
import base64, json, os, shutil, signal, subprocess, sys, tempfile, time
import urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('TEST_PORT', '7151'))
API = f'http://127.0.0.1:{PORT}/api/v1'

ok_count = 0
fail = []


def check(name, cond, detail=''):
    global ok_count
    if cond:
        ok_count += 1
        print(f'  \033[32m✓\033[0m {name}')
    else:
        fail.append((name, detail))
        print(f'  \033[31m✗\033[0m {name}' + (f'  — {detail}' if detail else ''))
    return bool(cond)


def req(method, path, body=None, headers=None, timeout=20):
    url = path if path.startswith('http') else API + path
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            text = resp.read().decode('utf-8')
            return resp.status, (json.loads(text) if text else {})
    except urllib.error.HTTPError as e:
        text = e.read().decode('utf-8', 'replace')
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, {'raw': text[:300]}
    except Exception as e:
        return 0, {'raw': str(e)[:200]}


def basic(login, password):
    raw = f'{login}:{password}'.encode('utf-8')
    return {'Authorization': 'Basic ' + base64.b64encode(raw).decode('ascii')}


def main():
    print('\n\033[1mОплата брони: уведомление банка\033[0m')
    data_dir = tempfile.mkdtemp(prefix='sg-pay-')
    env = dict(os.environ, SG_DATA=data_dir, PORT=str(PORT),
               SG_ADMIN_EMAIL='admin@test.kg', SG_ADMIN_PASSWORD='admin12345')
    log = open(os.path.join(data_dir, 'server.log'), 'w+')
    proc = subprocess.Popen([sys.executable, 'app.py'], cwd=ROOT, env=env,
                            stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            time.sleep(0.4)
            if req('GET', '/config', timeout=2)[0] == 200:
                break
        else:
            log.seek(0)
            print('\033[31mСервер не поднялся\033[0m\n' + log.read()[-2000:])
            return 1

        sys.path.insert(0, ROOT)
        from server import db, payments                    # noqa: E402
        db.init(os.path.join(data_dir, 'sprintergo.sqlite3'))

        # Настройки меняем только через админку. Записать их прямо в базу нельзя:
        # у работающего сервера свой кэш настроек, и он о правке не узнает — на
        # этом прогон уже спотыкался и показывал несуществующую поломку.
        code, login = req('POST', '/auth/login',
                          {'email': 'admin@test.kg', 'password': 'admin12345'})
        atoken = (login or {}).get('token')
        if not check('админ вошёл', bool(atoken), str(login)[:200]):
            return 1
        adm = {'Authorization': 'Bearer ' + atoken}
        code, saved = req('PUT', '/admin/pay/settings',
                          {'key': 'ключ-для-прогона', 'company': '248',
                           'provider': 'optima', 'enabled': True,
                           'sale_point': 1, 'cash': 1, 'generate_callback': True}, adm)
        creds = (saved or {}).get('callback') or {}
        login_name, password = creds.get('login'), creds.get('password')
        check('реквизиты сохранены, пароль для банка выдан',
              code == 200 and bool(login_name and password), f'код {code}: {str(saved)[:220]}')
        check('адрес обработчика подсказан целиком',
              '/pay/callback' in str(creds.get('url') or ''), str(creds.get('url'))[:120])
        code, again = req('GET', '/admin/pay/settings', None, adm)
        check('настройки оплаты читаются админом', code == 200, f'код {code}: {str(again)[:160]}')
        check('пароль показан ровно один раз',
              'password' not in json.dumps(again, ensure_ascii=False)
              or str(password) not in json.dumps(again, ensure_ascii=False),
              str(again)[:200])
        if not (login_name and password):
            log.seek(0)
            tail = log.read()
            i = tail.find('Traceback')
            print('\033[90m' + (tail[i:i + 1500] if i >= 0 else tail[-1500:]) + '\033[0m')
            return 1

        cfg = req('GET', '/config')[1]
        tid = (cfg.get('tariffs') or [{}])[0].get('id')
        pts = [{'addr': 'Чуй 100', 'lat': 42.8746, 'lng': 74.5698},
               {'addr': 'Ахунбаева 50', 'lat': 42.8380, 'lng': 74.6100}]
        code, order = req('POST', '/orders',
                          {'tariff_id': tid, 'phone': '0555000111', 'name': 'Бакыт',
                           'points': pts})
        pid = (order or {}).get('public_id')
        ttok = (order or {}).get('track_token')
        check('заказ создан при включённой оплате', code in (200, 201) and bool(pid),
              str(order)[:200])

        # Банк отсюда недоступен, поэтому код выпускаем сами — ровно такой,
        # какой положил бы в базу ответ Оптимы.
        row = db.row('SELECT * FROM orders WHERE public_id=?', (pid,))
        code, quoted = req('POST', '/price/quote', {'tariff_id': tid, 'points': pts})
        amount = int((quoted or {}).get('prepay') or 0)
        check('бронь посчитана и меньше заказа',
              0 < amount < int(row['price_total']),
              f"бронь {amount}, заказ {row['price_total']}")

        payments._ensure_schema()
        now = db.now()
        db.insert('payment_qr', {
            'transaction_id': '900900900', 'order_id': row['id'], 'public_id': pid,
            'provider': 'optima', 'amount': amount, 'status': 'pending',
            'qr_url': 'https://optimabank.kg/qr/900900900', 'qr_base64': None,
            'note': 'Бронь заказа ' + pid, 'sale_point': 1, 'cash': 1,
            'created_at': now, 'expires_at': now + 600, 'checked_at': 0, 'paid_amount': 0,
        })
        db.update('orders', {'payment_method': 'online', 'payment_status': 'pending',
                             'payment_id': '900900900'}, 'id=?', (row['id'],))

        body = {'status': 'PROCESSED', 'sum': round(amount / 100.0, 2),
                'note': 'Бронь заказа ' + pid, 'transactionId': '900900900',
                'transactionProcessedDateTime': payments.utc_stamp(),
                'payerClientType': ''}

        code, r = req('POST', '/pay/callback', body)
        check('без пароля банк не пускают', code == 401, f'код {code}')
        code, r = req('POST', '/pay/callback', body, basic(login_name, 'не-тот-пароль'))
        check('с чужим паролем не пускают', code == 401, f'код {code}')
        code, r = req('POST', '/pay/callback', dict(body, sum=1.0), basic(login_name, password))
        check('сумма не сошлась — оплату не засчитали', code == 400, f'код {code}: {str(r)[:160]}')

        code, r = req('POST', '/pay/callback', body, basic(login_name, password))
        check('уведомление принято', code == 200, f'код {code}: {str(r)[:200]}')
        check('в ответе есть то, что ждёт банк',
              isinstance(r, dict) and r.get('transactionId') == '900900900'
              and 'receivedAt' in r and 'message' in r, str(r)[:200])

        fresh = db.row('SELECT * FROM orders WHERE id=?', (row['id'],))
        check('заказ помечен оплаченным', fresh['payment_status'] == 'paid',
              str(fresh['payment_status']))
        check('зачли ровно бронь, не больше', int(fresh.get('paid_amount') or 0) == amount,
              f"зачтено {fresh.get('paid_amount')}, ждали {amount}")
        check('после оплаты заказ пошёл искать машину',
              fresh['status'] in ('searching', 'search', 'offered', 'assigned'),
              str(fresh['status']))

        code, r2 = req('POST', '/pay/callback', body, basic(login_name, password))
        check('повторное уведомление не платит дважды', code == 200, f'код {code}')
        again = db.row('SELECT * FROM orders WHERE id=?', (row['id'],))
        check('сумма после повтора та же', int(again.get('paid_amount') or 0) == amount,
              f"стало {again.get('paid_amount')}")
        paid_rows = db.rows("SELECT * FROM payment_qr WHERE transaction_id='900900900'")
        check('в журнале оплат одна запись, а не две', len(paid_rows) == 1, str(len(paid_rows)))

        code, st = req('GET', f'/pay/{pid}/status?t={ttok}')
        check('экран клиента видит «оплачено»',
              code == 200 and (st.get('paid') is True or st.get('status') == 'paid'),
              f'код {code}: {str(st)[:200]}')

        code, st = req('GET', '/pay/%s/status?t=%s'
                       % (pid, urllib.parse.quote('чужой-токен')))
        check('чужому состояние оплаты не показывают', code in (401, 403, 404), f'код {code}')

        # ── демо-оплата: владелец должен увидеть свой экран без банка ──────
        # Раньше одного переключателя не хватало: демо требовало вдобавок
        # включить приём брони и выбрать Оптиму, иначе клиент не видел ничего.
        print('\n\033[1mДемо-оплата\033[0m')
        code, off = req('PUT', '/admin/pay/settings',
                        {'enabled': False, 'provider': 'none', 'demo': True}, adm)
        check('демо включается одним переключателем', code == 200, f'код {code}: {str(off)[:160]}')
        code, back = req('GET', '/admin/pay/settings', None, adm)
        shown = ((back or {}).get('settings') or back or {})
        check('и не сбрасывается при перезагрузке страницы',
              code == 200 and shown.get('demo') is True, f'код {code}: {str(back)[:200]}')

        # Именно эта кнопка и есть «демо кр код»: владелец жмёт её в панели.
        code, demo = req('POST', '/admin/pay/demo', {}, adm)
        check('панель выпустила демо-код', code in (200, 201) and bool((demo or {}).get('qr_base64')),
              f'код {code}: {str(demo)[:180]}')
        pid2 = (demo or {}).get('public_id')
        tok2 = (demo or {}).get('token')

        if pid2 and tok2:
            code, qr = req('POST', f'/pay/{pid2}/qr', {'t': tok2})
            check('клиент по ссылке видит тот же код',
                  code in (200, 201) and bool((qr or {}).get('qr_base64')),
                  f'код {code}: {str(qr)[:160]}')
            check('и он помечен демонстрационным', (qr or {}).get('demo') is True, str(qr)[:200])
            check('транзакция демонстрационная, а не банковская',
                  str((qr or {}).get('transaction_id') or '').startswith('demo-'),
                  str((qr or {}).get('transaction_id')))

            code, st = req('GET', f'/pay/{pid2}/status?t={tok2}')
            check('состояние оплаты тоже знает про демо', (st or {}).get('demo') is True,
                  str(st)[:200])

            code, done = req('POST', '/admin/pay/demo/confirm',
                             {'public_id': pid2, 'comment': 'Демонстрация из прогона'}, adm)
            check('демо-оплату можно подтвердить из панели', code in (200, 201),
                  f'код {code}: {str(done)[:160]}')
            time.sleep(3)          # у состояния оплаты свой предел: раз в две секунды
            code, st = req('GET', f'/pay/{pid2}/status?t={tok2}')
            check('после подтверждения заказ считается оплаченным',
                  (st or {}).get('paid') is True or (st or {}).get('status') == 'paid',
                  str(st)[:200])

        # Настоящий заказ этой кнопкой оплаченным не объявишь.
        code, bad_try = req('POST', '/admin/pay/demo/confirm',
                            {'public_id': pid, 'comment': 'Демонстрация из прогона'}, adm)
        check('настоящий заказ кнопкой демо не оплатить', code == 403,
              f'код {code}: {str(bad_try)[:160]}')

    finally:
        log.seek(0)
        server_log = log.read()
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()

    tb = server_log.count('Traceback')
    check('в логе сервера нет исключений', tb == 0, f'найдено {tb}')
    if tb:
        i = server_log.find('Traceback')
        print('\033[90m' + server_log[i:i + 1200] + '\033[0m')

    print(f'\n\033[1mИтог:\033[0m пройдено {ok_count}, провалено {len(fail)}')
    for n, d in fail:
        print(f'  · {n}' + (f'\n      {d}' if d else ''))
    shutil.rmtree(data_dir, ignore_errors=True)
    return 1 if fail else 0


if __name__ == '__main__':
    sys.exit(main())
