#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Проверка ядра: роутер, отдача статики, шина событий, ограничитель частоты, база."""
import os, sys, tempfile, threading, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import core, db, settings   # noqa: E402

ok, bad = 0, []


def t(name, cond, detail=''):
    global ok
    if cond:
        ok += 1; print(f'  \033[32m✓\033[0m {name}')
    else:
        bad.append((name, detail)); print(f'  \033[31m✗\033[0m {name}  {detail}')


print('\n\033[1mРоутер\033[0m')
r = core.Router()
r.add('GET', '/api/v1/orders/{pid}', lambda ctx, pid: pid)
r.add('POST', '/api/v1/orders', lambda ctx: 'created')
fn, p = r.match('GET', '/api/v1/orders/AB12CD')
t('параметр пути разбирается', p == {'pid': 'AB12CD'}, str(p))
fn, p = r.match('POST', '/api/v1/orders')
t('точный путь находится', fn is not None)
fn, p = r.match('GET', '/api/v1/нет')
t('неизвестный путь не находится', fn is None)
try:
    r.match('DELETE', '/api/v1/orders')
    t('чужой метод даёт 405', False, 'исключения не было')
except core.ApiError as e:
    t('чужой метод даёт 405', e.status == 405)
fn, p = r.match('GET', '/api/v1/orders/a%2Fb')
t('процентное кодирование раскрывается', p == {'pid': 'a/b'}, str(p))
fn, p = r.match('GET', '/api/v1/orders/a/b')
t('слеш не проглатывается параметром', fn is None)

print('\n\033[1mОтдача статики\033[0m')
root = tempfile.mkdtemp()
os.makedirs(os.path.join(root, 'assets'), exist_ok=True)
open(os.path.join(root, 'index.html'), 'w').write('<h1>привет</h1>' * 200)
open(os.path.join(root, 'assets', 'a.css'), 'w').write('body{color:red}')
secret = os.path.join(os.path.dirname(root), 'секрет.txt')
open(secret, 'w').write('нельзя читать')
st = core.Static(root)
t('обычный файл находится', st.resolve('/assets/a.css') is not None)
t('корень даёт index.html', (st.resolve('/') or '').endswith('index.html'))
t('выход через .. закрыт', st.resolve('/../секрет.txt') is None, str(st.resolve('/../секрет.txt')))
t('выход через вложенные .. закрыт', st.resolve('/assets/../../секрет.txt') is None)
t('абсолютный путь не пускает наружу', st.resolve('//etc/passwd') is None,
  str(st.resolve('//etc/passwd')))
raw, gz, ctype, etag, cache = st.read(os.path.join(root, 'index.html'))
t('крупный html сжимается', gz is not None and len(gz) < len(raw))
t('тип с кодировкой', 'charset=utf-8' in ctype, ctype)
t('у html кэш no-cache', cache == 'no-cache', cache)
_, _, _, _, cache2 = st.read(os.path.join(root, 'assets', 'a.css'))
t('у css свой кэш', 'max-age' in cache2, cache2)

print('\n\033[1mШина событий\033[0m')
hub = core.Hub()
s1 = hub.subscribe(['order:AB', 'admin'])
s2 = hub.subscribe(['admin'])
hub.publish('order:AB', 'order', {'x': 1})
hub.publish('admin', 'ping', {'y': 2})
got1, alive1 = s1.wait(0.1)
got2, _ = s2.wait(0.1)
t('подписчик получает свои темы', len(got1) == 2, str(got1))
t('чужая тема не приходит', len(got2) == 1 and got2[0][0] == 'ping', str(got2))
t('счётчик подписчиков верен', hub.count('admin') == 2, str(hub.count('admin')))
hub.unsubscribe(s1)
t('после отписки тема пустеет', hub.count('order:AB') == 0)
s3 = hub.subscribe(['flood'])
for i in range(core.Hub.MAX_QUEUE + 10):
    hub.publish('flood', 'e', {'i': i})
items, alive3 = s3.wait(0.05)
t('медленный клиент отцепляется, а не копит память', not alive3)
hub.unsubscribe(s3)

wake = []
s4 = hub.subscribe(['late'])
th = threading.Thread(target=lambda: wake.append(s4.wait(2.0)), daemon=True)
th.start(); time.sleep(0.15)
hub.publish('late', 'now', {})
th.join(1.0)
t('ожидающий поток будится сразу', bool(wake) and len(wake[0][0]) == 1, str(wake))
hub.unsubscribe(s4)

print('\n\033[1mОграничитель частоты\033[0m')
lim = core.RateLimit()
res = [lim.check('ip1', 3, 60) for _ in range(5)]
t('пропускает ровно лимит', res == [True, True, True, False, False], str(res))
t('другой ключ не задет', lim.check('ip2', 3, 60) is True)
t('короткое окно отпускает', all(lim.check('ip3', 2, 0.2) for _ in range(2))
  and not lim.check('ip3', 2, 0.2) and (time.sleep(0.25) or lim.check('ip3', 2, 0.2)))

print('\n\033[1mБаза\033[0m')
dbfile = os.path.join(tempfile.mkdtemp(), 'test.sqlite3')
db.init(dbfile)
settings.invalidate()
settings.seed_catalog()
t('тарифы засеяны', len(db.rows('SELECT * FROM tariffs')) == 4)
t('допуслуги засеяны', len(db.rows('SELECT * FROM extras')) == 7)
settings.seed_catalog()
t('повторный засев не плодит дубли', len(db.rows('SELECT * FROM tariffs')) == 4)
uid = db.insert('users', {'role': 'courier', 'email': 'a@b.kg', 'name': 'Тест',
                          'status': 'pending', 'created_at': db.now()})
t('вставка возвращает id', uid > 0)
t('строка читается', db.row('SELECT * FROM users WHERE id=?', (uid,))['email'] == 'a@b.kg')
db.update('users', {'status': 'active'}, 'id=?', (uid,))
t('обновление применилось', db.value('SELECT status FROM users WHERE id=?', (uid,)) == 'active')
try:
    with db.tx():
        db.execute("UPDATE users SET name='откат' WHERE id=?", (uid,))
        raise RuntimeError('падаем нарочно')
except RuntimeError:
    pass
t('транзакция откатывается', db.value('SELECT name FROM users WHERE id=?', (uid,)) == 'Тест',
  db.value('SELECT name FROM users WHERE id=?', (uid,)))
settings.put('commission.value', 18)
t('настройка сохраняется', settings.get_int('commission.value') == 18)
settings.invalidate()
t('настройка переживает сброс кэша', settings.get_int('commission.value') == 18)
t('значение по умолчанию отдаётся', settings.get('service.city') == 'Бишкек')
t('деньги в настройках целые', isinstance(settings.get_int('commission.min'), int))

# заказ для проверки внешних ключей и параллельной записи
oid = db.insert('orders', {'public_id': 'TEST0001', 'track_token': 'tok', 'points': '[]',
                           'status': 'draft', 'created_at': db.now()})
try:
    db.insert('order_events', {'order_id': 999999, 'at': db.now(), 'actor': 'x',
                               'type': 'test', 'data': '{}'})
    t('внешний ключ защищает от сирот', False, 'вставка прошла, а не должна была')
except Exception:
    t('внешний ключ защищает от сирот', True)

# параллельная запись из нескольких потоков не должна падать
errs = []
def writer(n):
    try:
        for i in range(20):
            db.insert('order_events', {'order_id': oid, 'at': db.now(), 'actor': f'p{n}',
                                       'type': 'test', 'data': '{}'})
    except Exception as e:
        errs.append(str(e))
ths = [threading.Thread(target=writer, args=(i,)) for i in range(6)]
[x.start() for x in ths]; [x.join() for x in ths]
t('параллельная запись из 6 потоков без ошибок', not errs, str(errs[:2]))
t('все записи на месте', db.value('SELECT COUNT(*) FROM order_events') == 120,
  str(db.value('SELECT COUNT(*) FROM order_events')))

print(f'\n\033[1mИтог ядра:\033[0m пройдено {ok}, провалено {len(bad)}')
for n, d in bad:
    print(f'  · {n}  {d}')
sys.exit(1 if bad else 0)
