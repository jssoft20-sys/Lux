#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Наполнение базы: администратор и, по желанию, демонстрационные данные.

Зачем нужно:
  · потерян пароль от панели — задать новый, не заглядывая в код;
  · развернули сервис и хочется посмотреть, как всё выглядит с живыми данными,
    прежде чем звать настоящих курьеров.

Примеры:
    python3 scripts/seed.py --email shef@firma.kg --password moy-parol-2026
    python3 scripts/seed.py --email shef@firma.kg --password moy-parol-2026 --demo
    python3 scripts/seed.py --demo
    python3 scripts/seed.py --demo --force        ещё одна порция заказов

Демо-данные — это четыре курьера и десяток заказов по Бишкеку. Курьеры входят
в приложение по адресам demo1@sprintergo.kg … demo4@sprintergo.kg с общим
паролем, который скрипт напечатает. Перед запуском в бой их надо удалить или
заблокировать в панели — скрипт про это напомнит.
"""
import argparse
import os
import random
import secrets
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from server import auth, db, geo, pricing, settings          # noqa: E402

DEMO_PASSWORD = 'demo-kurer-2026'
DEMO_DOMAIN = '@sprintergo.kg'

# Буквы номера заказа: без нуля, О, единицы, I и L — их путают при диктовке.
PID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

# Курьеры. Класс машины обязан совпадать с vehicle_class тарифа, иначе
# диспетчер никогда не предложит такому водителю ни одного заказа.
DEMO_COURIERS = [
    dict(email='demo1' + DEMO_DOMAIN, name='Азамат Осмонов', phone='+996700110011',
         vehicle_class='express', car_model='Honda Fit', car_plate='01KG777ABC',
         car_color='белый', body_w=120, body_d=150, body_h=90, capacity_kg=300,
         at=(42.8760, 74.6120), rating=(48, 10), done=10),
    dict(email='demo2' + DEMO_DOMAIN, name='Тилек Бакиров', phone='+996555220022',
         vehicle_class='van', car_model='Mercedes Sprinter', car_plate='01KG404BCD',
         car_color='серебристый', body_w=180, body_d=300, body_h=180, capacity_kg=1500,
         at=(42.8845, 74.6428), rating=(139, 29), done=29),
    dict(email='demo3' + DEMO_DOMAIN, name='Нурбек Сыдыков', phone='+996770330033',
         vehicle_class='truck', car_model='Hyundai Porter', car_plate='01KG112CDE',
         car_color='синий', body_w=180, body_d=380, body_h=180, capacity_kg=3000,
         at=(42.8663, 74.5731), rating=(72, 15), done=15),
    dict(email='demo4' + DEMO_DOMAIN, name='Эрлан Жумабеков', phone='+996502440044',
         vehicle_class='truck_big', car_model='Isuzu Forward', car_plate='01KG909DEF',
         car_color='белый', body_w=200, body_d=450, body_h=200, capacity_kg=5000,
         at=(42.9190, 74.6295), rating=(19, 4), done=4),
]

DEMO_CLIENTS = [
    dict(phone='+996700910001', name='Айгуль'),
    dict(phone='+996555910002', name='Максат'),
    dict(phone='+996770910003', name='Чолпон'),
    dict(phone='+996502910004', name='Данияр'),
]

# Точки по городу: адрес, широта, долгота. Все внутри рабочей зоны из настроек.
DEMO_PLACES = [
    ('Бишкек, Чуй 155 (ЦУМ)', 42.8760, 74.6122),
    ('Бишкек, Жибек Жолу 405', 42.8845, 74.6428),
    ('Бишкек, Кулатова 1 (Ошский рынок)', 42.8663, 74.5731),
    ('Бишкек, Кожевенная 1 (Дордой)', 42.9190, 74.6295),
    ('Бишкек, Ибраимова 115', 42.8712, 74.6248),
    ('Бишкек, Ахунбаева 190', 42.8258, 74.5651),
    ('Бишкек, Гагарина 2', 42.8583, 74.5504),
    ('Бишкек, Байтик Баатыра 45', 42.8302, 74.6003),
    ('Бишкек, Токомбаева 21', 42.8195, 74.5892),
    ('Бишкек, Медерова 40', 42.8801, 74.6390),
]

DEMO_COMMENTS = [
    'Диван и два кресла, лифт есть',
    'Коробки с посудой, аккуратнее',
    'Стройматериалы, разгрузка во дворе',
    'Переезд однокомнатной, вещи собраны',
    'Холодильник и стиральная машина',
    '',
]

# Сценарии заказов: статус и сколько часов назад заказ создан.
DEMO_SCENARIO = [
    ('done', 74), ('done', 51), ('done', 30), ('done', 21), ('done', 6),
    ('cancelled', 45), ('expired', 27),
    ('in_transit', 1), ('assigned', 0), ('searching', 0),
]


# ─────────────────────────────────────────────────────────────── общее

def open_db():
    path = os.environ.get('SG_DB') or os.path.join(
        os.environ.get('SG_DATA') or os.path.join(ROOT, 'data'), 'sprintergo.sqlite3')
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    db.init(path)
    settings.seed_catalog()
    return path


def public_id():
    for _ in range(80):
        pid = ''.join(secrets.choice(PID_ALPHABET) for _ in range(8))
        if not db.row('SELECT 1 FROM orders WHERE public_id=?', (pid,)):
            return pid
    raise RuntimeError('не удалось подобрать свободный номер заказа')


def event(order_id, at, actor, kind, data=None):
    db.insert('order_events', {
        'order_id': order_id, 'at': at, 'actor': actor,
        'type': kind, 'data': db.jdump(data) if data is not None else None,
    })


# ─────────────────────────────────────────────────────────────── администратор

def make_admin(email, password, name):
    """Создаём или обновляем администратора. Если человек с такой почтой уже есть
    и он курьер — превращать его в админа не станем, скорее всего это опечатка."""
    email = auth.normalize_email(email)
    if not email:
        return False, 'Адрес почты написан с ошибкой — проверьте его.'
    if len(str(password or '')) < 8:
        return False, 'Пароль должен быть не короче восьми символов.'

    exists = db.row('SELECT * FROM users WHERE email=?', (email,))
    if exists and exists['role'] != 'admin':
        return False, ('Почта %s уже занята курьером. Возьмите другой адрес '
                       'или поменяйте роль в панели.' % email)

    fields = {
        'role': 'admin', 'email': email, 'name': name or 'Администратор',
        'password_hash': auth.hash_password(password),
        'status': 'active', 'lang': 'ru',
    }
    if exists:
        db.update('users', fields, 'id=?', (exists['id'],))
        db.execute('DELETE FROM sessions WHERE user_id=?', (exists['id'],))
        return True, 'Пароль администратора %s обновлён, старые входы сброшены.' % email
    fields['created_at'] = db.now()
    db.insert('users', fields)
    return True, 'Администратор %s создан.' % email


# ─────────────────────────────────────────────────────────────── демо-курьеры

def make_couriers():
    """Четыре водителя на смене. Уже существующих не трогаем: у них могли
    появиться настоящие заказы, и перезаписывать статистику нечестно."""
    created = 0
    ids = {}
    now = db.now()
    for c in DEMO_COURIERS:
        user = db.row('SELECT * FROM users WHERE email=?', (c['email'],))
        if user:
            ids[c['email']] = user['id']
            continue
        uid = db.insert('users', {
            'role': 'courier', 'email': c['email'], 'phone': c['phone'],
            'name': c['name'], 'password_hash': auth.hash_password(DEMO_PASSWORD),
            'status': 'active', 'lang': 'ru',
            'created_at': now - random.randint(30, 400) * 86400,
        })
        rating_sum, rating_count = c['rating']
        db.insert('couriers', {
            'user_id': uid, 'vehicle_class': c['vehicle_class'],
            'car_model': c['car_model'], 'car_plate': c['car_plate'],
            'car_color': c['car_color'],
            'body_w': c['body_w'], 'body_d': c['body_d'], 'body_h': c['body_h'],
            'capacity_kg': c['capacity_kg'],
            'rating_sum': rating_sum, 'rating_count': rating_count,
            'orders_done': c['done'], 'orders_cancelled': random.randint(0, 2),
            'offers_sent': c['done'] * 2 + 3, 'offers_taken': c['done'],
            'priority': 0, 'online': 1, 'busy': 0,
            'lat': c['at'][0], 'lng': c['at'][1],
            'heading': random.randint(0, 359), 'speed': 0, 'geo_at': now,
            'balance': 0, 'note': 'Демонстрационный курьер, создан скриптом seed.py',
        })
        ids[c['email']] = uid
        created += 1
    return ids, created


def make_clients():
    ids = {}
    now = db.now()
    for c in DEMO_CLIENTS:
        db.execute('INSERT INTO clients(phone, name, lang, created_at) VALUES(?,?,?,?) '
                   'ON CONFLICT(phone) DO NOTHING',
                   (c['phone'], c['name'], 'ru', now - random.randint(5, 300) * 86400))
        ids[c['phone']] = db.value('SELECT id FROM clients WHERE phone=?', (c['phone'],))
    return ids


# ─────────────────────────────────────────────────────────────── демо-заказы

def pick_points(rnd, count=2):
    """Две-три точки по городу, обязательно разные и не рядом друг с другом."""
    places = rnd.sample(DEMO_PLACES, count)
    out = []
    for i, (addr, lat, lng) in enumerate(places):
        out.append({
            'addr': addr, 'lat': lat, 'lng': lng,
            'entrance': str(rnd.randint(1, 6)), 'flat': str(rnd.randint(1, 90)),
            'floor': str(rnd.randint(1, 9)), 'intercom': '',
            'comment': '', 'phone': '', 'name': '' if i else '',
        })
    return out


def make_order(rnd, tariff, courier_id, client, status, hours_ago):
    """Один заказ со всей денежной раскладкой. Цену считаем тем же кодом, что и
    боевой заказ, — иначе в демо будут красивые, но неправдоподобные суммы."""
    now = db.now()
    created = now - hours_ago * 3600 - rnd.randint(0, 3000)
    points = pick_points(rnd, 3 if rnd.random() < 0.25 else 2)
    coords = [(p['lat'], p['lng']) for p in points]
    distance_m = geo.road_distance(coords)
    duration_s = geo.estimate_duration(distance_m)

    loaders = rnd.choice([0, 0, tariff['loaders_included'], 2])
    extras = []
    if rnd.random() < 0.4:
        extras.append({'code': 'floor', 'qty': rnd.randint(2, 6)})
    if rnd.random() < 0.25:
        extras.append({'code': 'packing', 'qty': rnd.randint(3, 12)})

    q = pricing.quote(tariff, points=points, distance_m=distance_m,
                      duration_s=duration_s, loaders=loaders, extras=extras)
    fields = pricing.to_order_fields(q)
    fields.update({
        'public_id': public_id(), 'track_token': secrets.token_urlsafe(24),
        'client_id': client['id'], 'tariff_id': tariff['id'],
        'status': status, 'lang': 'ru',
        'points': db.jdump(points), 'distance_m': distance_m, 'duration_s': duration_s,
        'route': db.jdump([[p['lat'], p['lng']] for p in points]),
        'loaders': loaders, 'extras': db.jdump(extras),
        'payment_method': 'cash', 'payment_status': 'none',
        'comment': rnd.choice(DEMO_COMMENTS), 'created_at': created,
        'searching_at': created + 4,
    })

    assigned = created + rnd.randint(20, 120)
    if status in ('assigned', 'in_transit', 'done'):
        fields['courier_id'] = courier_id
        fields['assigned_at'] = assigned
    if status in ('in_transit', 'done'):
        fields['at_pickup_at'] = assigned + rnd.randint(300, 1100)
        fields['started_at'] = fields['at_pickup_at'] + rnd.randint(400, 1500)
    if status == 'done':
        fields['done_at'] = fields['started_at'] + duration_s + rnd.randint(200, 1200)
        fields['client_rating'] = rnd.choice([5, 5, 5, 4])
        fields['courier_rating'] = 5
    if status == 'cancelled':
        fields['cancelled_at'] = created + rnd.randint(60, 900)
        fields['cancelled_by'] = 'client'
        fields['cancel_reason'] = 'Планы поменялись'

    oid = db.insert('orders', fields)
    event(oid, created, 'client', 'created', {'source': 'seed'})
    event(oid, created + 4, 'system', 'search_started', None)
    if fields.get('assigned_at'):
        event(oid, fields['assigned_at'], 'courier:%s' % courier_id, 'assigned',
              {'courier_id': courier_id})
    if fields.get('at_pickup_at'):
        event(oid, fields['at_pickup_at'], 'courier:%s' % courier_id, 'status',
              {'status': 'at_pickup'})
    if fields.get('started_at'):
        event(oid, fields['started_at'], 'courier:%s' % courier_id, 'status',
              {'status': 'in_transit'})
    if fields.get('done_at'):
        event(oid, fields['done_at'], 'courier:%s' % courier_id, 'status',
              {'status': 'done'})
    if fields.get('cancelled_at'):
        event(oid, fields['cancelled_at'], 'client', 'cancelled',
              {'reason': fields['cancel_reason']})

    db.execute('UPDATE clients SET orders_count = orders_count + 1, last_order_at=? '
               'WHERE id=?', (created, client['id']))
    return fields


def make_demo(force=False):
    rnd = random.Random()
    lines = []

    courier_ids, created_couriers = make_couriers()
    lines.append('Курьеры: создано %d, всего демо-водителей %d.'
                 % (created_couriers, len(courier_ids)))

    clients = make_clients()
    client_rows = [db.row('SELECT * FROM clients WHERE id=?', (cid,))
                   for cid in clients.values()]

    have = db.value('SELECT COUNT(*) FROM orders WHERE client_id IN (%s)'
                    % ','.join('?' * len(clients)), tuple(clients.values()), 0)
    if have and not force:
        lines.append('Заказы уже есть (%d штук) — вторую порцию не добавляю. '
                     'Нужна ещё — запустите с ключом --force.' % have)
        return lines

    tariffs = db.rows('SELECT * FROM tariffs WHERE active=1 ORDER BY sort, id')
    if not tariffs:
        lines.append('В базе нет тарифов — заказы создать не из чего.')
        return lines
    by_class = {}
    for t in tariffs:
        by_class.setdefault(t['vehicle_class'], t)

    made = 0
    busy_courier = None
    for status, hours_ago in DEMO_SCENARIO:
        driver = rnd.choice(DEMO_COURIERS)
        tariff = by_class.get(driver['vehicle_class']) or rnd.choice(tariffs)
        courier_id = courier_ids.get(driver['email'])
        if not courier_id:
            continue
        client = rnd.choice(client_rows)
        order = make_order(rnd, tariff, courier_id, client, status, hours_ago)
        made += 1
        if status == 'in_transit':
            busy_courier = courier_id
        if status == 'done':
            db.execute('UPDATE couriers SET orders_done = orders_done + 1, '
                       'rating_sum = rating_sum + ?, rating_count = rating_count + 1 '
                       'WHERE user_id=?', (order.get('client_rating') or 5, courier_id))

    if busy_courier:
        db.execute('UPDATE couriers SET busy=1 WHERE user_id=?', (busy_courier,))

    lines.append('Заказы: добавлено %d — от завершённых до тех, что ищут машину.' % made)
    lines.append('Пароль всех демо-курьеров: %s' % DEMO_PASSWORD)
    lines.append('Перед боевым запуском удалите или заблокируйте их в панели.')
    return lines


# ─────────────────────────────────────────────────────────────── командная строка

def main(argv=None):
    p = argparse.ArgumentParser(
        prog='seed.py', description='Наполнение базы Sprinter Go',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='Примеры:\n'
               '  python3 scripts/seed.py --email shef@firma.kg --password moy-parol\n'
               '  python3 scripts/seed.py --demo\n')
    p.add_argument('--email', help='почта администратора')
    p.add_argument('--password', help='его пароль, не короче восьми символов')
    p.add_argument('--name', default='Администратор', help='имя администратора')
    p.add_argument('--demo', action='store_true',
                   help='добавить демо-курьеров и заказы для проверки интерфейса')
    p.add_argument('--force', action='store_true',
                   help='с --demo: добавить заказы, даже если они уже есть')
    args = p.parse_args(argv)

    if not args.email and not args.demo:
        p.print_help()
        print('\nНичего не сделано: укажите --email с --password либо --demo.')
        return 2

    path = open_db()
    print('База: %s' % path)

    problems = 0
    if args.email:
        if not args.password:
            print('Нужен ещё --password: без него администратора не завести.')
            return 2
        ok, message = make_admin(args.email, args.password, args.name)
        print(message)
        if not ok:
            problems += 1

    if args.demo:
        for line in make_demo(force=args.force):
            print(line)

    if not problems:
        print('Готово. Панель управления — по адресу /admin.')
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
