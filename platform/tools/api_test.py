#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Приёмочный прогон API: полный путь заказа от создания до оценки.

Поднимает сервер на отдельном порту с чистой базой, проходит сценарий целиком
и печатает отчёт. Сетевые провайдеры (геокодер, маршрутизатор) могут быть
недоступны — это не считается провалом, сервис обязан работать и без них.

Запуск:  python3 tools/api_test.py
"""
import json, os, shutil, signal, subprocess, sys, tempfile, threading, time
import urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('TEST_PORT', '7099'))
BASE = f'http://127.0.0.1:{PORT}'
API = BASE + '/api/v1'

ok_count = 0
fail = []
warn = []


def check(name, cond, detail=''):
    global ok_count
    if cond:
        ok_count += 1
        print(f'  \033[32m✓\033[0m {name}')
    else:
        fail.append((name, detail))
        print(f'  \033[31m✗\033[0m {name}' + (f'  — {detail}' if detail else ''))
    return bool(cond)


def soft(name, cond, detail=''):
    """Мягкая проверка: зависит от внешнего сервиса, провалом не считается."""
    if cond:
        print(f'  \033[32m✓\033[0m {name}')
    else:
        warn.append((name, detail))
        print(f'  \033[33m~\033[0m {name}  — {detail or "внешний сервис недоступен"}')


def req(method, path, body=None, token=None, raw=False, timeout=25):
    url = path if path.startswith('http') else API + path
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            text = resp.read().decode('utf-8')
            return resp.status, (text if raw else (json.loads(text) if text else {}))
    except urllib.error.HTTPError as e:
        text = e.read().decode('utf-8', 'replace')
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, {'raw': text[:400]}
    except Exception as e:
        return 0, {'error': {'code': 'network', 'message': str(e)}}


def sse_collect(path, token, seconds, out):
    """Слушает поток событий и складывает их в список — так проверяем живые обновления."""
    url = API + path + (('&' if '?' in path else '?') + 'token=' + token if token else '')
    try:
        r = urllib.request.Request(url)
        r.add_header('Accept', 'text/event-stream')
        with urllib.request.urlopen(r, timeout=seconds + 5) as resp:
            deadline = time.time() + seconds
            event = None
            for raw_line in resp:
                line = raw_line.decode('utf-8', 'replace').rstrip('\n')
                if line.startswith('event:'):
                    event = line[6:].strip()
                elif line.startswith('data:') and event:
                    out.append((event, line[5:].strip()))
                    event = None
                if time.time() > deadline:
                    break
    except Exception as e:
        out.append(('__error__', str(e)))


# ─────────────────────────────────────────────────────────────── запуск сервера

def start_server():
    data_dir = tempfile.mkdtemp(prefix='sg-test-')
    env = dict(os.environ, PORT=str(PORT), SG_DB=os.path.join(data_dir, 'test.sqlite3'),
               SG_DATA=data_dir, PYTHONUNBUFFERED='1')
    log = open(os.path.join(data_dir, 'server.log'), 'w+')
    proc = subprocess.Popen([sys.executable, 'app.py'], cwd=ROOT, env=env,
                            stdout=log, stderr=subprocess.STDOUT)
    for _ in range(80):
        time.sleep(0.25)
        if proc.poll() is not None:
            log.seek(0)
            print('\033[31mСервер не поднялся:\033[0m\n' + log.read()[-3000:])
            sys.exit(1)
        try:
            code, _ = req('GET', '/config', timeout=2)
            if code == 200:
                return proc, data_dir, log
        except Exception:
            pass
    log.seek(0)
    print('\033[31mСервер не ответил за 20 секунд:\033[0m\n' + log.read()[-3000:])
    proc.kill()
    sys.exit(1)


def main():
    print('\n\033[1mПриёмочный прогон API Sprinter Go\033[0m')
    print('порт', PORT, '· чистая база\n')
    proc, data_dir, log = start_server()
    admin_pass = None
    try:
        log.seek(0)
        head = log.read()
        for line in head.split('\n'):
            if 'пароль' in line.lower() or 'password' in line.lower():
                parts = [p for p in line.replace(':', ' ').split() if len(p) >= 10]
                if parts:
                    admin_pass = parts[-1]

        # ── 1. конфигурация ──────────────────────────────────────────────────
        print('\033[1m1. Конфигурация\033[0m')
        code, cfg = req('GET', '/config')
        check('GET /config отвечает 200', code == 200, str(cfg)[:200])
        tariffs = cfg.get('tariffs') or []
        check('в конфиге есть тарифы', len(tariffs) >= 3, f'получено {len(tariffs)}')
        check('у тарифа есть оба языка',
              bool(tariffs) and tariffs[0].get('name_ru') and tariffs[0].get('name_ky'),
              str(tariffs[:1])[:200])
        extras = cfg.get('extras') or []
        check('в конфиге есть допуслуги', len(extras) >= 3, f'получено {len(extras)}')
        check('настройки карты отданы', bool((cfg.get('map') or {}).get('tiles_dark')))
        check('секреты не утекают в /config',
              'secret' not in json.dumps(cfg).lower() and 'smtp' not in json.dumps(cfg).lower())

        # ── 2. география ─────────────────────────────────────────────────────
        print('\n\033[1m2. География\033[0m')
        code, sg = req('POST', '/geo/suggest', {'q': 'Чуй', 'lat': 42.87, 'lng': 74.59})
        soft('подсказки адресов', code == 200 and isinstance(sg, (list, dict)), f'код {code}')
        pts = [[42.8746, 74.5698], [42.8380, 74.6100]]
        code, rt = req('POST', '/geo/route', {'points': pts})
        check('расчёт маршрута отвечает', code == 200, str(rt)[:200])
        dist = (rt or {}).get('distance_m') or 0
        check('расстояние правдоподобное (2–15 км)', 2000 < dist < 15000, f'{dist} м')

        # ── 3. расчёт цены ───────────────────────────────────────────────────
        print('\n\033[1m3. Расчёт цены\033[0m')
        tid = tariffs[1]['id'] if len(tariffs) > 1 else tariffs[0]['id']
        quote_body = {'tariff_id': tid, 'points': pts, 'loaders': 2,
                      'extras': [{'code': 'floor', 'qty': 3}]}
        code, q = req('POST', '/price/quote', quote_body)
        check('POST /price/quote отвечает 200', code == 200, str(q)[:250])
        total = (q or {}).get('total') or 0
        check('итог больше нуля', total > 0, str(q)[:200])
        check('итог — целое число тыйынов', isinstance(total, int), f'тип {type(total).__name__}')
        check('комиссия посчитана', isinstance((q or {}).get('commission'), int))
        check('есть разбивка по позициям', bool((q or {}).get('breakdown')))
        code, q2 = req('POST', '/price/quote', dict(quote_body, loaders=4))
        check('больше грузчиков — дороже', (q2 or {}).get('total', 0) > total,
              f'{total} → {(q2 or {}).get("total")}')

        # ── 4. курьер: регистрация и вход ────────────────────────────────────
        print('\n\033[1m4. Курьер\033[0m')
        cour = {'email': 'talgat@test.kg', 'password': 'sprinter2026', 'name': 'Талгат Осмонов',
                'phone': '0700112233', 'car_model': 'Mercedes Sprinter', 'car_plate': '01KG762ATN',
                'car_color': 'белый', 'vehicle_class': tariffs[1].get('vehicle_class', 'van'),
                'capacity_kg': 1500}
        code, reg = req('POST', '/auth/register', cour)
        check('регистрация курьера принята', code in (200, 201), str(reg)[:250])
        code, login = req('POST', '/auth/login', {'email': cour['email'], 'password': cour['password']})
        moderation = code != 200
        if moderation:
            check('до проверки вход закрыт с понятной ошибкой',
                  (login.get('error') or {}).get('code') in ('moderation', 'forbidden'), str(login)[:200])

        # админ одобряет
        code, alog = req('POST', '/auth/login', {'email': 'admin@sprintergo.kg', 'password': admin_pass or ''})
        if code != 200:
            # пароль не выловили из лога — создаём админа напрямую через seed
            subprocess.run([sys.executable, 'tools/mkadmin.py', 'admin@test.kg', 'admin12345'],
                           cwd=ROOT, env=dict(os.environ, SG_DB=os.path.join(data_dir, 'test.sqlite3')),
                           capture_output=True)
            code, alog = req('POST', '/auth/login', {'email': 'admin@test.kg', 'password': 'admin12345'})
        atoken = (alog or {}).get('token')
        check('админ вошёл', bool(atoken), str(alog)[:200])

        if atoken:
            code, lst = req('GET', '/admin/couriers', token=atoken)
            check('список курьеров доступен админу', code == 200, str(lst)[:200])
            items = lst.get('items') if isinstance(lst, dict) else lst
            cid = (items or [{}])[0].get('id') or (items or [{}])[0].get('user_id')
            if cid:
                code, _ = req('PATCH', f'/admin/couriers/{cid}', {'status': 'active'}, token=atoken)
                check('курьер одобрен', code == 200)

        code, login = req('POST', '/auth/login', {'email': cour['email'], 'password': cour['password']})
        ctoken = (login or {}).get('token')
        check('курьер вошёл после одобрения', bool(ctoken), str(login)[:200])
        code, bad_login = req('POST', '/auth/login', {'email': cour['email'], 'password': 'неверный'})
        check('неверный пароль отклонён', code in (400, 401), f'код {code}')

        # Проверка документов: без неё диспетчер заказы не даёт — это by design.
        if ctoken:
            # крошечный настоящий jpeg, чтобы проверить и разбор, и сохранение файла
            tiny = ('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL'
                    'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB'
                    'AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==')
            code, vr = req('POST', '/courier/verify', {'photo': tiny}, token=ctoken)
            check('фото на проверку принято', code in (200, 201), f'код {code}: ' + str(vr)[:160])
            code, vs = req('GET', '/courier/verify', token=ctoken)
            check('статус проверки — на рассмотрении',
                  (vs or {}).get('status') == 'pending', str(vs)[:160])

        if atoken:
            code, queue = req('GET', '/admin/verify', token=atoken)
            check('очередь проверки видна админу', code == 200, str(queue)[:160])
            items = queue.get('items') if isinstance(queue, dict) else queue
            uid = (items or [{}])[0].get('user_id') or (items or [{}])[0].get('id')
            if check('в очереди есть курьер', bool(uid), str(queue)[:200]):
                code, r = req('PATCH', f'/admin/verify/{uid}', {'status': 'approved'}, token=atoken)
                check('админ одобрил документы', code == 200, str(r)[:200])

        if ctoken:
            code, vs = req('GET', '/courier/verify', token=ctoken)
            check('курьер видит, что проверен', (vs or {}).get('status') == 'approved', str(vs)[:160])
            code, _ = req('POST', '/courier/online', {'online': True}, token=ctoken)
            check('курьер вышел на линию', code == 200)
            code, _ = req('POST', '/courier/geo',
                          {'lat': 42.8750, 'lng': 74.5700, 'heading': 90, 'speed': 0}, token=ctoken)
            check('геопозиция принята', code == 200)

        # ── 5. заказ целиком ─────────────────────────────────────────────────
        print('\n\033[1m5. Заказ\033[0m')
        order_body = {
            'tariff_id': tid, 'phone': '0555123456', 'name': 'Айбек',
            'loaders': 2, 'extras': [{'code': 'floor', 'qty': 3}],
            'points': [
                {'addr': 'Контур № 5, 1', 'lat': 42.8746, 'lng': 74.5698,
                 'entrance': '2', 'flat': '111', 'floor': '12', 'comment': 'Код калитки 4141'},
                {'addr': 'Ахматбека Суюмбаева, 49А', 'lat': 42.8380, 'lng': 74.6100,
                 'entrance': '2', 'floor': '7'},
            ],
            'comment': 'Хрупкий груз', 'price_total': 1,   # заведомо неверная цена
        }
        code, order = req('POST', '/orders', order_body)
        check('заказ создан', code in (200, 201), str(order)[:300])
        pid = (order.get('public_id') or (order.get('order') or {}).get('public_id')) if order else None
        ttok = order.get('track_token') if order else None
        check('выдан публичный номер заказа', bool(pid), str(order)[:200])
        check('выдан токен отслеживания', bool(ttok))
        o = order.get('order') or order
        check('цена клиента проигнорирована, посчитана своя',
              (o.get('price_total') or 0) > 1000, f'в заказе {o.get("price_total")}')

        if pid:
            code, got = req('GET', f'/orders/{pid}?t=' + urllib.parse.quote('подделанный-токен'))
            check('чужой токен отслеживания не пускает', code in (401, 403, 404), f'код {code}')
            code, got = req('GET', f'/orders/{pid}?t={ttok}')
            check('заказ читается по своему токену', code == 200, str(got)[:200])

        # курьер должен получить предложение
        events = []
        if ctoken:
            th = threading.Thread(target=sse_collect, args=('/courier/stream', ctoken, 8, events), daemon=True)
            th.start()
            time.sleep(6)
            offer_events = [e for e in events if e[0] == 'offer']
            check('курьер получил предложение по SSE', bool(offer_events),
                  f'события: {[e[0] for e in events][:6]}')

            offer_id = None
            for ev, payload in offer_events:
                try:
                    d = json.loads(payload)
                    offer_id = d.get('offer_id') or d.get('id') or (d.get('offer') or {}).get('id')
                    if offer_id:
                        break
                except ValueError:
                    pass
            if not offer_id:
                code, offers = req('GET', '/courier/offers', token=ctoken)
                items = offers.get('items') if isinstance(offers, dict) else offers
                offer_id = (items or [{}])[0].get('id') if items else None

            if check('есть идентификатор предложения', bool(offer_id), str(events)[:250]):
                code, acc = req('POST', f'/courier/offers/{offer_id}/accept', token=ctoken)
                check('курьер принял заказ', code == 200, str(acc)[:250])
                oid = (acc.get('order') or {}).get('id') or acc.get('order_id')
                if not oid:
                    code, mine = req('GET', '/courier/orders?active=1', token=ctoken)
                    items = mine.get('items') if isinstance(mine, dict) else mine
                    oid = (items or [{}])[0].get('id') if items else None

                if oid:
                    for st in ('to_pickup', 'at_pickup', 'in_transit', 'at_dropoff', 'done'):
                        code, r = req('POST', f'/courier/orders/{oid}/status', {'status': st}, token=ctoken)
                        check(f'статус → {st}', code == 200, str(r)[:160])

                    code, fin = req('GET', f'/orders/{pid}?t={ttok}')
                    check('заказ завершён', (fin.get('status') or (fin.get('order') or {}).get('status')) == 'done',
                          str(fin)[:200])
                    code, rated = req('POST', f'/orders/{pid}/rate', {'rating': 5, 'comment': 'Всё отлично'},
                                      {'t': ttok} if False else None)
                    if code != 200:
                        code, rated = req('POST', f'/orders/{pid}/rate?t={ttok}',
                                          {'rating': 5, 'comment': 'Всё отлично'})
                    check('оценка курьера принята', code == 200, str(rated)[:200])

        # ── 6. админка ───────────────────────────────────────────────────────
        print('\n\033[1m6. Админка\033[0m')
        if atoken:
            for path in ('/admin/orders', '/admin/couriers', '/admin/clients',
                         '/admin/tariffs', '/admin/extras', '/admin/settings', '/admin/stats'):
                code, r = req('GET', path, token=atoken)
                check(f'GET {path}', code == 200, str(r)[:140])
            code, r = req('GET', '/admin/orders')
            check('админка закрыта без токена', code in (401, 403), f'код {code}')
            code, r = req('GET', '/admin/settings', token=atoken)
            dumped = json.dumps(r, ensure_ascii=False)
            check('пароль SMTP не отдаётся наружу', 'smtp.pass' not in dumped or
                  '"smtp.pass": ""' in dumped or 'true' in dumped.lower(), dumped[:200])

        # ── 7. устойчивость ──────────────────────────────────────────────────
        print('\n\033[1m7. Устойчивость\033[0m')
        code, r = req('GET', '/' + urllib.parse.quote('нет-такого-метода'))
        check('несуществующий эндпоинт даёт 404 с JSON', code == 404 and 'error' in r, str(r)[:140])
        code, r = req('POST', '/price/quote', {'tariff_id': 999999, 'points': pts})
        check('несуществующий тариф отклонён', code in (400, 404), f'код {code}')
        code, r = req('POST', '/orders', {'phone': 'мусор'})
        check('битый заказ отклонён с понятной ошибкой', code == 400 and 'error' in r, str(r)[:160])
        try:
            bad = urllib.request.Request(API + '/price/quote', data='{сломанный json'.encode('utf-8'),
                                         headers={'Content-Type': 'application/json'}, method='POST')
            urllib.request.urlopen(bad, timeout=5)
            check('битый JSON отклонён', False, 'прошёл без ошибки')
        except urllib.error.HTTPError as e:
            check('битый JSON отклонён', e.code == 400, f'код {e.code}')
        except Exception as e:
            check('битый JSON отклонён', False, str(e)[:80])
        code, r = req('GET', BASE + '/../app.py', raw=True)
        check('выход за корень статики закрыт', code in (400, 403, 404), f'код {code}')

        # ── 8. страницы ──────────────────────────────────────────────────────
        print('\n\033[1m8. Страницы\033[0m')
        for url, name in ((BASE + '/', 'клиент'), (BASE + '/courier', 'курьер'), (BASE + '/admin', 'админка')):
            code, html = req('GET', url, raw=True)
            check(f'страница {name} отдаётся', code == 200 and '<' in str(html), f'код {code}')

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
    print('\n\033[1mОшибки на сервере\033[0m')
    check('в логе сервера нет исключений', tb == 0, f'найдено {tb}')
    if tb:
        idx = server_log.find('Traceback')
        print('\033[90m' + server_log[idx:idx + 1400] + '\033[0m')

    print(f'\n\033[1mИтог:\033[0m пройдено {ok_count}, провалено {len(fail)}, '
          f'пропущено по внешним сервисам {len(warn)}')
    if fail:
        print('\n\033[31mПровалы:\033[0m')
        for n, d in fail:
            print(f'  · {n}' + (f'\n      {d}' if d else ''))
    shutil.rmtree(data_dir, ignore_errors=True)
    return 1 if fail else 0


if __name__ == '__main__':
    sys.exit(main())
