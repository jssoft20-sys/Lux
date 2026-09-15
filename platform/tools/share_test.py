# -*- coding: utf-8 -*-
"""Карточка заказа для мессенджеров: картинка, разметка и что видно постороннему.

Проверяем то, из-за чего этой карточкой можно навредить: в ссылку, которую
человек кидает в общий чат, не должны попасть ни токен отслеживания, ни телефон,
ни номер квартиры. И то, из-за чего ей не будут пользоваться: пустая или битая
картинка вместо превью.

Запуск:  python3 tools/share_test.py
"""
import json, os, shutil, struct, sys, tempfile, threading, time, http.client

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
DATA = tempfile.mkdtemp(prefix='sg-share-')
os.environ['SG_DATA'] = DATA

from server import db, share, settings          # noqa: E402
from server.routers import public as public_routes   # noqa: E402
from server.core import App, serve              # noqa: E402

db.init(os.path.join(DATA, 'test.sqlite3'))
settings.seed_catalog()

tid = db.value("SELECT id FROM tariffs WHERE code='sprinter'", (), None)
uid = db.insert('users', {'role': 'courier', 'email': 'c@x.kg', 'name': 'Азамат',
                          'phone': '+996700111222', 'status': 'active', 'created_at': db.now()})
db.insert('couriers', {'user_id': uid, 'vehicle_class': 'van', 'car_model': 'Mercedes Sprinter',
                       'car_plate': '01KG123ABC', 'car_color': 'белый'})
cid = db.insert('clients', {'phone': '+996555999888', 'name': 'Нурлан', 'created_at': db.now()})

points = [
    {'addr': 'Киевская, 120', 'lat': 42.876, 'lng': 74.601, 'flat': '48', 'entrance': '3',
     'floor': '5', 'phone': '+996555999888', 'name': 'Нурлан', 'comment': 'домофон 48'},
    {'addr': 'Ахунбаева 45а', 'lat': 42.845, 'lng': 74.628, 'flat': '12', 'phone': '+996700333444',
     'name': 'Айгуль'},
]
oid = db.insert('orders', {
    'public_id': 'AB12CDEF', 'track_token': 'secret-track-token-xyz', 'client_id': cid,
    'courier_id': uid, 'tariff_id': tid, 'status': 'in_transit', 'lang': 'ru',
    'points': db.jdump(points), 'distance_m': 12400, 'duration_s': 2100,
    'price_total': 145000, 'created_at': db.now() - 3600,
})

app = App(os.path.join(ROOT, 'web'), dev=False, base='/go/')
app.csp = "default-src 'self'"
public_routes.register(app)   # как в app.py: сперва обычные маршруты
share.register(app)
srv = serve(app, '127.0.0.1', 0)
port = srv.socket.getsockname()[1]
threading.Thread(target=srv.serve_forever, kwargs={'poll_interval': 0.2}, daemon=True).start()
time.sleep(0.2)


def ask(path, method='GET', headers=None, body=None):
    c = http.client.HTTPConnection('127.0.0.1', port, timeout=20)
    head = dict(headers or {}, Host='sprintergo.kg', **{'X-Forwarded-Proto': 'https'})
    raw = None
    if body is not None:
        raw = json.dumps(body).encode('utf-8')
        head['Content-Type'] = 'application/json'
    c.request(method, path, body=raw, headers=head)
    r = c.getresponse()
    body = r.read()
    out = (r.status, dict(r.getheaders()), body)
    c.close()
    return out


def png_size(raw):
    assert raw[:8] == b'\x89PNG\r\n\x1a\n', 'не PNG'
    w, h = struct.unpack('>II', raw[16:24])
    return w, h


bad = []


def check(name, ok, note=''):
    print(('  ok  ' if ok else '  ПЛОХО ') + name + (' — ' + note if note else ''))
    if not ok:
        bad.append(name)


# В жизни заказ появляется после запроса из приложения — с него сервис и узнаёт
# свой домен. Повторяем этот порядок: сперва обычный вызов API, потом мессенджер.
ask('/api/v1/config')

print('\n— короткая ссылка /share/…')
st, h, body = ask('/share/AB12CDEF')
text = body.decode('utf-8', 'replace')
check('страница отвечает 200', st == 200, str(st))
check('это html', h.get('Content-Type', '').startswith('text/html'), h.get('Content-Type', ''))
check('кэш на минуту', 'max-age=60' in h.get('Cache-Control', ''), h.get('Cache-Control', ''))
check('og:image абсолютный',
      'property="og:image" content="https://sprintergo.kg/go/share/AB12CDEF.ru.png"' in text)
check('og:url', 'property="og:url" content="https://sprintergo.kg/go/share/AB12CDEF"' in text)
check('og:type=website', 'property="og:type" content="website"' in text)
check('twitter:card', 'name="twitter:card" content="summary_large_image"' in text)
check('размеры картинки в мете', 'og:image:width" content="1200"' in text
      and 'og:image:height" content="630"' in text)
check('заголовок статуса', 'Заказ в пути' in text)
check('улица без дома', '>Киевская<' in text and 'Киевская, 120' not in text
      and '45а' not in text)
check('кнопка отслеживания', 'href="/go/#/order/AB12CDEF"' in text)
check('кнопка не мельче 44px', 'min-height:52px' in text)
check('нет токена', 'secret-track-token' not in text)
check('нет телефона клиента', '999888' not in text and '333444' not in text)
check('нет имени клиента', 'Нурлан' not in text and 'Айгуль' not in text)
check('нет квартиры и подъезда', 'домофон' not in text)
check('поиск не индексирует', 'noindex' in text)

print('\n— картинка /share/….png')
st, h, body = ask('/share/AB12CDEF.png')
check('картинка отвечает 200', st == 200, str(st))
check('это image/png', h.get('Content-Type') == 'image/png', h.get('Content-Type', ''))
check('1200×630', png_size(body) == (1200, 630), str(png_size(body)))
check('вес разумный', 5000 < len(body) < 400000, '%d байт' % len(body))
etag = h.get('ETag')
st2, h2, body2 = ask('/share/AB12CDEF.png', headers={'If-None-Match': etag})
check('повтор отдаёт 304', st2 == 304, str(st2))
st3, h3, body3 = ask('/share/AB12CDEF.png', method='HEAD')
check('HEAD без тела', st3 == 200 and body3 == b'', str(st3))

print('\n— язык в пути')
st, h, body = ask('/share/AB12CDEF.ky')
text = body.decode('utf-8', 'replace')
check('кыргызская страница', st == 200 and 'Заказ жолдо' in text, str(st))
check('og:locale ky', 'content="ky_KG"' in text)
check('ссылка на русскую версию', 'href="/go/share/AB12CDEF.ru"' in text)
st, h, body = ask('/share/AB12CDEF.ky.png')
check('кыргызская картинка', st == 200 and png_size(body) == (1200, 630), str(st))

print('\n— через обычный роутер /api/v1/share/…')
st, h, body = ask('/api/v1/share/AB12CDEF')
check('страница через API', st == 200 and b'og:image' in body, str(st))
st, h, body = ask('/api/v1/share/AB12CDEF.png')
check('картинка через API', st == 200 and png_size(body) == (1200, 630), str(st))
st, h, body = ask('/api/v1/share/AB12CDEF?lang=ky')
check('язык строкой запроса', st == 200 and 'Заказ жолдо' in body.decode('utf-8', 'replace'))

print('\n— чего быть не должно')
st, h, body = ask('/api/v1/share/ZZZZZZZZ')
check('нет заказа — 404', st == 404, str(st))
check('и человеческий текст', 'Заказ не найден' in body.decode('utf-8', 'replace'))
st, h, body = ask('/api/v1/share/ZZZZZZZZ.png')
check('картинка-заглушка 404', st == 404 and png_size(body) == (1200, 630), str(st))
st, h, body = ask('/share/../../app.py')
check('выход из каталога не работает', st in (400, 404), str(st))
st, h, body = ask('/share/%2e%2e/app.py')
check('обход через проценты не работает', st in (400, 404), str(st))

print('\n— живая страница по ссылке, которой поделились')
# Токен просмотра выдаёт сам сервис при создании заказа; здесь заказ положили
# в базу руками, поэтому дописываем поле — всё остальное как в жизни.
VIEW = 'Vw7kQ2mNpR8sT4xY6zAbCdEf'
db.execute('UPDATE orders SET view_token=? WHERE id=?', (VIEW, oid))

st, h, body = ask('/share/AB12CDEF?v=' + VIEW)
live_text = body.decode('utf-8', 'replace')
check('страница с токеном отвечает 200', st == 200, str(st))
check('подключился модуль живой карты',
      'assets/js/share/watch.js' in live_text)
check('настройки уехали в разметку', 'window.SG_WATCH' in live_text)
check('префикс установки тоже', 'window.SG_BASE' in live_text)
check('стили карты подключены',
      'assets/css/map.css' in live_text and 'assets/css/share.css' in live_text)
check('токен не утекает в чужие журналы',
      'name="referrer" content="no-referrer"' in live_text)
check('страницу с токеном не кэшируют',
      h.get('Cache-Control') == 'no-store', h.get('Cache-Control', ''))
check('карточка осталась запасным вариантом',
      'og:image' in live_text and 'Заказ в пути' in live_text)
# Главное требование: посторонний смотрит, но ничем не распоряжается.
check('кнопки «Отменить» на странице нет',
      'Отменить' not in live_text and 'cancel' not in live_text.lower())
check('и личного тоже нет',
      '999888' not in live_text and 'Нурлан' not in live_text
      and 'домофон' not in live_text and 'secret-track-token' not in live_text)

st, h, body = ask('/share/AB12CDEF?v=' + 'X' * len(VIEW))
wrong = body.decode('utf-8', 'replace')
check('чужой токен — обычная карточка',
      st == 200 and 'watch.js' not in wrong and 'og:image' in wrong, str(st))
check('и её снова можно кэшировать',
      'max-age=60' in h.get('Cache-Control', ''), h.get('Cache-Control', ''))
st, h, body = ask('/share/AB12CDEF')
check('без токена — тоже карточка (так приходит робот)',
      st == 200 and 'watch.js' not in body.decode('utf-8', 'replace'), str(st))
st, h, body = ask('/share/AB12CDEF?v=' + 'a' * 300)
check('слишком длинный токен не роняет страницу', st == 200, str(st))

check('сверка токена: свой подходит', share.view_ok('AB12CDEF', VIEW))
check('сверка токена: чужой нет', not share.view_ok('AB12CDEF', 'X' * len(VIEW)))
check('сверка токена: пустой нет', not share.view_ok('AB12CDEF', ''))
# compare_digest на не-ASCII бросает TypeError — проверяем, что не роняем сервис.
check('сверка токена: кириллица нет', not share.view_ok('AB12CDEF', 'токентокентокен'))
check('сверка токена: чужой заказ нет', not share.view_ok('ZZZZZZZZ', VIEW))

order_row = db.row('SELECT * FROM orders WHERE id=?', (oid,))
check('ссылка «поделиться» собирается с токеном',
      share.share_url(order_row, 'https://sprintergo.kg').endswith('/go/share/AB12CDEF?v=' + VIEW),
      share.share_url(order_row, 'https://sprintergo.kg'))
check('и по номеру заказа она прежняя',
      share.share_url('AB12CDEF', 'https://sprintergo.kg')
      == 'https://sprintergo.kg/go/share/AB12CDEF')

print('\n— что этим токеном можно, а что нельзя')
st, h, body = ask('/api/v1/orders/AB12CDEF?t=' + VIEW)
got = json.loads(body.decode('utf-8')) if st == 200 else {}
check('заказ по токену просмотра отдают', st == 200, str(st))
check('и помечают только для чтения', got.get('readonly') is True, str(got.get('readonly')))
check('телефона и квартиры в нём нет',
      '999888' not in body.decode('utf-8') and 'домофон' not in body.decode('utf-8'))
st, h, body = ask('/api/v1/orders/AB12CDEF/cancel', 'POST',
                  body={'t': VIEW, 'reason': 'передумал'})
check('отменить им нельзя — 403', st == 403, str(st))
st, h, body = ask('/api/v1/orders/AB12CDEF/rate', 'POST', body={'t': VIEW, 'rating': 1})
check('оценить им тоже нельзя', st == 403, str(st))
check('заказ остался в пути',
      db.value('SELECT status FROM orders WHERE id=?', (oid,), '') == 'in_transit')

# Перебирать тут нечего, но дешёвым перебор быть не должен: после предела
# страница просто становится обычной карточкой, а не отвечает ошибкой.
for _ in range(share.VIEW_PER_MIN + 5):
    ask('/share/AB12CDEF?v=' + VIEW)
st, h, body = ask('/share/AB12CDEF?v=' + VIEW)
check('перебор упирается в предел и отдаёт карточку',
      st == 200 and 'watch.js' not in body.decode('utf-8', 'replace'), str(st))

print('\n— соседям ничего не сломали')
st, h, body = ask('/go/../index.html') if False else ask('/index.html')
check('статика жива', st == 200 and b'<html' in body.lower(), str(st))
st, h, body = ask('/assets/css/tokens.css')
check('стили отдаются', st == 200 and b'--accent' in body, str(st))
st, h, body = ask('/api/v1/nothing')
check('чужой API не тронут', st == 404, str(st))

print('\n— папка данных чистая')
# Карточка собирается в память и отдаётся маршрутом. Ничего писать на диск ради
# превью не надо: папка данных — это то, что кладут в резервную копию.
data_files = sorted(os.listdir(DATA))
check('карточки не сорят в папке данных',
      not any(n == 'share' for n in data_files), str(data_files))

print('\n— нагрузка и параллель')
t0 = time.time()
codes = set()
for _ in range(30):
    codes.add(ask('/share/AB12CDEF.png')[0])
check('тридцать запросов подряд', codes == {200}, str(codes))
check('быстро', time.time() - t0 < 4.0, '%.2f с на 30 запросов' % (time.time() - t0))

# Второй заход должен попасть в кэш и прийти тем же ETag — иначе мессенджер
# будет перерисовывать картинку на каждый показ ссылки.
st1, h1, _ = ask('/share/AB12CDEF.png')
st2, h2, _ = ask('/share/AB12CDEF.png')
check('картинка кэшируется, а не пересобирается',
      st1 == st2 == 200 and h1.get('ETag') and h1.get('ETag') == h2.get('ETag'),
      '%s / %s' % (h1.get('ETag'), h2.get('ETag')))

import concurrent.futures as cf
with cf.ThreadPoolExecutor(8) as pool:
    got = list(pool.map(lambda i: ask('/share/AB12CDEF' + ('.png' if i % 2 else ''))[0], range(40)))
check('восемь потоков разом', set(got) == {200}, str(set(got)))

srv.shutdown()
srv.server_close()
shutil.rmtree(DATA, ignore_errors=True)
print('\nИТОГ:', 'всё сходится' if not bad else 'сломано: %s' % ', '.join(bad))
sys.exit(1 if bad else 0)
