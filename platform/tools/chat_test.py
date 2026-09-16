# -*- coding: utf-8 -*-
"""Переписка клиента и курьера: то, из-за чего она «прогоняет».

Жалоба была одна: чат бывает прогоняет между клиентом и курьером. Разбирается
она на две разные поломки, и обе проверяются здесь.

1. Связь пропала — сообщения второй стороны прошли мимо. Поток событий
   переигрывает только то, что случилось при нём, поэтому после возврата связи
   переписку надо перечитывать целиком. Здесь проверяем серверную половину:
   что перечитать действительно можно и что придёт всё, включая отметки
   «прочитано». Клиентскую половину проверяет tools/flow_test.mjs в браузере.

2. Повтор отправки. Сообщение дошло, а ответ до телефона не добрался; человек
   жмёт «отправить ещё раз» — и в переписке два одинаковых пузыря. Лечится
   ключом отправки: сервер узнаёт свою же запись и ничего не добавляет.

Запуск:  python3 tools/chat_test.py
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
DATA = tempfile.mkdtemp(prefix='sg-chat-')
os.environ['SG_DATA'] = DATA

from server import auth, db, settings                      # noqa: E402
from server.core import App, serve                          # noqa: E402
from server.routers import auth as auth_routes              # noqa: E402
from server.routers import extra as extra_routes            # noqa: E402
from server.routers import public as public_routes          # noqa: E402

db.init(os.path.join(DATA, 'test.sqlite3'))
settings.seed_catalog()

bad = []


def check(name, ok, note=''):
    print(('  ok  ' if ok else '  ПЛОХО ') + name + (' — ' + note if note else ''))
    if not ok:
        bad.append(name)


# ── стенд: заказ в пути, у него курьер и клиент ──────────────────────────────

tid = db.value("SELECT id FROM tariffs WHERE code='sprinter'", (), None)
uid = db.insert('users', {'role': 'courier', 'email': 'c@x.kg', 'name': 'Азамат',
                          'phone': '+996700111222', 'status': 'active',
                          'password_hash': auth.hash_password('sprinter2026'),
                          'created_at': db.now()})
db.insert('couriers', {'user_id': uid, 'vehicle_class': 'van', 'car_model': 'Sprinter',
                       'car_plate': '01KG123ABC', 'car_color': 'белый',
                       'verify_status': 'approved'})
cid = db.insert('clients', {'phone': '+996555999888', 'name': 'Нурлан', 'created_at': db.now()})
oid = db.insert('orders', {
    'public_id': 'CH4TTEST', 'track_token': 'track-token-for-chat-test', 'client_id': cid,
    'courier_id': uid, 'tariff_id': tid, 'status': 'in_transit', 'lang': 'ru',
    'points': db.jdump([{'addr': 'Киевская, 120', 'lat': 42.876, 'lng': 74.601},
                        {'addr': 'Ахунбаева 45', 'lat': 42.845, 'lng': 74.628}]),
    'distance_m': 12400, 'duration_s': 2100, 'price_total': 145000,
    'created_at': db.now() - 3600,
})

app = App(os.path.join(ROOT, 'web'), dev=False, base='/')
auth_routes.mount(app)
public_routes.register(app)
extra_routes.register(app)
srv = serve(app, '127.0.0.1', 0)
port = srv.socket.getsockname()[1]
threading.Thread(target=srv.serve_forever, kwargs={'poll_interval': 0.2}, daemon=True).start()
time.sleep(0.2)

API = 'http://127.0.0.1:%d/api/v1' % port
TOKEN = 'track-token-for-chat-test'


def ask(method, path, body=None, bearer=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if bearer:
        req.add_header('Authorization', 'Bearer ' + bearer)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, None


code, login = ask('POST', '/auth/login', {'email': 'c@x.kg', 'password': 'sprinter2026'})
ctoken = (login or {}).get('token')
check('курьер вошёл', code == 200 and bool(ctoken), '%s %s' % (code, str(login)[:150]))

CHAT = '/orders/CH4TTEST/messages?t=' + TOKEN
DRIVER = '/courier/orders/%d/messages' % oid

print('\n— обычная переписка')
code, r = ask('POST', '/orders/CH4TTEST/messages', {'text': 'Я у подъезда', 't': TOKEN})
check('клиент написал', code == 201, str(code))
first_id = ((r or {}).get('message') or {}).get('id')
code, r = ask('POST', DRIVER, {'text': 'Понял, поднимаюсь'}, bearer=ctoken)
check('курьер ответил', code == 201, str(code))

code, r = ask('GET', CHAT)
items = (r or {}).get('items') or []
check('оба сообщения в переписке', len(items) == 2, str(len(items)))
check('порядок по времени', [m['text'] for m in items] == ['Я у подъезда', 'Понял, поднимаюсь'],
      str([m['text'] for m in items]))

print('\n— повтор отправки не двоит сообщение')
# Ровно то, что делает телефон на плохой связи: тот же текст, тот же ключ.
key = 'abcDEF123456'
code1, r1 = ask('POST', '/orders/CH4TTEST/messages',
                {'text': 'Открыл ворота', 't': TOKEN, 'key': key})
code2, r2 = ask('POST', '/orders/CH4TTEST/messages',
                {'text': 'Открыл ворота', 't': TOKEN, 'key': key})
id1 = ((r1 or {}).get('message') or {}).get('id')
id2 = ((r2 or {}).get('message') or {}).get('id')
check('первая отправка прошла', code1 == 201 and bool(id1), str(code1))
check('повтор не завёл второе сообщение', id2 == id1, '%s и %s' % (id1, id2))
check('повтор честно помечен', (r2 or {}).get('repeat') is True, str((r2 or {}).get('repeat')))
n = db.value("SELECT COUNT(*) FROM messages WHERE order_id=? AND text='Открыл ворота'", (oid,), 0)
check('в базе одна запись, а не две', n == 1, str(n))

code3, r3 = ask('POST', DRIVER, {'text': 'Выхожу', 'key': 'driverKEY0001'}, bearer=ctoken)
code4, r4 = ask('POST', DRIVER, {'text': 'Выхожу', 'key': 'driverKEY0001'}, bearer=ctoken)
check('повтор у курьера тоже не двоит',
      ((r3 or {}).get('message') or {}).get('id') == ((r4 or {}).get('message') or {}).get('id'),
      str(code3) + '/' + str(code4))

# Ключ одной стороны не должен подхватываться другой: тексты у них разные.
code5, r5 = ask('POST', '/orders/CH4TTEST/messages',
                {'text': 'Это клиент', 't': TOKEN, 'key': 'driverKEY0001'})
check('ключ курьера не мешает клиенту',
      code5 == 201 and ((r5 or {}).get('message') or {}).get('text') == 'Это клиент', str(code5))

print('\n— разные сообщения с разными ключами доходят оба')
ask('POST', '/orders/CH4TTEST/messages', {'text': 'Первое', 't': TOKEN, 'key': 'kkkk111111'})
ask('POST', '/orders/CH4TTEST/messages', {'text': 'Второе', 't': TOKEN, 'key': 'kkkk222222'})
code, r = ask('GET', CHAT)
texts = [m['text'] for m in ((r or {}).get('items') or [])]
check('оба на месте', texts.count('Первое') == 1 and texts.count('Второе') == 1, str(texts))
check('без ключа отправка работает как раньше',
      ask('POST', '/orders/CH4TTEST/messages', {'text': 'Без ключа', 't': TOKEN})[0] == 201)
check('мусорный ключ не ломает отправку',
      ask('POST', '/orders/CH4TTEST/messages',
          {'text': 'Кривой ключ', 't': TOKEN, 'key': 'ы' * 80})[0] == 201)

print('\n— перечитать переписку после обрыва связи')
# Клиент «пропал». Курьер пишет в это время — из потока клиент этого не увидит.
ask('POST', DRIVER, {'text': 'потеря-1'}, bearer=ctoken)
ask('POST', DRIVER, {'text': 'потеря-2'}, bearer=ctoken)
code, r = ask('GET', CHAT)
texts = [m['text'] for m in ((r or {}).get('items') or [])]
check('перечитанная переписка содержит пропавшее',
      'потеря-1' in texts and 'потеря-2' in texts, str(texts[-4:]))
check('и честный счётчик непрочитанного',
      (r or {}).get('unread', 0) >= 2, str((r or {}).get('unread')))

print('\n— отметка «прочитано» видна при перечитывании')
code, _ = ask('POST', '/orders/CH4TTEST/messages/read', {'t': TOKEN})
check('клиент отметил прочитанным', code == 200, str(code))
code, r = ask('GET', DRIVER, bearer=ctoken)
mine = [m for m in ((r or {}).get('items') or []) if m.get('sender') == 'courier']
check('курьер видит «прочитано» после перечитывания',
      any(m.get('read_at') for m in mine), str([m.get('read_at') for m in mine][:4]))
code, r = ask('GET', CHAT)
check('у клиента непрочитанных больше нет', (r or {}).get('unread', 0) == 0,
      str((r or {}).get('unread')))

print('\n— хвост переписки, как его берёт курьер')
code, r = ask('GET', DRIVER, bearer=ctoken)
all_items = (r or {}).get('items') or []
last = max([m['id'] for m in all_items] or [0])
code, sent = ask('POST', '/orders/CH4TTEST/messages', {'text': 'после хвоста', 't': TOKEN})
check('новое сообщение отправлено', code == 201, str(code) + ' ' + str(sent)[:120])
code, r = ask('GET', DRIVER + '?after=%d' % last, bearer=ctoken)
tail = [m['text'] for m in ((r or {}).get('items') or [])]
check('по хвосту приходит только новое', tail == ['после хвоста'],
      'после %d пришло %s' % (last, tail))

print('\n— чужой в переписку не попадает')
code, _ = ask('GET', '/orders/CH4TTEST/messages?t=' + urllib.parse.quote('не-тот-токен'))
check('с чужим токеном переписку не отдают', code in (401, 403, 404), str(code))
view = db.value('SELECT view_token FROM orders WHERE id=?', (oid,), None)
if not view:
    db.execute('UPDATE orders SET view_token=? WHERE id=?', ('ViewOnly1234567890', oid))
    view = 'ViewOnly1234567890'
code, _ = ask('POST', '/orders/CH4TTEST/messages', {'text': 'я мимо проходил', 't': view})
check('по ссылке для просмотра писать нельзя', code == 403, str(code))

srv.shutdown()
srv.server_close()
shutil.rmtree(DATA, ignore_errors=True)
print('\nИТОГ:', 'всё сходится' if not bad else 'сломано: %s' % ', '.join(bad))
sys.exit(1 if bad else 0)
