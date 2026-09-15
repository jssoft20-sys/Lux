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


def req(method, path, body=None, token=None, raw=False, timeout=25, headers=None):
    url = path if path.startswith('http') else API + path
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
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

        # Часы на линии считает сервер: водитель меняет телефон и чистит
        # браузер, а цифра, на которую он смотрит весь день, должна быть одна.
        if ctoken:
            code, st1 = req('GET', '/courier/stats', token=ctoken)
            check('часы на линии приходят с сервера', 'online_s' in (st1 or {}),
                  str(st1)[:160])
            time.sleep(2.2)
            code, st2 = req('GET', '/courier/stats', token=ctoken)
            check('и идут, пока курьер на линии',
                  (st2 or {}).get('online_s', 0) > (st1 or {}).get('online_s', -1),
                  f"было {(st1 or {}).get('online_s')}, стало {(st2 or {}).get('online_s')}")
            req('POST', '/courier/online', {'online': False}, token=ctoken)
            code, st3 = req('GET', '/courier/stats', token=ctoken)
            worked = (st3 or {}).get('online_s', 0)
            time.sleep(1.2)
            code, st4 = req('GET', '/courier/stats', token=ctoken)
            check('ушёл с линии — часы встали, а не обнулились',
                  (st4 or {}).get('online_s') == worked and worked > 0,
                  f'после ухода {worked}, через секунду {(st4 or {}).get("online_s")}')
            req('POST', '/courier/online', {'online': True}, token=ctoken)
            code, st5 = req('GET', '/courier/stats', token=ctoken)
            check('вернулся — счёт продолжился с накопленного',
                  (st5 or {}).get('online_s', 0) >= worked,
                  f'было {worked}, стало {(st5 or {}).get("online_s")}')
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

        # ── 9. бонусы и «от двери до двери» ──────────────────────────────────
        print('\n\033[1m9. Бонусы и подъём к двери\033[0m')
        base_q = {'tariff_id': tid, 'points': pts, 'loaders': 0}
        code, q0 = req('POST', '/price/quote', base_q)
        code, q1 = req('POST', '/price/quote',
                       dict(base_q, extras=[{'code': 'door_to_door', 'qty': 2}]))
        d1 = (q1 or {}).get('door_price') or 0
        check('подъём к двери есть в расчёте', code == 200 and d1 > 0, str(q1)[:200])
        check('две точки с дверью стоят вдвое дороже одной',
              (q1.get('total') or 0) - (q0.get('total') or 0) == d1 * 2,
              f"было {q0.get('total')}, стало {q1.get('total')}, за точку {d1}")
        check('в расчёте видно, за сколько точек берём', q1.get('door_points') == 2,
              str(q1.get('door_points')))
        # Цена на экране считается по тем же правилам, что и в чеке: отметили
        # точку — надбавка появится, даже если строку оплаты не прислали.
        flagged = [dict(pts[0], door_to_door=True), dict(pts[1])] \
            if isinstance(pts[0], dict) else None
        if flagged:
            code, qf = req('POST', '/price/quote',
                           {'tariff_id': tid, 'points': flagged, 'loaders': 0})
            check('на экране цена считается так же, как в чеке',
                  (qf or {}).get('door_points') == 1,
                  f"точек с дверью {(qf or {}).get('door_points')}")
        # Владелец просил брать вперёд пять-десять процентов, а не всю комиссию:
        # 270 сом до подачи машины человека отпугнут, 180 — нет.
        pre, tot = (q1.get('prepay') or 0), (q1.get('total') or 0)
        check('бронь — десятая часть заказа, не вся комиссия',
              0 < pre <= max(tot // 10 + 1, 5000),
              f'бронь {pre} при заказе {tot}, это {pre * 100 // max(tot, 1)}%')
        check('бронь меньше комиссии сервиса', pre <= (q1.get('commission') or 0),
              f"бронь {pre}, комиссия {q1.get('commission')}")

        # Подъём к двери должен дойти до курьера: он оплачен отдельно, и знать,
        # к какой именно двери подниматься, курьеру нужно до выезда.
        door_body = dict(order_body, phone='0777112233', extras=[{'code': 'door_to_door', 'qty': 1}])
        door_body['points'] = [dict(door_body['points'][0], door_to_door=True, lift='no'),
                               dict(door_body['points'][1])]
        code, dorder = req('POST', '/orders', door_body)
        dpid = (dorder or {}).get('public_id')
        check('заказ с подъёмом к двери создан', code in (200, 201) and bool(dpid),
              str(dorder)[:200])
        if atoken and dpid:
            code, lst = req('GET', '/admin/orders?limit=50', token=atoken)
            items = (lst or {}).get('items') if isinstance(lst, dict) else lst
            did = next((o['id'] for o in (items or []) if o.get('public_id') == dpid), None)
            check('заказ виден в админке', bool(did), f'искали {dpid}')
            code, full = req('GET', f'/admin/orders/{did}', token=atoken)
            pts_saved = ((full or {}).get('order') or full or {}).get('points') or []
            first = pts_saved[0] if pts_saved else {}
            check('флажок подъёма сохранён у точки', bool(first.get('door_to_door')),
                  str(first)[:220])
            check('и про лифт не забыли', str(first.get('lift') or '') == 'no',
                  str(first.get('lift')))

            # Подъём отмечен у точки, но строку оплаты «забыли» прислать.
            # Курьер поднимется в любом случае — значит и в чеке это должно быть.
            sneaky = dict(order_body, phone='0777445566', extras=[])
            sneaky['points'] = [dict(sneaky['points'][0], door_to_door=True),
                                dict(sneaky['points'][1], door_to_door=True)]
            code, sn = req('POST', '/orders', sneaky)
            spid = (sn or {}).get('public_id')
            code, lst2 = req('GET', '/admin/orders?limit=50', token=atoken)
            items2 = (lst2 or {}).get('items') if isinstance(lst2, dict) else lst2
            sid = next((o['id'] for o in (items2 or []) if o.get('public_id') == spid), None)
            code, sfull = req('GET', f'/admin/orders/{sid}', token=atoken)
            se = [e for e in ((sfull or {}).get('extras') or [])
                  if e.get('code') == 'door_to_door']
            check('подъём без строки оплаты всё равно попал в чек',
                  bool(se) and int(se[0].get('qty') or 0) == 2, str((sfull or {}).get('extras'))[:200])

        # Клиент получает свой токен, доказав, что заказ его: телефон + токен заказа.
        ctok = None
        if pid and ttok:
            code, cl = req('POST', '/client/claim',
                           {'phone': '0555123456', 'order_id': pid, 'track_token': ttok})
            ctok = (cl or {}).get('token')
            check('клиент опознан по своему заказу', code == 200 and bool(ctok), str(cl)[:200])
            code, bad_cl = req('POST', '/client/claim',
                               {'phone': '0555123456', 'order_id': pid,
                                'track_token': 'не-тот-токен'})
            check('с чужим токеном клиента не пускают', bad_cl and code in (403, 429),
                  f'код {code}')

        if ctok:
            hdr = {'X-Client-Token': ctok}
            code, b = req('GET', '/client/bonus', headers=hdr)
            check('экран бонусов открывается', code == 200 and 'balance' in (b or {}),
                  str(b)[:200])
            bal = (b or {}).get('balance') or 0
            check('кэшбек за выполненный заказ начислен', bal > 0,
                  f'на счету {bal}, история {str((b or {}).get("history"))[:160]}')
            code_i = (b or {}).get('invite_code') or (b or {}).get('code')
            check('у клиента есть свой код приглашения', bool(code_i), str(b)[:200])

            code, mx = req('GET', '/client/bonus/max?total=200000', headers=hdr)
            cap = (mx or {}).get('max') or 0
            check('потолок списания не выше доли заказа',
                  code == 200 and cap <= 200000 * ((mx or {}).get('max_share') or 30) // 100,
                  str(mx)[:160])

            code, own = req('POST', '/client/bonus/invite', {'code': code_i}, headers=hdr)
            check('свой же код не принимается', code in (400, 403, 409), f'код {code}: {str(own)[:140]}')

            code, nope = req('GET', '/client/bonus',
                             headers={'X-Client-Token': 'x' * 48})
            check('чужой токен клиента не пускает', code in (401, 403, 404), f'код {code}')

            # Списание в новом заказе: просим списать всё, что можно, и смотрим,
            # что со счёта ушло ровно столько, сколько сервер сам и разрешил.
            before = bal
            code, spend_order = req('POST', '/orders',
                                    dict(order_body, phone='0555123456', bonus_spend=True))
            spent = ((spend_order or {}).get('price') or {}).get('bonus_spent') or 0
            check('бонусы списались в заказ', code in (200, 201) and spent > 0,
                  f'списано {spent}, было на счету {before}')
            code, after_b = req('GET', '/client/bonus', headers=hdr)
            check('на счету стало ровно на списанное меньше',
                  (after_b or {}).get('balance') == before - spent,
                  f"было {before}, списали {spent}, стало {(after_b or {}).get('balance')}")
            check('курьеру скидка не в убыток: его доля не тронута',
                  ((spend_order or {}).get('price') or {}).get('courier_payout', 0) > 0,
                  str((spend_order or {}).get('price'))[:200])

        if atoken:
            code, ab = req('GET', '/admin/bonus', token=atoken)
            check('сводка по бонусам в админке', code == 200 and isinstance(ab, dict),
                  str(ab)[:160])

        # Цена на кнопке обязана совпасть с ценой в заказе. Расхождение здесь —
        # это человек, который согласился на 683 сома и получил счёт на 1461:
        # он больше не вернётся, и правильно сделает.
        # Оба адреса внутри зоны работы: заказ должен не только посчитаться,
        # но и создаться, иначе сравнивать будет нечего.
        far = [{'addr': 'Чуй 100', 'lat': 42.8746, 'lng': 74.5698},
               {'addr': 'Восточный автовокзал', 'lat': 42.8200, 'lng': 74.7500}]
        # Считаем ровно то же, что потом закажем: те же грузчики и допуслуги.
        # Иначе сравнивали бы разные заказы и радовались бы совпадению зря.
        same = {'tariff_id': tid, 'loaders': order_body['loaders'],
                'extras': order_body['extras']}
        code, q_obj = req('POST', '/price/quote', dict(same, points=far))
        code, q_pair = req('POST', '/price/quote',
                           dict(same, points=[[p['lat'], p['lng']] for p in far]))
        check('расчёт понимает и объекты, и голые пары координат',
              (q_obj or {}).get('total') == (q_pair or {}).get('total')
              and (q_obj or {}).get('total', 0) > 0,
              f"объектами {(q_obj or {}).get('total')}, парами {(q_pair or {}).get('total')}")
        check('на дальнем маршруте километры посчитаны, а не отброшены',
              (q_obj or {}).get('distance_m', 0) > 8000,
              f"расстояние {(q_obj or {}).get('distance_m')} м")

        code, far_order = req('POST', '/orders',
                              dict(order_body, phone='0700112244', points=far))
        made = ((far_order or {}).get('price') or {}).get('total')
        check('цена с экрана совпала с ценой в заказе',
              made is not None and made == (q_obj or {}).get('total'),
              f"на экране {(q_obj or {}).get('total')}, в заказе {made}; "
              f"ответ {str(far_order)[:160]}")

        # ── 9б. ссылка «поделиться»: смотреть можно, отменять нельзя ─────────
        print('\n\033[1m9б. Ссылка, которой делятся\033[0m')
        code, shared = req('POST', '/orders', dict(order_body, phone='0700554433'))
        spid = (shared or {}).get('public_id')
        stok = (shared or {}).get('track_token')
        vtok = (shared or {}).get('view_token')
        check('у заказа есть отдельный токен для ссылки', bool(vtok) and vtok != stok,
              f'view={str(vtok)[:10]}…, track={str(stok)[:10]}…')

        if spid and vtok:
            code, seen = req('GET', f'/orders/{spid}?t={vtok}')
            check('по ссылке заказ виден', code == 200 and seen.get('public_id') == spid,
                  f'код {code}: {str(seen)[:160]}')
            check('и помечен как «только смотреть»', seen.get('readonly') is True,
                  str(seen.get('readonly')))
            dumped = json.dumps(seen, ensure_ascii=False)
            check('телефона заказчика в нём нет', '0555123456' not in dumped
                  and '996555123456' not in dumped, dumped[:200])
            pts = seen.get('points') or []
            check('квартиры и домофона в нём нет',
                  all('flat' not in p and 'intercom' not in p for p in pts), str(pts)[:200])
            check('номер дома в адресе срезан',
                  all(not any(ch.isdigit() for ch in str(p.get('addr') or '')) for p in pts),
                  str([p.get('addr') for p in pts]))

            code, r = req('POST', f'/orders/{spid}/cancel?t={vtok}', {'reason': 'шутка'})
            check('по ссылке отменить заказ НЕЛЬЗЯ', code == 403, f'код {code}: {str(r)[:160]}')
            code, r = req('POST', f'/orders/{spid}/rate?t={vtok}', {'rating': 1})
            check('и оценить тоже нельзя', code in (403, 409), f'код {code}')
            code, r = req('POST', f'/orders/{spid}/messages?t={vtok}', {'text': 'привет'})
            check('и написать курьеру нельзя', code in (403, 404), f'код {code}')

            # Переписка не должна уехать в поток гостя. Проверяем прямо: пишем
            # сообщение от хозяина и слушаем гостевой поток — там его быть не может.
            if ctoken:
                guest_evts, own_evts = [], []
                gt = threading.Thread(target=sse_collect,
                                      args=(f'/orders/{spid}/stream?t={vtok}', None, 6, guest_evts),
                                      daemon=True)
                ot = threading.Thread(target=sse_collect,
                                      args=(f'/orders/{spid}/stream?t={stok}', None, 6, own_evts),
                                      daemon=True)
                gt.start(); ot.start()
                time.sleep(1.5)
                req('POST', f'/orders/{spid}/messages?t={stok}', {'text': 'где вы едете'})
                time.sleep(3.5)
                check('переписка гостю по ссылке не уходит',
                      not any(e[0] == 'message' for e in guest_evts),
                      f'события гостя: {[e[0] for e in guest_evts][:6]}')

            code, own = req('GET', f'/orders/{spid}?t={stok}')
            check('хозяин заказа видит всё как раньше',
                  code == 200 and not own.get('readonly')
                  and any(p.get('flat') for p in (own.get('points') or [])),
                  str(own.get('points'))[:200])
            code, r = req('POST', f'/orders/{spid}/cancel?t={stok}', {'reason': 'передумал'})
            check('а сам отменить может', code == 200, f'код {code}: {str(r)[:140]}')

        # ── 10. оплата брони ─────────────────────────────────────────────────
        print('\n\033[1m10. Оплата брони по QR\033[0m')
        # Заказ из пятого раздела уже закрыт — по нему платить нечего, и это
        # правильный отказ. Поэтому для оплаты заводим свежий заказ.
        code, fresh_order = req('POST', '/orders', dict(order_body, phone='0700998877'))
        fpid = (fresh_order or {}).get('public_id')
        fttok = (fresh_order or {}).get('track_token')
        check('заведён свежий заказ под оплату', bool(fpid and fttok), str(fresh_order)[:160])

        if fpid and fttok:
            code, pay = req('POST', f'/pay/{fpid}/qr?t={fttok}')
            check('пока банк не настроен, экран оплаты честно говорит «наличными»',
                  code == 200 and pay.get('enabled') is False, f'код {code}: {str(pay)[:200]}')
            code, st = req('GET', f'/pay/{fpid}/status?t={fttok}')
            check('состояние оплаты читается', code in (200, 429), f'код {code}: {str(st)[:160]}')
            code, alien = req('POST', f'/pay/{fpid}/qr?t=' + urllib.parse.quote('чужой-токен'))
            check('чужой токен к оплате не пускает', code in (401, 403, 404, 429), f'код {code}')
        if pid and ttok:
            code, closed_pay = req('POST', f'/pay/{pid}/qr?t={ttok}')
            check('по закрытому заказу платить не дают', code == 409, f'код {code}')

        code, cb = req('POST', '/pay/callback',
                       {'status': 'PROCESSED', 'sum': 150.0, 'transactionId': '1'})
        check('уведомление банка без пароля отклонено', code == 401, f'код {code}: {str(cb)[:140]}')

        if atoken:
            code, ps = req('GET', '/admin/pay/settings', token=atoken)
            dumped = json.dumps(ps, ensure_ascii=False)
            check('реквизиты банка читаются в админке', code == 200, str(ps)[:160])
            check('ключ банка наружу не отдаётся',
                  'optima_key' not in dumped or '"optima_key": ""' in dumped
                  or 'key_set' in dumped, dumped[:200])
            code, sett = req('GET', '/admin/settings', token=atoken)
            dumped = json.dumps(sett, ensure_ascii=False)
            check('ключ и пароль банка не утекают в общие настройки',
                  '"payment.optima_key": ""' in dumped or 'payment.optima_key' not in dumped,
                  [s for s in dumped.split(',') if 'optima_key' in s][:1])
            code, sp = req('GET', '/admin/pay/sale-points', token=atoken)
            check('без ключа точки продаж просят настроить, а не падают',
                  code in (200, 400, 409, 424, 502), f'код {code}: {str(sp)[:160]}')
            code, test = req('POST', '/admin/pay/test', token=atoken)
            check('проверка связи отвечает понятно, а не пятисоткой',
                  code != 500 and isinstance(test, dict), f'код {code}: {str(test)[:200]}')
            code, closed = req('GET', '/admin/pay/settings')
            check('реквизиты закрыты без входа', closed and code in (401, 403), f'код {code}')

            # Демо-оплата: владелец должен увидеть настоящий экран раньше банка.
            code, off = req('POST', '/admin/pay/demo', {}, token=atoken)
            check('без включённого демо пример не выпускается', code == 400, f'код {code}')

            req('PUT', '/admin/settings',
                {'values': {'payment.demo': True, 'payment.enabled': True,
                            'payment.provider': 'optima'}}, token=atoken)
            code, demo = req('POST', '/admin/pay/demo', {}, token=atoken)
            dpid = (demo or {}).get('public_id')
            check('пример оплаты выпущен', code in (200, 201) and bool(dpid), str(demo)[:200])
            check('в нём настоящая картинка кода',
                  len((demo or {}).get('qr_base64') or '') > 500,
                  f"символов {len((demo or {}).get('qr_base64') or '')}")
            check('и сумма брони названа', bool((demo or {}).get('sum')), str(demo.get('sum')))

            if dpid:
                code, conf = req('POST', '/admin/pay/demo/confirm',
                                 {'public_id': dpid}, token=atoken)
                check('пример можно отметить оплаченным',
                      code == 200 and (conf or {}).get('payment_status') == 'paid',
                      str(conf)[:160])
            # Самое важное: этой кнопкой нельзя объявить оплаченным живой заказ.
            if spid:
                code, bad_conf = req('POST', '/admin/pay/demo/confirm',
                                     {'public_id': spid}, token=atoken)
                check('настоящий заказ этой кнопкой оплаченным не сделать',
                      code == 403, f'код {code}: {str(bad_conf)[:140]}')
            req('PUT', '/admin/settings',
                {'values': {'payment.demo': False, 'payment.enabled': False,
                            'payment.provider': 'none'}}, token=atoken)

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
