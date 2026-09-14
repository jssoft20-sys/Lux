# -*- coding: utf-8 -*-
"""Подбор курьера под заказ и раздача предложений.

Логика простая и предсказуемая: заказ уходит в поиск, каждые несколько секунд
свободным машинам рядом уходит предложение, кто первым нажал «Беру» — тот и везёт.
Предложение живёт offer_ttl_s секунд, раздаём партиями по dispatch.batch машин,
чтобы не спамить весь город и при этом не терять время.

Два места, где легко испортить жизнь людям, и поэтому они сделаны аккуратно:

1. Одновременное нажатие. Два курьера жмут «Беру» в одну секунду — заказ должен
   достаться ровно одному. Поэтому accept() целиком идёт внутри db.tx()
   (BEGIN IMMEDIATE) и перепроверяет статус заказа уже внутри транзакции.

2. Новички. Если считать только долю принятых предложений, курьер без единого
   заказа навсегда останется в конце очереди и уйдёт из сервиса. Поэтому пока
   статистики нет, вместо доли берётся фора dispatch.new_courier_boost.
"""
import math, threading, time, traceback

from . import db, settings
from .core import HUB, log, conflict, forbidden, not_found

# Позиция старше двух минут — это уже не «где курьер сейчас», а «где он был».
# Слать такому предложение бессмысленно: телефон в кармане или приложение уснуло.
GEO_FRESH_S = 120

# Пока предложений было меньше этого числа, доля принятых — шум, а не статистика.
MIN_OFFERS_FOR_STATS = 5

# Курьеру без единой оценки ставим верхнюю планку: он ещё ничем не провинился.
NEW_RATING = 5.0

# Статусы, в которых машина занята делом, даже если флаг busy почему-то сброшен.
ACTIVE_STATUSES = ('assigned', 'to_pickup', 'at_pickup', 'in_transit', 'at_dropoff')

# Почему поиск закончился ничем — этот текст видит клиент.
FAIL_TEXT = {
    'no_couriers': 'Рядом не нашлось свободной машины. Попробуйте ещё раз '
                   'через пару минут или выберите другой тариф.',
    'timeout': 'За отведённое время никто не откликнулся. Давайте попробуем ещё раз.',
    'rounds': 'Мы предложили заказ всем свободным машинам поблизости, но взять его '
              'никто не смог. Попробуйте ещё раз или позвоните в поддержку.',
}


# ─────────────────────────────────────────────────────────────── мелкие помощники

def _clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else hi if v > hi else v


def distance_m(lat1, lng1, lat2, lng2):
    """Расстояние по прямой в метрах. Для подбора этого достаточно: гонять
    маршрутизатор на каждого кандидата — это десятки запросов ради сортировки."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return int(2 * r * math.asin(min(1.0, math.sqrt(a))))


def _event(order_id, actor, kind, data=None):
    db.insert('order_events', {
        'order_id': order_id, 'at': db.now(), 'actor': actor,
        'type': kind, 'data': db.jdump(data) if data is not None else None,
    })


def _order(order_or_id):
    """Принимаем и словарь заказа, и его id — вызывать удобнее, ошибок меньше."""
    if isinstance(order_or_id, dict):
        return order_or_id
    return db.row('SELECT * FROM orders WHERE id=?', (int(order_or_id),))


def pickup_point(order):
    """Координаты точки погрузки. Без них подбирать не от чего."""
    points = db.jload(order.get('points'), []) or []
    if not points:
        return None
    p = points[0]
    lat, lng = p.get('lat'), p.get('lng')
    if lat is None or lng is None:
        return None
    try:
        return float(lat), float(lng)
    except (TypeError, ValueError):
        return None


def rating_of(rating_sum, rating_count):
    if not rating_count:
        return NEW_RATING
    return rating_sum / float(rating_count)


# ─────────────────────────────────────────────────────────────── карточки для событий

def _points_view(order, full):
    """До принятия заказа курьер видит адреса, но не телефоны получателей —
    иначе можно собрать базу контактов, просто отказываясь от предложений."""
    out = []
    for p in db.jload(order.get('points'), []) or []:
        item = {
            'addr': p.get('addr'), 'lat': p.get('lat'), 'lng': p.get('lng'),
            'entrance': p.get('entrance'), 'floor': p.get('floor'),
            'comment': p.get('comment'),
        }
        if full:
            item['flat'] = p.get('flat')
            item['intercom'] = p.get('intercom')
            item['phone'] = p.get('phone')
            item['name'] = p.get('name')
        out.append(item)
    return out


def order_card(order, full=False):
    """Заказ в том виде, в каком его показывают курьеру: что везти, куда и за сколько."""
    tariff = None
    if order.get('tariff_id'):
        tariff = db.row('SELECT id, code, name_ru, name_ky, icon, vehicle_class '
                        'FROM tariffs WHERE id=?', (order['tariff_id'],))
    return {
        'id': order['id'], 'public_id': order['public_id'], 'status': order['status'],
        'lang': order.get('lang', 'ru'),
        'tariff': tariff,
        'points': _points_view(order, full),
        'distance_m': order.get('distance_m', 0), 'duration_s': order.get('duration_s', 0),
        'loaders': order.get('loaders', 0), 'extras': db.jload(order.get('extras'), []) or [],
        'comment': order.get('comment'),
        'price_total': order.get('price_total', 0),
        'courier_payout': order.get('courier_payout', 0),
        'commission': order.get('commission', 0),
        'payment_method': order.get('payment_method', 'cash'),
        'payment_status': order.get('payment_status', 'none'),
        'created_at': order.get('created_at'),
    }


def courier_card(user_id):
    """Кого клиент увидит на карте: имя, машина, рейтинг, последняя позиция."""
    r = db.row('SELECT u.id, u.name, u.phone, u.avatar, '
               '       c.car_model, c.car_plate, c.car_color, c.vehicle_class, '
               '       c.rating_sum, c.rating_count, c.orders_done, '
               '       c.lat, c.lng, c.heading, c.geo_at '
               'FROM users u JOIN couriers c ON c.user_id = u.id WHERE u.id=?', (user_id,))
    if not r:
        return None
    return {
        'id': r['id'], 'name': r['name'], 'phone': r['phone'], 'avatar': r['avatar'],
        'car': {'model': r['car_model'], 'plate': r['car_plate'],
                'color': r['car_color'], 'class': r['vehicle_class']},
        'rating': round(rating_of(r['rating_sum'], r['rating_count']), 2),
        'rating_count': r['rating_count'], 'orders_done': r['orders_done'],
        'at': [r['lat'], r['lng']] if r['lat'] is not None else None,
        'heading': r['heading'], 'geo_at': r['geo_at'],
    }


def order_state(order):
    """Состояние заказа для клиента: статус, курьер, деньги. Уходит в тему order:*."""
    data = {
        'public_id': order['public_id'], 'status': order['status'],
        'distance_m': order.get('distance_m', 0), 'duration_s': order.get('duration_s', 0),
        'price_total': order.get('price_total', 0),
        'payment_method': order.get('payment_method', 'cash'),
        'payment_status': order.get('payment_status', 'none'),
        'searching_at': order.get('searching_at'), 'assigned_at': order.get('assigned_at'),
    }
    data['courier'] = courier_card(order['courier_id']) if order.get('courier_id') else None
    return data


def _publish_order(order, extra=None):
    """Одно изменение заказа — одно событие клиенту и одно админке на живую карту."""
    state = order_state(order)
    if extra:
        state.update(extra)
    HUB.publish('order:%s' % order['public_id'], 'order', state)
    HUB.publish('admin', 'order', dict(state, id=order['id'],
                                       courier_id=order.get('courier_id')))


# ─────────────────────────────────────────────────────────────── подбор

def candidates(order):
    """Кто может взять этот заказ прямо сейчас, в порядке от лучшего к худшему.

    Возвращает список словарей: courier_id, distance_m, score, rating и прочее,
    чем админка объясняет, почему заказ ушёл именно этому водителю.
    """
    order = _order(order)
    if not order:
        return []
    here = pickup_point(order)
    if not here:
        return []

    radius = max(300, settings.get_int('dispatch.radius_m', 12000))
    min_rating = settings.get_float('dispatch.min_rating', 0)
    mode = settings.get('dispatch.mode', 'score')
    # Курьеров, которым уже предлагали этот заказ в текущем поиске, не трогаем:
    # человек отказался или промолчал — значит, не хочет, и дёргать его снова грубо.
    since = order.get('searching_at') or 0
    fresh_after = db.now() - GEO_FRESH_S

    need_class = None
    if order.get('tariff_id'):
        need_class = db.value('SELECT vehicle_class FROM tariffs WHERE id=?',
                              (order['tariff_id'],))

    rows = db.rows(
        'SELECT c.user_id, c.vehicle_class, c.lat, c.lng, c.geo_at, '
        '       c.rating_sum, c.rating_count, c.offers_sent, c.offers_taken, '
        '       c.priority, c.orders_done, u.name, u.lang '
        'FROM couriers c JOIN users u ON u.id = c.user_id '
        "WHERE c.online = 1 AND c.busy = 0 AND u.role = 'courier' AND u.status = 'active' "
        '  AND c.lat IS NOT NULL AND c.lng IS NOT NULL AND c.geo_at >= ? '
        '  AND NOT EXISTS (SELECT 1 FROM offers o '
        '                  WHERE o.order_id = ? AND o.courier_id = c.user_id AND o.sent_at >= ?) '
        '  AND NOT EXISTS (SELECT 1 FROM orders x '
        '                  WHERE x.courier_id = c.user_id AND x.status IN (%s))'
        % ','.join('?' * len(ACTIVE_STATUSES)),
        (fresh_after, order['id'], since) + ACTIVE_STATUSES)

    w_dist = settings.get_float('dispatch.w_distance', 50)
    w_rate = settings.get_float('dispatch.w_rating', 25)
    w_prio = settings.get_float('dispatch.w_priority', 15)
    w_acc = settings.get_float('dispatch.w_acceptance', 10)
    w_sum = w_dist + w_rate + w_prio + w_acc

    # Фору новичкам админ может задать и в процентах (10), и долей (0.1) — понимаем оба.
    boost = settings.get_float('dispatch.new_courier_boost', 10)
    boost = _clamp(boost / 100.0 if boost > 1 else boost)

    out = []
    for c in rows:
        if need_class and c['vehicle_class'] != need_class:
            continue
        dist = distance_m(here[0], here[1], c['lat'], c['lng'])
        if dist > radius:
            continue
        rating = rating_of(c['rating_sum'], c['rating_count'])
        if rating < min_rating:
            continue

        near_n = _clamp(1.0 - dist / float(radius))
        rate_n = _clamp((rating - 1.0) / 4.0)          # оценки идут от 1 до 5
        prio_n = _clamp((c['priority'] + 50) / 100.0)  # ручной приоритет −50…+50
        if c['offers_sent'] >= MIN_OFFERS_FOR_STATS:
            acc_n = _clamp(c['offers_taken'] / float(c['offers_sent']))
        else:
            acc_n = boost

        if mode == 'nearest':
            score = near_n
        elif w_sum > 0:
            score = (w_dist * near_n + w_rate * rate_n +
                     w_prio * prio_n + w_acc * acc_n) / w_sum
        else:
            score = near_n                             # веса обнулили — работаем по близости

        out.append({
            'courier_id': c['user_id'], 'name': c['name'], 'lang': c['lang'],
            'vehicle_class': c['vehicle_class'], 'distance_m': dist,
            'score': round(score, 4), 'rating': round(rating, 2),
            'priority': c['priority'], 'acceptance': round(acc_n, 3),
            'orders_done': c['orders_done'],
            'lat': c['lat'], 'lng': c['lng'], 'geo_at': c['geo_at'],
        })

    out.sort(key=lambda c: (-c['score'], c['distance_m'], c['courier_id']))
    return out


# ─────────────────────────────────────────────────────────────── раздача

def _rounds_done(order):
    """Сколько партий уже разослали в этом поиске. Считаем по событиям, а не в памяти:
    перезапуск сервиса не должен обнулять счётчик и гонять курьеров по второму кругу."""
    since = order.get('searching_at') or 0
    return db.value("SELECT COUNT(*) FROM order_events "
                    "WHERE order_id=? AND type='dispatch_round' AND at >= ?",
                    (order['id'], since), 0)


def _send_round(order, rounds_done):
    """Одна партия предложений. Возвращает, скольким курьерам ушёл заказ."""
    picks = candidates(order)
    if not picks:
        return 0

    mode = settings.get('dispatch.mode', 'score')
    ttl = max(5, settings.get_int('dispatch.offer_ttl_s', 20))
    batch = len(picks) if mode == 'broadcast' else max(1, settings.get_int('dispatch.batch', 2))
    picks = picks[:batch]

    t = db.now()
    expires = t + ttl
    sent = []
    with db.tx():
        # Пока собирали кандидатов, заказ могли отменить — проверяем ещё раз под замком.
        if db.value('SELECT status FROM orders WHERE id=?', (order['id'],)) != 'searching':
            return 0
        for c in picks:
            offer_id = db.insert('offers', {
                'order_id': order['id'], 'courier_id': c['courier_id'],
                'sent_at': t, 'expires_at': expires, 'status': 'sent',
                'distance_m': c['distance_m'], 'score': c['score'],
            })
            db.execute('UPDATE couriers SET offers_sent = offers_sent + 1 WHERE user_id=?',
                       (c['courier_id'],))
            _event(order['id'], 'system', 'offer_sent',
                   {'offer_id': offer_id, 'courier_id': c['courier_id'],
                    'distance_m': c['distance_m'], 'score': c['score'], 'ttl_s': ttl})
            sent.append((offer_id, c))
        _event(order['id'], 'system', 'dispatch_round',
               {'round': rounds_done + 1, 'mode': mode,
                'couriers': [c['courier_id'] for c in picks]})

    card = order_card(order, full=False)
    for offer_id, c in sent:
        payload = {
            'offer_id': offer_id, 'order_id': order['id'], 'public_id': order['public_id'],
            'sent_at': t, 'expires_at': expires, 'ttl_s': ttl,
            'to_pickup_m': c['distance_m'], 'score': c['score'],
            'order': card,
        }
        HUB.publish('courier:%s' % c['courier_id'], 'offer', payload)
        HUB.publish('admin', 'offer', {
            'order_id': order['id'], 'public_id': order['public_id'],
            'courier_id': c['courier_id'], 'offer_id': offer_id,
            'distance_m': c['distance_m'], 'score': c['score'], 'expires_at': expires,
        })

    _publish_order(order, {'searching': {'round': rounds_done + 1, 'offers': len(sent)}})
    return len(sent)


def _revoke(offers, reason):
    """Снимаем предложения с экранов курьеров: заказ ушёл, отменён или протух."""
    for f in offers:
        body = {'offer_id': f['id'], 'order_id': f['order_id'], 'reason': reason}
        HUB.publish('courier:%s' % f['courier_id'], 'offer_cancelled', body)
        HUB.publish('admin', 'offer_cancelled', dict(body, courier_id=f['courier_id']))


def _fail(order, reason):
    """Поиск закончился ничем: заказ в expired, клиенту — понятное объяснение."""
    with db.tx():
        if db.value('SELECT status FROM orders WHERE id=?', (order['id'],)) != 'searching':
            return False
        stale = db.rows("SELECT * FROM offers WHERE order_id=? AND status='sent'", (order['id'],))
        db.execute("UPDATE offers SET status='expired' WHERE order_id=? AND status='sent'",
                   (order['id'],))
        db.execute("UPDATE orders SET status='expired' WHERE id=?", (order['id'],))
        _event(order['id'], 'system', 'search_expired', {'reason': reason})

    _revoke(stale, 'order_expired')
    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    _publish_order(fresh)
    body = {'public_id': order['public_id'], 'order_id': order['id'], 'status': 'expired',
            'reason': reason, 'message': FAIL_TEXT.get(reason, FAIL_TEXT['timeout'])}
    HUB.publish('order:%s' % order['public_id'], 'search_failed', body)
    HUB.publish('admin', 'search_failed', body)
    log('диспетчер: заказ', order['public_id'], 'без курьера —', reason)
    return True


# ─────────────────────────────────────────────────────────────── публичные действия

def start_search(order_id):
    """Ставим заказ в поиск и сразу раздаём первую партию предложений.

    Первую партию шлём здесь, а не ждём тика: секунда ожидания на пустом экране
    после нажатия «Заказать» ощущается как зависание.
    """
    order = _order(order_id)
    if not order:
        not_found('Заказ не найден')
    if order['status'] in ACTIVE_STATUSES or order['status'] == 'done':
        conflict('У заказа уже есть курьер')
    if order['status'] == 'cancelled':
        conflict('Заказ отменён')
    if not pickup_point(order):
        conflict('У заказа нет координат точки погрузки')

    t = db.now()
    with db.tx():
        changed = db.execute(
            "UPDATE orders SET status='searching', searching_at=? "
            "WHERE id=? AND status IN ('draft','searching','expired')",
            (t, order['id'])).rowcount
        if not changed:
            conflict('Заказ уже не в поиске')
        _event(order['id'], 'system', 'search_started', {'restart': order['status'] == 'expired'})

    order = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    _publish_order(order)
    sent = _send_round(order, 0)
    return {'status': 'searching', 'sent': sent, 'searching_at': t}


def tick():
    """Один шаг фонового цикла: снять протухшее, разослать следующее, закрыть безнадёжное."""
    t = db.now()
    _expire_offers(t)

    timeout = max(30, settings.get_int('order.search_timeout_s', 300))
    max_rounds = max(1, settings.get_int('dispatch.max_rounds', 6))

    for order in db.rows("SELECT * FROM orders WHERE status='searching' ORDER BY id"):
        try:
            waiting = db.value("SELECT COUNT(*) FROM offers "
                               "WHERE order_id=? AND status='sent'", (order['id'],), 0)
            if waiting:
                continue                      # кто-то ещё думает — не мешаем
            started = order.get('searching_at') or order['created_at']
            rounds = _rounds_done(order)
            if t - started >= timeout:
                _fail(order, 'no_couriers' if rounds == 0 else 'timeout')
            elif rounds >= max_rounds:
                _fail(order, 'rounds')
            else:
                _send_round(order, rounds)
        except Exception:
            log('диспетчер: споткнулись на заказе', order['public_id'],
                '\n' + traceback.format_exc())


def _expire_offers(t):
    """Предложения, на которые не ответили. Курьеру убираем карточку с экрана."""
    stale = db.rows("SELECT * FROM offers WHERE status='sent' AND expires_at <= ?", (t,))
    if not stale:
        return
    with db.tx():
        db.execute("UPDATE offers SET status='expired' WHERE status='sent' AND expires_at <= ?",
                   (t,))
        for f in stale:
            _event(f['order_id'], 'system', 'offer_expired',
                   {'offer_id': f['id'], 'courier_id': f['courier_id']})
    _revoke(stale, 'timeout')


def accept(order_id, courier_id):
    """Курьер берёт заказ. Ровно один — остальным карточка гаснет.

    Вся проверка и запись идут в одной транзакции: между «заказ ещё свободен»
    и «заказ мой» не должно быть ни одного зазора, иначе на двойное нажатие
    оба курьера поедут на одну погрузку.
    """
    order_id, courier_id = int(order_id), int(courier_id)
    losers = []
    with db.tx():
        order = db.row('SELECT * FROM orders WHERE id=?', (order_id,))
        if not order:
            not_found('Заказ не найден')
        offer = db.row('SELECT * FROM offers WHERE order_id=? AND courier_id=? '
                       'ORDER BY id DESC LIMIT 1', (order_id, courier_id))
        if not offer:
            forbidden('Этот заказ вам не предлагали')
        if order['status'] != 'searching' or order['courier_id']:
            if order['status'] in ('cancelled', 'expired'):
                conflict('Заказ уже не актуален')
            conflict('Заказ только что взял другой курьер')
        if offer['status'] == 'declined':
            conflict('Вы отказались от этого заказа')
        if offer['status'] != 'sent':
            conflict('Время на ответ вышло')

        me = db.row('SELECT c.busy, u.status FROM couriers c JOIN users u ON u.id=c.user_id '
                    'WHERE c.user_id=?', (courier_id,))
        if not me or me['status'] != 'active':
            forbidden('Аккаунт не активен')
        if me['busy']:
            conflict('Сначала завершите текущий заказ')

        t = db.now()
        taken = db.execute("UPDATE orders SET status='assigned', courier_id=?, assigned_at=? "
                           "WHERE id=? AND status='searching' AND courier_id IS NULL",
                           (courier_id, t, order_id)).rowcount
        if not taken:
            conflict('Заказ только что взял другой курьер')
        db.execute("UPDATE offers SET status='accepted' WHERE id=?", (offer['id'],))
        losers = db.rows("SELECT * FROM offers WHERE order_id=? AND status='sent' AND id<>?",
                         (order_id, offer['id']))
        db.execute("UPDATE offers SET status='expired' WHERE order_id=? AND status='sent' AND id<>?",
                   (order_id, offer['id']))
        db.execute('UPDATE couriers SET busy=1, offers_taken = offers_taken + 1 WHERE user_id=?',
                   (courier_id,))
        _event(order_id, 'courier:%s' % courier_id, 'assigned',
               {'offer_id': offer['id'], 'courier_id': courier_id,
                'waited_s': t - offer['sent_at']})

    _revoke(losers, 'taken')
    fresh = db.row('SELECT * FROM orders WHERE id=?', (order_id,))
    _publish_order(fresh)
    HUB.publish('courier:%s' % courier_id, 'order', order_card(fresh, full=True))
    log('диспетчер: заказ', fresh['public_id'], 'взял курьер', courier_id)
    return fresh


def decline(order_id, courier_id):
    """Курьер отказался. Следующая партия уйдёт на ближайшем тике, ждать нечего."""
    order_id, courier_id = int(order_id), int(courier_id)
    with db.tx():
        offer = db.row('SELECT * FROM offers WHERE order_id=? AND courier_id=? '
                       'ORDER BY id DESC LIMIT 1', (order_id, courier_id))
        if not offer:
            not_found('Предложение не найдено')
        if offer['status'] == 'accepted':
            conflict('Заказ уже принят, откажитесь через отмену заказа')
        if offer['status'] == 'sent':
            db.execute("UPDATE offers SET status='declined' WHERE id=?", (offer['id'],))
            _event(order_id, 'courier:%s' % courier_id, 'offer_declined',
                   {'offer_id': offer['id'], 'courier_id': courier_id})

    _revoke([{'id': offer['id'], 'order_id': order_id, 'courier_id': courier_id}], 'declined')
    return {'ok': True}


def cancel_search(order_id):
    """Снимаем заказ с раздачи: клиент отменил или админ забрал его в ручное распределение.

    Статус заказа меняет тот, кто отменяет, — диспетчер отвечает только за предложения.
    """
    order = _order(order_id)
    if not order:
        not_found('Заказ не найден')
    with db.tx():
        stale = db.rows("SELECT * FROM offers WHERE order_id=? AND status='sent'", (order['id'],))
        if stale:
            db.execute("UPDATE offers SET status='expired' WHERE order_id=? AND status='sent'",
                       (order['id'],))
        _event(order['id'], 'system', 'search_cancelled', {'revoked': len(stale)})

    _revoke(stale, 'cancelled')
    return {'ok': True, 'revoked': len(stale)}


# ─────────────────────────────────────────────────────────────── фоновый цикл

def run_loop(stop_event):
    """Раз в секунду двигаем все поиски. Секунда — компромисс: курьер не ждёт зря,
    база не потеет. Любая ошибка внутри тика пишется в лог, но цикл не роняет:
    один кривой заказ не должен останавливать раздачу по всему городу."""
    log('диспетчер запущен')
    while not stop_event.is_set():
        started = time.monotonic()
        try:
            tick()
        except Exception:
            log('диспетчер: ошибка в цикле\n' + traceback.format_exc())
        # Ждём остаток секунды: если тик занял больше, идём на следующий круг сразу.
        stop_event.wait(max(0.05, 1.0 - (time.monotonic() - started)))
    log('диспетчер остановлен')


def start(stop_event=None):
    """Запуск потока раздачи. Возвращает (поток, событие остановки) — app.py
    гасит сервис, выставляя событие."""
    stop_event = stop_event or threading.Event()
    th = threading.Thread(target=run_loop, args=(stop_event,),
                          name='dispatch', daemon=True)
    th.start()
    return th, stop_event
