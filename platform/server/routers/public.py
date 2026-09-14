# -*- coding: utf-8 -*-
"""Клиентская часть API: настройки, адреса, расчёт цены, заказ и его отслеживание.

Клиент не заводит аккаунт и не вводит пароль. Заказ живёт по паре «публичный
номер + токен отслеживания»: номер короткий, его удобно продиктовать по телефону,
а токен длинный и случайный — он и есть ключ от заказа.

Три правила, которые здесь нарушать нельзя:

1. Цену считает сервер. Что браузер прислал в price_total — не имеет значения,
   стоимость собирается заново из тарифов и допуслуг в базе.
2. Чужой заказ не показываем. Токен сверяем через hmac.compare_digest, иначе по
   времени ответа его можно подобрать посимвольно.
3. Наружу не уходят внутренние идентификаторы людей и телефон курьера до того,
   как он взял заказ. Отказавшись от десятка предложений, базу контактов собрать
   не получится.
"""
import hmac
import json
import secrets
import sqlite3
import time

from .. import (auth, bonus, db, dispatch, geo, i18n_server as i18n, payments,
                pricing, settings)
from ..core import (HUB, LIMIT, ApiError, Router, bad, conflict, forbidden, log,
                    not_found, too_many)

API = '/api/v1'
router = Router()

# Буквы, которые не путаются в рукописи и в телефонном разговоре: без 0, O, 1, I, L.
PID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
PID_LEN = 8

# Заказы, которые ещё не закрыты: по ним считаем лимит «три в работе на телефон».
LIVE_STATUSES = ('draft', 'searching', 'assigned', 'to_pickup',
                 'at_pickup', 'in_transit', 'at_dropoff')
MAX_LIVE_ORDERS = 3

# Отменить из приложения можно, пока машина не поехала с грузом.
CANCELLABLE = ('draft', 'searching', 'assigned', 'to_pickup', 'at_pickup')

# Статусы, в которых клиент уже видит карточку курьера.
WITH_COURIER = ('assigned', 'to_pickup', 'at_pickup', 'in_transit', 'at_dropoff', 'done')

# Пока заказ не в работе, телефон курьера клиенту не нужен — и после закрытия тоже.
WITH_COURIER_PHONE = ('assigned', 'to_pickup', 'at_pickup', 'in_transit', 'at_dropoff')

SUGGEST_PER_MIN = 30        # подсказок адреса с одного адреса в минуту
GEO_PER_MIN = 60            # обратный геокодер и маршруты
QUOTE_PER_MIN = 90          # расчёт цены дёргается на каждое движение ползунка
ORDERS_PER_HOUR = 10

STREAM_MAX_S = 3600         # час на одно соединение, потом браузер переподключится
STREAM_PING_S = 20


# ─────────────────────────────────────────────────────────────── свои фразы

# Тексты, которых нет в общем словаре: они нужны только на этих экранах.
# Первый вариант — русский, второй — кыргызский.
SAY = {
    'cancel.free': ('Заказ отменён. Платить ничего не нужно.',
                    'Заказ жокко чыгарылды. Эч нерсе төлөөнүн кереги жок.'),
    'cancel.fee': ('Заказ отменён. Курьер уже выехал, поэтому удерживается {fee}.',
                   'Заказ жокко чыгарылды. Курьер жолго чыгып калгандыктан {fee} кармалат.'),
    'cancel.late': ('Груз уже в пути, из приложения такой заказ не отменить. '
                    'Позвоните {phone}, разберёмся.',
                    'Жүк жолдо, мындай заказды тиркемеден жокко чыгарууга болбойт. '
                    '{phone} номерине чалыңыз, чечебиз.'),
    'cancel.closed': ('Этот заказ уже закрыт.', 'Бул заказ мурун эле жабылган.'),
    'order.limit': ('На этом номере уже три заказа в работе. Завершите или отмените один — '
                    'и оформим следующий.',
                    'Бул номерде үч заказ иштеп жатат. Бирин аяктаңыз же жокко чыгарыңыз — '
                    'анан кийинкисин каттайбыз.'),
    'order.blocked': ('С этого номера заказы не принимаются. Позвоните {phone}, разберёмся.',
                      'Бул номерден заказ кабыл алынбайт. {phone} номерине чалыңыз, чечебиз.'),
    'order.too_often': ('С одного устройства можно оформить не больше десяти заказов в час.',
                        'Бир түзмөктөн саатына он заказдан ашык каттоого болбойт.'),
    'geo.too_often': ('Слишком много запросов подряд. Подождите минуту.',
                      'Өтө көп сурам жөнөтүлдү. Бир мүнөт күтө туруңуз.'),
    'points.few': ('Нужны адрес подачи и адрес доставки.',
                   'Жүктөө жана жеткирүү даректери керек.'),
    'points.many': ('Больше {n} точек в один заказ не помещается.',
                    'Бир заказга {n} чекиттен ашык батпайт.'),
    'points.nocoord': ('У адреса «{addr}» нет координат: выберите его из подсказки '
                       'или отметьте точку на карте.',
                       '«{addr}» дарегинин координаталары жок: тизмеден тандаңыз '
                       'же картадан белгилеңиз.'),
    'track.wrong': ('Ссылка на заказ не подходит. Откройте заказ по своей ссылке '
                    'или позвоните {phone}.',
                    'Заказдын шилтемеси туура келбейт. Өз шилтемеңиз менен ачыңыз '
                    'же {phone} номерине чалыңыз.'),
    'rate.not_done': ('Оценить можно только завершённый заказ.',
                      'Бааны аяктаган заказга гана коюуга болот.'),
    'rate.twice': ('Вы уже оценили этот заказ.', 'Бул заказды буга чейин баалагансыз.'),
    'rate.thanks': ('Спасибо! Курьер увидит вашу оценку.', 'Рахмат! Курьер бааңызды көрөт.'),
    'rate.range': ('Оценка ставится от одной звезды до пяти.',
                   'Баа бир жылдыздан беш жылдызга чейин коюлат.'),
    'pay.done': ('Заказ уже оплачен.', 'Заказ мурун эле төлөнгөн.'),
    'pay.closed': ('Заказ закрыт, оплачивать нечего.', 'Заказ жабылган, төлөй турган эч нерсе жок.'),
    'id.busy': ('Не получилось завести номер заказа. Попробуйте ещё раз.',
                'Заказдын номерин ачуу мүмкүн болбоду. Кайра аракет кылыңыз.'),
}


def say(key, lang='ru', **vars):
    """Фраза из своего словарика с подстановкой. Телефон поддержки подставляется сам."""
    ru, ky = SAY[key]
    text = ky if i18n.norm_lang(lang) == 'ky' else ru
    data = {'phone': settings.get('service.phone', '')}
    data.update(vars)
    try:
        return text.format(**data)
    except (KeyError, IndexError, ValueError):
        return text


# ─────────────────────────────────────────────────────────────── мелкие помощники

def _lang(ctx, fallback='ru'):
    raw = ctx.q('lang')
    if not raw and ctx.method in ('POST', 'PUT', 'PATCH'):
        try:
            raw = ctx.json.get('lang')
        except ApiError:
            raw = None
    if not raw:
        raw = (ctx.header('Accept-Language') or '')[:2]
    return i18n.norm_lang(raw or fallback)


def _num(v):
    """Число из чего угодно. Не число — None, а не исключение: подсказкам координаты
    не обязательны, и падать из-за пустой строки они не должны."""
    if v is None or v == '':
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v, default=0):
    """Целое из чего угодно. Кривое значение — это не повод падать: клиент мог
    прислать строку, None или вовсе выдумать поле."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _str(v, limit):
    s = str(v).strip() if v is not None else ''
    return s[:limit]


def _event(order_id, actor, kind, data=None):
    db.insert('order_events', {
        'order_id': order_id, 'at': db.now(), 'actor': actor,
        'type': kind, 'data': db.jdump(data) if data is not None else None,
    })


def _publish(order, extra=None):
    """Одно изменение заказа — событие клиенту в его тему и событие админке на карту."""
    state = dispatch.order_state(order)
    if extra:
        state.update(extra)
    HUB.publish('order:%s' % order['public_id'], 'order', state)
    HUB.publish('admin', 'order', dict(state, id=order['id'],
                                       courier_id=order.get('courier_id')))


# ─────────────────────────────────────────────────────────────── конфигурация

TARIFF_FIELDS = ('id', 'code', 'name_ru', 'name_ky', 'desc_ru', 'desc_ky',
                 'vehicle_class', 'icon', 'base_price', 'included_km', 'included_min',
                 'per_km', 'per_min', 'min_price', 'waiting_free_min', 'waiting_per_min',
                 'loaders_included', 'loader_hour_price', 'loader_min_hours',
                 'body_w', 'body_d', 'body_h', 'capacity_kg', 'sort')

EXTRA_FIELDS = ('id', 'code', 'name_ru', 'name_ky', 'kind', 'price',
                'unit_ru', 'unit_ky', 'min_qty', 'max_qty', 'step', 'sort')


def tariff_view(row):
    out = {k: row.get(k) for k in TARIFF_FIELDS}
    out['max_loaders'] = 8
    return out


def extra_view(row):
    out = {k: row.get(k) for k in EXTRA_FIELDS}
    # null в tariff_ids значит «услуга подходит ко всем тарифам»
    out['tariff_ids'] = db.jload(row.get('tariff_ids'), None)
    return out


@router.get(API + '/config')
def config(ctx):
    """Всё, что приложению нужно знать до первого экрана: тарифы, допуслуги, карта."""
    data = settings.public()
    data['tariffs'] = [tariff_view(r) for r in db.rows(
        'SELECT * FROM tariffs WHERE active=1 ORDER BY sort, id')]
    data['extras'] = [extra_view(r) for r in db.rows(
        'SELECT * FROM extras WHERE active=1 ORDER BY sort, id')]
    data['langs'] = list(i18n.LANGS)
    data['now'] = db.now()
    return data


# ─────────────────────────────────────────────────────────────── адреса и маршрут

@router.post(API + '/geo/suggest')
def geo_suggest(ctx):
    """Подсказки адреса. Частоту режем на входе: за нами стоит Nominatim с его
    правилом «один запрос в секунду», и злоупотребление здесь бьёт по всем сразу."""
    if not LIMIT.check('sg:' + ctx.ip, SUGGEST_PER_MIN, 60):
        too_many(say('geo.too_often', _lang(ctx)))
    q = _str(ctx.json.get('q'), 120)
    if len(q) < 2:
        return []
    limit = ctx.field('limit', int, default=8) or 8
    return geo.suggest(q, _num(ctx.json.get('lat')), _num(ctx.json.get('lng')),
                       limit=max(1, min(limit, 10)))


@router.post(API + '/geo/reverse')
def geo_reverse(ctx):
    """Адрес точки, которую поставили пальцем на карте."""
    if not LIMIT.check('rv:' + ctx.ip, GEO_PER_MIN, 60):
        too_many(say('geo.too_often', _lang(ctx)))
    lat, lng = _num(ctx.json.get('lat')), _num(ctx.json.get('lng'))
    if lat is None or lng is None:
        bad('Не переданы координаты точки', 'bad_point')
    return geo.reverse(lat, lng)


@router.post(API + '/geo/route')
def geo_route(ctx):
    """Линия маршрута, расстояние и время. Нужны и карте, и расчёту цены."""
    if not LIMIT.check('rt:' + ctx.ip, GEO_PER_MIN, 60):
        too_many(say('geo.too_often', _lang(ctx)))
    pts = geo.clean_points(ctx.field('points', list) or [])
    limit = max(2, settings.get_int('order.max_points', 5))
    if len(pts) > limit:
        bad(say('points.many', _lang(ctx), n=limit), 'too_many_points')
    if len(pts) < 2:
        bad(say('points.few', _lang(ctx)), 'few_points')
    return geo.route(pts)


# ─────────────────────────────────────────────────────────────── расчёт цены

def _clean_extras(raw):
    """Допуслуги от клиента: только код и количество. Цены приходят из базы,
    присланные клиентом суммы не смотрим вовсе."""
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:20]:
        if isinstance(item, str):
            code, qty = item.strip()[:40], 1.0
        elif isinstance(item, dict):
            code = _str(item.get('code'), 40)
            qty = _num(item.get('qty'))
            qty = 1.0 if qty is None or qty <= 0 else qty
        else:
            continue
        if code:
            out.append({'code': code, 'qty': qty})
    return out


def _quote_from(ctx, tariff, points):
    """Расчёт по телу запроса. Расстояние берём своё — по тем же точкам, что
    и в заказе, иначе цена на экране и цена в чеке разойдутся."""
    if len(points) >= 2:
        r = geo.route(points)
        distance_m, duration_s = r['distance_m'], r['duration_s']
    else:
        distance_m = duration_s = 0
    loaders = ctx.field('loaders', int, default=0) or 0
    hours = _num(ctx.json.get('hours'))
    return pricing.quote(
        tariff, points=points, distance_m=distance_m, duration_s=duration_s,
        loaders=max(0, min(loaders, 8)), extras=_clean_extras(ctx.json.get('extras')),
        hours=hours if hours and hours > 0 else None)


@router.post(API + '/price/quote')
def price_quote(ctx):
    """Стоимость без создания заказа: тот же расчёт, что уйдёт в заказ."""
    if not LIMIT.check('pq:' + ctx.ip, QUOTE_PER_MIN, 60):
        too_many(say('geo.too_often', _lang(ctx)))
    tariff = pricing.load_tariff(ctx.json.get('tariff_id') or ctx.json.get('tariff'))
    limit = max(2, settings.get_int('order.max_points', 5))
    pts = geo.clean_points(ctx.field('points', list) or [])[:limit]
    return _quote_from(ctx, tariff, pts)


# ─────────────────────────────────────────────────────────────── создание заказа

def new_public_id():
    """Свободный номер заказа. Длину наращиваем, если вдруг не повезло с совпадением —
    так цикл всегда заканчивается номером, а не отказом."""
    size = PID_LEN
    for attempt in range(1, 61):
        pid = ''.join(secrets.choice(PID_ALPHABET) for _ in range(size))
        if not db.row('SELECT 1 FROM orders WHERE public_id=?', (pid,)):
            return pid
        if attempt % 20 == 0:
            size += 2
    raise ApiError('id_busy', say('id.busy'), 503)


def _order_points(ctx, lang):
    """Точки заказа: чистим, проверяем координаты и зону работы сервиса."""
    raw = ctx.field('points', list)
    if not raw:
        bad(say('points.few', lang), 'few_points')
    limit = max(2, settings.get_int('order.max_points', 5))
    if len(raw) > limit:
        bad(say('points.many', lang, n=limit), 'too_many_points')

    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        addr = _str(item.get('addr') or item.get('title'), 200)
        ll = geo.clean_points([item])
        if not ll:
            bad(say('points.nocoord', lang, addr=addr or '—'), 'bad_point')
        lat, lng = ll[0]
        if not geo.bbox_contains(lat, lng):
            bad(i18n.error_text('point_outside', lang), 'point_outside')
        phone = _str(item.get('phone'), 32)
        if phone:
            phone = auth.normalize_phone(phone) or phone
        out.append({
            'addr': addr, 'lat': lat, 'lng': lng,
            'entrance': _str(item.get('entrance'), 16),
            'flat': _str(item.get('flat'), 16),
            'floor': _str(item.get('floor'), 16),
            'intercom': _str(item.get('intercom'), 32),
            'comment': _str(item.get('comment'), 300),
            'phone': phone,
            'name': _str(item.get('name'), 80),
            # Надбавку считаем по строке допуслуги, но флажок у точки хранить надо
            # отдельно: без него курьер видит сумму и не понимает, к какой двери
            # подниматься, а к какой машину можно не покидать.
            'door_to_door': bool(item.get('door_to_door')),
            'lift': _str(item.get('lift'), 8),
        })

    if len(out) < 2:
        bad(say('points.few', lang), 'few_points')
    # Подача и доставка в одной точке — это почти всегда промах по карте.
    if len(out) == 2 and geo.haversine((out[0]['lat'], out[0]['lng']),
                                       (out[1]['lat'], out[1]['lng'])) < 20:
        bad(i18n.error_text('same_points', lang), 'same_points')
    return out


def _client_for(phone, name, lang):
    """Клиент по телефону: находим или заводим. Вставка с ON CONFLICT, потому что
    два заказа с одного номера могут прийти в одну секунду."""
    db.execute('INSERT INTO clients(phone, name, lang, created_at) VALUES(?,?,?,?) '
               'ON CONFLICT(phone) DO NOTHING', (phone, name or None, lang, db.now()))
    client = db.row('SELECT * FROM clients WHERE phone=?', (phone,))
    patch = {}
    if name and name != (client.get('name') or ''):
        patch['name'] = name
    if lang != client.get('lang'):
        patch['lang'] = lang
    if patch:
        db.update('clients', patch, 'id=?', (client['id'],))
        client.update(patch)
    return client


def _insert_order(fields):
    """Запись заказа с уникальным номером. Совпадение номера в двух потоках почти
    невозможно, но обработать его дешевле, чем потом объяснять пятисотку."""
    for _ in range(5):
        data = dict(fields)
        data['public_id'] = new_public_id()
        data['track_token'] = secrets.token_urlsafe(24)
        try:
            oid = db.insert('orders', data)
        except sqlite3.IntegrityError:
            continue
        return db.row('SELECT * FROM orders WHERE id=?', (oid,))
    raise ApiError('id_busy', say('id.busy'), 503)


def _start_search(order):
    """Отправляем заказ диспетчеру. Если тот упёрся — заказ остаётся в базе,
    а человек видит причину, а не пустой экран."""
    try:
        return dispatch.start_search(order['id'])
    except ApiError as e:
        log('заказ', order['public_id'], '— поиск не стартовал:', e.message)
        return {'status': order['status'], 'sent': 0, 'error': e.message}


@router.post(API + '/orders')
def create_order(ctx):
    """Оформление заказа: проверить, пересчитать, сохранить, отправить на поиск машины."""
    lang = _lang(ctx)
    if not LIMIT.check('or:' + ctx.ip, ORDERS_PER_HOUR, 3600):
        too_many(say('order.too_often', lang))

    phone = auth.normalize_phone(ctx.need('phone', str, 32))
    if not phone or sum(c.isdigit() for c in phone) < 9:
        bad(i18n.error_text('bad_phone', lang), 'bad_phone')
    name = ctx.field('name', str, 80) or ''
    tariff = pricing.load_tariff(ctx.json.get('tariff_id') or ctx.json.get('tariff'))
    points = _order_points(ctx, lang)
    loaders = max(0, min(ctx.field('loaders', int, default=0) or 0, 8))
    extras = _clean_extras(ctx.json.get('extras'))
    comment = ctx.field('comment', str, 500) or ''
    hours = _num(ctx.json.get('hours'))

    client = _client_for(phone, name, lang)
    if client.get('blocked'):
        forbidden(say('order.blocked', lang))
    live = db.value('SELECT COUNT(*) FROM orders WHERE client_id=? AND status IN (%s)'
                    % ','.join('?' * len(LIVE_STATUSES)),
                    (client['id'],) + LIVE_STATUSES, 0)
    if live >= MAX_LIVE_ORDERS:
        conflict(say('order.limit', lang))

    coords = [(p['lat'], p['lng']) for p in points]
    route = geo.route(coords)
    # Сколько человек просит списать бонусами. true — «всё, что можно»;
    # число — конкретная сумма, но сервер всё равно урежет её до потолка.
    want_bonus = ctx.json.get('bonus_spend')
    want_bonus = True if want_bonus is True else max(0, _int(want_bonus))
    # Цену считаем сами: присланная клиентом сумма в расчёте не участвует.
    # Бонусы тоже: сколько их есть и сколько можно списать, знает только сервер.
    price = pricing.quote(tariff, points=coords, distance_m=route['distance_m'],
                          duration_s=route['duration_s'], loaders=loaders, extras=extras,
                          hours=hours if hours and hours > 0 else None,
                          bonus_spend=want_bonus, client_id=client['id'])

    fields = {
        'client_id': client['id'], 'tariff_id': tariff['id'], 'status': 'draft', 'lang': lang,
        'points': db.jdump(points), 'route': db.jdump(route['route']),
        'distance_m': route['distance_m'], 'duration_s': route['duration_s'],
        'loaders': loaders, 'extras': db.jdump(extras),
        'comment': comment or None, 'created_at': db.now(),
        'payment_method': 'cash', 'payment_status': 'none',
    }
    fields.update(pricing.to_order_fields(price))
    # Заказ, запись о нём и счётчик клиента — одной транзакцией: заказ без события
    # в ленте потом не объяснить ни клиенту, ни себе.
    with db.tx():
        order = _insert_order(fields)
        _event(order['id'], 'client', 'created', {
            'price_total': order['price_total'], 'distance_m': order['distance_m'],
            'tariff': tariff.get('code'), 'loaders': loaders,
            'extras': [e['code'] for e in extras], 'ip': ctx.ip,
        })
        db.execute('UPDATE clients SET orders_count = orders_count + 1, last_order_at=? '
                   'WHERE id=?', (order['created_at'], client['id']))
        # Списываем ровно столько, сколько насчитал сервер. Если бонусы за это
        # время потратили в другом окне, spend() спишет меньше и вернёт сколько.
        spent = _int(price.get('bonus_spent'))
        if spent > 0:
            bonus.spend(client['id'], spent, order_id=order['id'],
                        order_total=order['price_total'])

    pay = None
    if payments.enabled():
        pay = payments.init_payment(order, lang=lang)
        order = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))

    search = None
    if pay and pay.get('url'):
        # Ждём оплату: поиск машины запустит колбэк платёжного шлюза.
        _publish(order)
    else:
        search = _start_search(order)
        order = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))

    log('заказ', order['public_id'], 'создан:', route['distance_m'], 'м,',
        i18n.fmt_money(order['price_total']), '·', phone)
    return {
        'public_id': order['public_id'],
        'track_token': order['track_token'],
        'order': order_view(order, lang),
        'price': price,
        'payment': pay,
        'search': search,
    }, 201


# ─────────────────────────────────────────────────────────────── чтение заказа

def _find(pid):
    order = db.row('SELECT * FROM orders WHERE public_id=?', (str(pid or '').strip().upper(),))
    if not order:
        not_found(i18n.error_text('order_not_found'))
    return order


def _track_token(ctx):
    tok = ctx.q('t') or ctx.q('token') or ctx.header('X-Track-Token')
    if not tok and ctx.method in ('POST', 'PUT', 'PATCH'):
        try:
            body = ctx.json
        except ApiError:
            body = {}
        tok = body.get('t') or body.get('track_token')
    return str(tok or '').strip()


def _check_token(ctx, order):
    """Сверка токена отслеживания. compare_digest — чтобы время ответа не подсказывало,
    сколько символов угадано.

    Сравниваем байты, а не строки: compare_digest падает с TypeError на любой
    строке вне ASCII, и подделанный токен с кириллицей ронял бы запрос в 500
    вместо честного отказа."""
    given = _track_token(ctx)
    real = str(order.get('track_token') or '')
    if not given or not real:
        forbidden(say('track.wrong', order.get('lang') or 'ru'))
    if not hmac.compare_digest(given.encode('utf-8'), real.encode('utf-8')):
        forbidden(say('track.wrong', order.get('lang') or 'ru'))


def courier_view(order):
    """Карточка курьера для клиента: без внутреннего id, а телефон — только пока
    заказ в работе."""
    if not order.get('courier_id') or order.get('status') not in WITH_COURIER:
        return None
    card = dispatch.courier_card(order['courier_id'])
    if not card:
        return None
    card.pop('id', None)
    if order.get('status') not in WITH_COURIER_PHONE:
        card.pop('phone', None)
    return card


def _cancel_free_until(order):
    """До какого момента отмена бесплатна. Пока курьера нет — отмена свободна всегда."""
    if not order.get('courier_id'):
        return None
    since = order.get('assigned_at') or order.get('created_at') or 0
    return int(since) + max(0, settings.get_int('order.cancel_free_s', 180))


def order_view(order, lang=None):
    """Заказ глазами клиента."""
    lang = i18n.norm_lang(lang or order.get('lang'))
    tariff = None
    if order.get('tariff_id'):
        tariff = db.row('SELECT id, code, name_ru, name_ky, icon, vehicle_class, '
                        '       capacity_kg, body_w, body_d, body_h '
                        'FROM tariffs WHERE id=?', (order['tariff_id'],))
    free_until = _cancel_free_until(order)
    return {
        'public_id': order['public_id'],
        'status': order['status'],
        'status_name': i18n.status_name(order['status'], lang),
        'lang': order.get('lang', 'ru'),
        'tariff': tariff,
        'points': db.jload(order.get('points'), []) or [],
        'route': db.jload(order.get('route'), []) or [],
        'distance_m': order.get('distance_m', 0),
        'duration_s': order.get('duration_s', 0),
        'loaders': order.get('loaders', 0),
        'extras': db.jload(order.get('extras'), []) or [],
        'comment': order.get('comment'),
        'price': {
            'base': order.get('price_base', 0),
            'distance': order.get('price_distance', 0),
            'time': order.get('price_time', 0),
            'loaders': order.get('price_loaders', 0),
            'extras': order.get('price_extras', 0),
            'waiting': order.get('price_waiting', 0),
            'total': order.get('price_total', 0),
        },
        'price_total': order.get('price_total', 0),
        'commission': order.get('commission', 0),
        'payment_method': order.get('payment_method', 'cash'),
        'payment_status': order.get('payment_status', 'none'),
        'payment_name': i18n.payment_name(order.get('payment_status'), lang),
        'paid_amount': order.get('paid_amount', 0),
        'waiting_s': order.get('waiting_s', 0),
        'created_at': order.get('created_at'),
        'searching_at': order.get('searching_at'),
        'assigned_at': order.get('assigned_at'),
        'at_pickup_at': order.get('at_pickup_at'),
        'started_at': order.get('started_at'),
        'done_at': order.get('done_at'),
        'cancelled_at': order.get('cancelled_at'),
        'cancel_reason': order.get('cancel_reason'),
        'cancelled_by': order.get('cancelled_by'),
        'can_cancel': order['status'] in CANCELLABLE,
        'cancel_free_until': free_until,
        'rating': order.get('client_rating'),
        'courier': courier_view(order),
        'search_timeout_s': settings.get_int('order.search_timeout_s', 300),
        'now': db.now(),
    }


@router.get(API + '/orders/{pid}')
def get_order(ctx, pid):
    order = _find(pid)
    _check_token(ctx, order)
    return order_view(order, _lang(ctx, order.get('lang') or 'ru'))


# ─────────────────────────────────────────────────────────────── живые обновления

def _safe_event(data):
    """Событие из шины перед отправкой клиенту: убираем внутренние id и телефон
    курьера, пока заказ ему не назначен. Копируем — словарь из шины общий."""
    if not isinstance(data, dict):
        return data
    out = {k: v for k, v in data.items() if k not in ('id', 'client_id', 'courier_id')}
    courier = out.get('courier')
    if isinstance(courier, dict):
        safe = {k: v for k, v in courier.items() if k != 'id'}
        if out.get('status') not in WITH_COURIER_PHONE:
            safe.pop('phone', None)
        out['courier'] = safe
    return out


@router.get(API + '/orders/{pid}/stream')
def stream_order(ctx, pid):
    """Поток событий по заказу: смена статуса, назначение курьера, его движение.

    Свой цикл вместо общего core.sse_loop — чтобы пропустить каждое событие через
    фильтр: в шину дежурные модули кладут и внутренние идентификаторы тоже.
    """
    order = _find(pid)
    _check_token(ctx, order)
    h = ctx.h
    lang = _lang(ctx, order.get('lang') or 'ru')
    h.start_sse()
    sub = HUB.subscribe(['order:%s' % order['public_id']])
    started = time.time()
    try:
        h.sse_send(None, {'ok': True}, retry=3000)
        h.sse_send('order', order_view(order, lang))
        while time.time() - started < STREAM_MAX_S:
            items, alive = sub.wait(STREAM_PING_S)
            for event, data in items:
                h.sse_send(event, _safe_event(data))
            if not alive:
                break
            if not items:
                h.sse_send('ping', {'t': int(time.time())})
    except (BrokenPipeError, ConnectionResetError, OSError):
        pass                                    # клиент закрыл вкладку — это норма
    finally:
        HUB.unsubscribe(sub)


# ─────────────────────────────────────────────────────────────── отмена и оценка

@router.post(API + '/orders/{pid}/cancel')
def cancel_order(ctx, pid):
    order = _find(pid)
    _check_token(ctx, order)
    lang = _lang(ctx, order.get('lang') or 'ru')

    if order['status'] == 'cancelled':
        return {'ok': True, 'status': 'cancelled', 'free': True, 'fee': 0,
                'message': say('cancel.closed', lang)}
    if order['status'] in ('done', 'expired'):
        conflict(say('cancel.closed', lang))
    if order['status'] not in CANCELLABLE:
        conflict(say('cancel.late', lang))

    reason = ctx.field('reason', str, 300) or ''
    had_courier = bool(order.get('courier_id'))
    free_until = _cancel_free_until(order)
    t = db.now()
    free = free_until is None or t <= free_until
    fee = 0 if free else min(int(order.get('commission') or 0), int(order.get('price_total') or 0))

    with db.tx():
        changed = db.execute(
            "UPDATE orders SET status='cancelled', cancelled_at=?, cancelled_by='client', "
            'cancel_reason=? WHERE id=? AND status IN (%s)'
            % ','.join('?' * len(CANCELLABLE)),
            (t, reason or None, order['id']) + CANCELLABLE).rowcount
        if not changed:
            conflict(say('cancel.late', lang))
        if had_courier:
            db.execute('UPDATE couriers SET busy=0 WHERE user_id=?', (order['courier_id'],))
        _event(order['id'], 'client', 'cancelled',
               {'reason': reason, 'fee': fee, 'free': free, 'courier_id': order.get('courier_id')})

    # Предложения снимаем уже после записи статуса: курьерам гаснут карточки.
    dispatch.cancel_search(order['id'])
    # Заказа не будет — бонусы возвращаем на счёт. Человек их заработал.
    bonus.on_order_cancelled(order)
    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    _publish(fresh, {'cancelled_by': 'client', 'cancel_reason': reason})
    log('заказ', fresh['public_id'], 'отменён клиентом', ('бесплатно' if free else 'со штрафом'))
    return {
        'ok': True, 'status': 'cancelled', 'free': free, 'fee': fee,
        'message': say('cancel.free', lang) if free
        else say('cancel.fee', lang, fee=i18n.fmt_money(fee, lang)),
        'order': order_view(fresh, lang),
    }


@router.post(API + '/orders/{pid}/rate')
def rate_order(ctx, pid):
    """Оценка курьера клиентом: 1–5 звёзд и пара слов. Считается один раз."""
    order = _find(pid)
    _check_token(ctx, order)
    lang = _lang(ctx, order.get('lang') or 'ru')

    rating = ctx.need('rating', int)
    if rating < 1 or rating > 5:
        bad(say('rate.range', lang), 'bad_rating')
    comment = ctx.field('comment', str, 500) or ''
    if order['status'] != 'done':
        conflict(say('rate.not_done', lang))
    if order.get('client_rating'):
        conflict(say('rate.twice', lang))

    with db.tx():
        changed = db.execute('UPDATE orders SET client_rating=?, client_comment=? '
                             'WHERE id=? AND client_rating IS NULL',
                             (rating, comment or None, order['id'])).rowcount
        if not changed:
            conflict(say('rate.twice', lang))
        if order.get('courier_id'):
            db.execute('UPDATE couriers SET rating_sum = rating_sum + ?, '
                       'rating_count = rating_count + 1 WHERE user_id=?',
                       (rating, order['courier_id']))
        _event(order['id'], 'client', 'rated', {'rating': rating, 'comment': comment})

    # Маленький бонус за оценку: без него отзывы просто не пишут.
    gift = _int(bonus.on_order_rated(order, rating).get('amount'))

    body = {'public_id': order['public_id'], 'rating': rating, 'comment': comment,
            'courier_id': order.get('courier_id')}
    HUB.publish('admin', 'rating', body)
    if order.get('courier_id'):
        HUB.publish('courier:%s' % order['courier_id'], 'rating',
                    {'public_id': order['public_id'], 'rating': rating, 'comment': comment})
    return {'ok': True, 'rating': rating, 'message': say('rate.thanks', lang),
            'bonus': gift, 'bonus_balance': bonus.balance(order.get('client_id') or 0)}


# ─────────────────────────────────────────────────────────────── оплата

@router.post(API + '/payments/init')
def payment_init(ctx):
    """Начало оплаты. Токен отслеживания обязателен: по одному номеру заказа
    посторонний не должен ни увидеть платёжную ссылку, ни менять способ оплаты."""
    order = _find(ctx.need('public_id', str, 32))
    _check_token(ctx, order)
    lang = _lang(ctx, order.get('lang') or 'ru')

    if order['payment_status'] == 'paid':
        return {'ok': True, 'provider': order.get('payment_method'), 'status': 'paid',
                'url': None, 'amount': order.get('paid_amount', 0),
                'message': say('pay.done', lang)}
    if order['status'] in ('cancelled', 'done', 'expired'):
        conflict(say('pay.closed', lang))

    res = payments.init_payment(order, return_url=ctx.field('return_url', str, 300), lang=lang)
    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    # Оплаты нет или она отложена до оператора — заказ едет искать машину прямо сейчас.
    if not res.get('url') and fresh['status'] == 'draft':
        res['search'] = _start_search(fresh)
    return res


def _callback_data(ctx):
    """Тело вебхука: форма, JSON или параметры адреса — принимаем любой вариант."""
    raw = getattr(ctx, '_body', b'') or b''
    if raw:
        text = raw.decode('utf-8', 'replace').strip()
        if text.startswith('{'):
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict):
                    return parsed
            except ValueError:
                pass
        return text
    return {k: v[0] for k, v in ctx.query.items() if v}


def _send_raw(ctx, body, content_type, status=200):
    """Ответ провайдеру в его формате: платёжный шлюз ждёт XML, а не наш JSON."""
    h = ctx.h
    data = body.encode('utf-8') if isinstance(body, str) else (body or b'')
    h.send_response(status)
    h.send_header('Content-Type', content_type)
    h.send_header('Content-Length', str(len(data)))
    h.send_header('Cache-Control', 'no-store')
    h._security_headers()
    h.end_headers()
    if ctx.method != 'HEAD':
        h.wfile.write(data)


@router.post(API + '/payments/callback/{provider}')
def payment_callback(ctx, provider):
    """Вебхук платёжного шлюза. Подпись проверяет payments, здесь — только доставка."""
    res = payments.handle_callback(provider, _callback_data(ctx), script=provider)
    _send_raw(ctx, res.get('body') or '', res.get('content_type') or 'text/plain; charset=utf-8')


# Часть шлюзов дублирует результат обычной ссылкой возврата — отвечаем и на GET.
router.add('GET', API + '/payments/callback/{provider}', payment_callback)


def register(app):
    """Подключение клиентских маршрутов к приложению."""
    app.router.include(router)
    return router
