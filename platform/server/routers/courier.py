# -*- coding: utf-8 -*-
"""Рабочее место курьера: линия, геопозиция, предложения, заказ, деньги.

Экран курьера открыт всю смену и держит один поток событий, поэтому здесь важнее
всего две вещи. Первая — не врать: статус заказа меняется только вперёд, назад
из «в пути» в «назначен» не откатишься, иначе клиент на карте увидит чехарду.
Вторая — беречь трафик и батарею: телефон шлёт координаты каждые несколько секунд,
но в базу мы пишем не чаще раза в пятнадцать секунд, а подписчикам отдаём сразу.

Деньги пересчитываются в конце заказа заново, а не правятся по кусочкам:
курьер нажал «Готово» — берём фактическое ожидание и считаем цену с нуля
через pricing. Это единственный способ не разойтись с чеком клиента.
"""
import threading
from datetime import timedelta

from .. import auth, bonus, db, dispatch, i18n_server as i18n, mailer, pricing, settings
from ..core import (ApiError, HUB, Router, bad, conflict, forbidden, log, not_found)

router = Router()
API = '/api/v1'

# Чаще раза в 15 секунд писать след в базу незачем: машина за это время проезжает
# от силы двести метров, а строк за смену набегает в четыре раза меньше.
TRACK_EVERY_S = 15
_track_lock = threading.Lock()
_track_seen = {}                       # courier_id → когда последний раз писали след

# Куда можно перейти из каждого состояния. Всё, чего здесь нет, — запрещено:
# назад по цепочке заказ не ходит, это путает клиента и ломает статистику.
STATUS_FLOW = {
    'assigned':   ('to_pickup', 'at_pickup'),
    'to_pickup':  ('at_pickup',),
    'at_pickup':  ('in_transit',),
    'in_transit': ('at_dropoff', 'done'),
    'at_dropoff': ('done',),
}

# Статус → колонка с отметкой времени.
STATUS_STAMP = {
    'at_pickup': 'at_pickup_at',
    'in_transit': 'started_at',
    'done': 'done_at',
}

# Ожидание считается только там, где машина реально стоит и ждёт людей.
WAITING_STATUSES = ('at_pickup', 'at_dropoff')

ACTIVE_STATUSES = dispatch.ACTIVE_STATUSES

PERIODS = ('today', 'yesterday', 'week', 'month', 'year', 'all')


def mount(app):
    """Подключить маршруты к приложению — вызывается из app.py."""
    app.router.include(router)
    return router


# ─────────────────────────────────────────────────────────────── общие помощники

def _me(ctx):
    """Курьер, который прислал запрос. Заблокированных и непроверенных
    require() не пропустит — здесь остаются только те, кто может работать."""
    return auth.require(ctx, 'courier')


def _profile(user_id):
    c = db.row('SELECT * FROM couriers WHERE user_id=?', (user_id,))
    if not c:
        # Пользователь с ролью courier без анкеты — так не бывает при обычной
        # регистрации, но если админ что-то правил руками, скажем это прямо.
        raise ApiError('no_profile', 'Анкета машины не заполнена, обратитесь в поддержку', 409)
    return c


def _event(order_id, user_id, kind, data=None):
    db.insert('order_events', {
        'order_id': order_id, 'at': db.now(), 'actor': 'courier:%s' % user_id,
        'type': kind, 'data': db.jdump(data) if data is not None else None,
    })


def _publish_order(order, extra=None):
    """Одно изменение — одно событие клиенту на экран отслеживания и одно админке."""
    state = dispatch.order_state(order)
    if extra:
        state.update(extra)
    HUB.publish('order:%s' % order['public_id'], 'order', state)
    HUB.publish('admin', 'order', dict(state, id=order['id'],
                                       courier_id=order.get('courier_id')))


def _active_order(user_id):
    return db.row('SELECT * FROM orders WHERE courier_id=? AND status IN (%s) '
                  'ORDER BY id DESC LIMIT 1' % ','.join('?' * len(ACTIVE_STATUSES)),
                  (user_id,) + ACTIVE_STATUSES)


def _my_order(user_id, ref):
    """Заказ курьера по id или публичному номеру. Чужой заказ не отдаём."""
    key = str(ref or '').strip()
    if not key:
        bad('Не указан заказ')
    if key.isdigit():
        order = db.row('SELECT * FROM orders WHERE id=?', (int(key),))
    else:
        order = db.row('SELECT * FROM orders WHERE public_id=?', (key.upper(),))
    if not order:
        not_found('Такого заказа нет')
    if order['courier_id'] != user_id:
        forbidden('Это не ваш заказ')
    return order


def _waiting_total(order, at=None):
    """Сколько всего накопилось ожидания, включая незакрытый отрезок."""
    total = int(order.get('waiting_s') or 0)
    started = order.get('waiting_from')
    if started:
        total += max(0, (at or db.now()) - int(started))
    return total


def _waiting_view(order, at=None):
    """Ожидание для экрана: сколько накапало и во что это обошлось клиенту."""
    total = _waiting_total(order, at)
    try:
        q = pricing.quote_order(order, waiting_s=total)
    except ApiError:
        # Тариф могли удалить из админки — секунды всё равно показываем,
        # деньги по такому заказу посчитает админ руками.
        q = {'waiting_min': total // 60, 'waiting': 0, 'total': order.get('price_total') or 0}
    return {
        'running': bool(order.get('waiting_from')),
        'since': order.get('waiting_from'),
        'waiting_s': total,
        'paid_min': q['waiting_min'],
        'price_waiting': q['waiting'],
        'price_total': q['total'],
    }


def _geo_fresh(profile, at=None):
    geo_at = profile.get('geo_at') or 0
    return bool(geo_at) and (at or db.now()) - geo_at <= dispatch.GEO_FRESH_S


def _state(user, profile=None, order=None):
    """Короткая сводка для экрана: на линии ли, занят ли, что сейчас везёт
    и почему заказов может не быть."""
    profile = profile or _profile(user['id'])
    order = order if order is not None else _active_order(user['id'])
    verify = dispatch.verify_view(profile)
    return {
        'online': bool(profile['online']),
        'busy': bool(profile['busy']),
        # Часы на линии приходят с каждым состоянием: экран смены показывает их
        # постоянно, и отдельный запрос ради одной цифры был бы лишним.
        'online_s': shift_seconds(profile),
        'geo_fresh': _geo_fresh(profile),
        'at': [profile['lat'], profile['lng']] if profile['lat'] is not None else None,
        'geo_at': profile['geo_at'],
        'order': dispatch.order_card(order, full=True) if order else None,
        'offers': _live_offers(user['id']),
        # Непроверенный курьер видит весь интерфейс, но заказов не получает.
        # Чтобы он не гадал, отдаём статус проверки и готовое объяснение.
        'verify_status': verify['status'],
        'verify': verify,
        'can_take_orders': verify['ok'],
        'blocked_reason': None if verify['ok'] else verify['text'],
    }


def _courier_state_for_admin(user, profile):
    """Строка живой карты в админке: кто, где и чем занят."""
    return {
        'id': user['id'], 'name': user['name'], 'phone': user['phone'],
        'car': {'model': profile['car_model'], 'plate': profile['car_plate'],
                'color': profile['car_color'], 'class': profile['vehicle_class']},
        'online': bool(profile['online']), 'busy': bool(profile['busy']),
        'at': [profile['lat'], profile['lng']] if profile['lat'] is not None else None,
        'heading': profile['heading'], 'speed': profile['speed'], 'geo_at': profile['geo_at'],
        # Часы на линии за сегодня: цифра общая для всех устройств водителя.
        'online_s': shift_seconds(profile),
        'rating': auth.rating_of(profile['rating_sum'], profile['rating_count']),
        'orders_done': profile['orders_done'],
        # Оператор на живой карте должен сразу видеть, кто на линии без проверки:
        # такая машина стоит зря, ей стоит позвонить.
        'verify_status': profile.get('verify_status') or 'none',
    }


# ─────────────────────────────────────────────────────────────── линия и геопозиция

# Дольше этого одна смена не бывает: человек забыл уйти с линии, а не работал
# сутки. Приписывать ему эти часы — врать и себе, и ему.
MAX_SHIFT_S = 12 * 3600


def _day_start(t=None):
    d = i18n.local_dt(t if t is not None else db.now())
    return int(d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())


def shift_seconds(profile, t=None):
    """Сколько человек сегодня на линии, включая идущую смену."""
    t = db.now() if t is None else t
    day = _day_start(t)
    done = int(profile.get('online_s') or 0) if int(profile.get('online_day') or 0) == day else 0
    since = int(profile.get('online_since') or 0)
    if since:
        # Смена, начатая вчера, засчитывается с полуночи: иначе в шесть утра
        # у ночного водителя будет «на линии 14 часов», и цифре перестанут верить.
        live = min(t - max(since, day), MAX_SHIFT_S)
        done += max(0, live)
    return max(0, done)


def _close_shift(profile, t):
    """Свести идущую смену в накопленное. Возвращает, что записать в базу."""
    day = _day_start(t)
    done = int(profile.get('online_s') or 0) if int(profile.get('online_day') or 0) == day else 0
    since = int(profile.get('online_since') or 0)
    if since:
        done += max(0, min(t - max(since, day), MAX_SHIFT_S))
    return {'online_s': done, 'online_day': day, 'online_since': None}


@router.post(API + '/courier/online')
def set_online(ctx):
    """Выйти на линию и уйти с неё.

    Уйти можно и с заказом в работе: доедет и отдохнёт. Новых предложений
    при этом всё равно не будет — занятым машинам диспетчер не пишет.
    """
    user = _me(ctx)
    if 'online' not in ctx.json:
        bad('Не сказано, выходите вы на линию или уходите')
    online = 1 if ctx.field('online', bool, default=False) else 0

    profile = _profile(user['id'])
    t = db.now()
    patch = {'online': online}
    if online and not profile.get('online_since'):
        patch['online_since'] = t
        if int(profile.get('online_day') or 0) != _day_start(t):
            patch['online_s'] = 0            # новый день — счётчик с нуля
            patch['online_day'] = _day_start(t)
    elif not online:
        patch.update(_close_shift(profile, t))
    db.update('couriers', patch, 'user_id=?', (user['id'],))
    profile.update(patch)
    profile['online'] = online

    order = _active_order(user['id'])
    HUB.publish('admin', 'courier', _courier_state_for_admin(user, profile))
    log('курьер', user['name'], 'на линии' if online else 'ушёл с линии')

    state = _state(user, profile, order)
    state['ok'] = True
    # Одно сообщение за раз и самое важное первым: без проверки документов
    # геолокация всё равно ничего не изменит.
    if online and not state['can_take_orders']:
        state['message'] = state['verify']['text']
    elif online and not state['geo_fresh']:
        state['message'] = 'Включите геолокацию — без неё заказы не приходят'
    return state


@router.post(API + '/courier/geo')
def geo(ctx):
    """Координаты с телефона. Отдаём их подписчикам сразу, в базу пишем реже."""
    user = _me(ctx)
    lat = ctx.need('lat', float)
    lng = ctx.need('lng', float)
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0) or (lat == 0.0 and lng == 0.0):
        bad('Координаты не похожи на настоящие')
    heading = ctx.field('heading', float, default=None)
    speed = ctx.field('speed', float, default=None)
    if heading is not None:
        heading = heading % 360.0
    if speed is not None:
        speed = max(0.0, min(speed, 80.0))      # 80 м/с — это 288 км/ч, дальше врёт датчик

    t = db.now()
    db.update('couriers', {'lat': lat, 'lng': lng, 'heading': heading,
                           'speed': speed, 'geo_at': t}, 'user_id=?', (user['id'],))

    tracked = False
    with _track_lock:
        last = _track_seen.get(user['id'], 0)
        if t - last >= TRACK_EVERY_S:
            _track_seen[user['id']] = t
            tracked = True
            if len(_track_seen) > 2000:         # редкая уборка, чтобы словарь не рос
                _track_seen.clear()
                _track_seen[user['id']] = t
    if tracked:
        db.insert('geo_track', {'courier_id': user['id'], 'lat': lat, 'lng': lng, 'at': t})

    point = {'courier_id': user['id'], 'at': [lat, lng], 'heading': heading,
             'speed': speed, 'geo_at': t}
    order = _active_order(user['id'])
    if order:
        # Клиент смотрит, как машина едет к нему, — это событие ради него и живёт.
        HUB.publish('order:%s' % order['public_id'], 'geo',
                    dict(point, public_id=order['public_id'], status=order['status']))
    HUB.publish('admin', 'geo', dict(point, name=user['name'],
                                     public_id=order['public_id'] if order else None))
    return {'ok': True, 'at': t, 'tracked': tracked}


@router.get(API + '/courier/state')
def state(ctx):
    """Всё состояние экрана одним запросом — им приложение стартует и оживает
    после потери связи."""
    user = _me(ctx)
    return _state(user)


# ─────────────────────────────────────────────────────────────── поток событий

@router.get(API + '/courier/stream')
def stream(ctx):
    """Живой поток: предложения, снятие предложений, изменения заказа, ping.

    Токен здесь приходит параметром, а не заголовком, — EventSource в браузере
    заголовки ставить не умеет, и обойти это нечем.
    """
    user = _me(ctx)

    def on_open():
        """Первым делом отдаём текущее состояние: приложение после переподключения
        должно увидеть свой заказ, а не ждать следующего события."""
        out = [('state', _state(user))]
        order = _active_order(user['id'])
        if order:
            out.append(('order', dispatch.order_card(order, full=True)))
        for offer in _live_offers(user['id']):
            out.append(('offer', offer))
        return out

    ctx.h.sse_loop(['courier:%s' % user['id']], on_open=on_open)
    return None


# ─────────────────────────────────────────────────────────────── предложения

def _offer_payload(offer, order):
    """Карточка предложения — ровно та же, что уходит в поток событий,
    чтобы приложение разбирало её одним куском кода."""
    return {
        'offer_id': offer['id'], 'id': offer['id'],
        'order_id': offer['order_id'], 'public_id': order['public_id'],
        'sent_at': offer['sent_at'], 'expires_at': offer['expires_at'],
        'ttl_s': max(0, offer['expires_at'] - offer['sent_at']),
        'left_s': max(0, offer['expires_at'] - db.now()),
        'to_pickup_m': offer['distance_m'], 'score': offer['score'],
        'order': dispatch.order_card(order, full=False),
    }


def _live_offers(user_id):
    """Предложения, на которые ещё можно ответить."""
    t = db.now()
    out = []
    for offer in db.rows("SELECT * FROM offers WHERE courier_id=? AND status='sent' "
                         'AND expires_at > ? ORDER BY id DESC LIMIT 5', (user_id, t)):
        order = db.row('SELECT * FROM orders WHERE id=?', (offer['order_id'],))
        if order and order['status'] == 'searching':
            out.append(_offer_payload(offer, order))
    return out


@router.get(API + '/courier/offers')
def offers(ctx):
    user = _me(ctx)
    items = _live_offers(user['id'])
    return {'items': items, 'total': len(items)}


def _my_offer(user_id, offer_id):
    key = str(offer_id or '').strip()
    if not key.isdigit():
        bad('Предложение не указано')
    offer = db.row('SELECT * FROM offers WHERE id=?', (int(key),))
    if not offer:
        not_found('Предложение не найдено')
    if offer['courier_id'] != user_id:
        forbidden('Это предложение не вам')
    return offer


@router.post(API + '/courier/offers/{id}/accept')
def accept_offer(ctx, id):
    """«Беру». Побеждает тот, кто нажал первым, — разбирается с этим dispatch."""
    user = _me(ctx)
    offer = _my_offer(user['id'], id)
    order = dispatch.accept(offer['order_id'], user['id'])

    card = dispatch.order_card(order, full=True)
    _notify_taken(user, order, card, offer)
    return {'ok': True, 'order_id': order['id'], 'order': card,
            'waiting': _waiting_view(order)}


def _notify_taken(user, order, card, offer):
    """Письмо курьеру с деталями заказа: адрес и телефон получателя пригодятся,
    даже если приложение закроется или телефон разрядится."""
    if not user.get('email'):
        return
    try:
        mailer.send(user['email'], 'courier_new_order', {
            'order': card, 'name': user['name'],
            'near_m': offer.get('distance_m'),
            'points': db.jload(order.get('points'), []) or [],
        }, user.get('lang') or 'ru')
    except Exception as e:
        log('почта: письмо о заказе', order['public_id'], 'не ушло —', e)


@router.post(API + '/courier/offers/{id}/decline')
def decline_offer(ctx, id):
    """«Не беру». Молча и без объяснений — это нормально, заказ уйдёт другому."""
    user = _me(ctx)
    offer = _my_offer(user['id'], id)
    dispatch.decline(offer['order_id'], user['id'])
    return {'ok': True, 'offer_id': offer['id']}


# ─────────────────────────────────────────────────────────────── ход заказа

@router.get(API + '/courier/orders/{id}')
def one_order(ctx, id):
    user = _me(ctx)
    order = _my_order(user['id'], id)
    return {'order': dispatch.order_card(order, full=True),
            'waiting': _waiting_view(order),
            'events': db.rows('SELECT at, actor, type FROM order_events '
                              'WHERE order_id=? ORDER BY at, id', (order['id'],))}


@router.post(API + '/courier/orders/{id}/status')
def set_status(ctx, id):
    """Следующий шаг заказа: выехал, на месте, поехал, разгружаюсь, готово."""
    user = _me(ctx)
    order = _my_order(user['id'], id)
    target = str(ctx.need('status')).strip().lower()

    allowed = STATUS_FLOW.get(order['status'])
    if allowed is None:
        if order['status'] == 'done':
            conflict('Заказ уже завершён')
        if order['status'] == 'cancelled':
            conflict('Заказ отменён')
        conflict('Заказ ещё не в работе')
    if target == order['status']:
        # Двойное нажатие — не ошибка: отвечаем текущим состоянием.
        return {'ok': True, 'status': order['status'],
                'order': dispatch.order_card(order, full=True),
                'waiting': _waiting_view(order)}
    if target not in allowed:
        raise ApiError('bad_status',
                       'Из состояния «%s» так не перейти' % i18n.status_name(order['status']),
                       409, current=order['status'], allowed=list(allowed))

    if target == 'done':
        return _finish(user, order)

    t = db.now()
    fields = {'status': target}
    stamp = STATUS_STAMP.get(target)
    if stamp and not order.get(stamp):
        fields[stamp] = t
    # Уехали с точки — счётчик ожидания останавливаем сами, иначе он капал бы
    # всю дорогу и курьер объяснялся бы с клиентом за чужую ошибку.
    if order.get('waiting_from') and target not in WAITING_STATUSES:
        fields['waiting_s'] = _waiting_total(order, t)
        fields['waiting_from'] = None

    with db.tx():
        changed = db.update('orders', fields, 'id=? AND status=?', (order['id'], order['status']))
        if not changed:
            conflict('Статус заказа успел измениться, обновите экран')
        _event(order['id'], user['id'], 'status', {'from': order['status'], 'to': target})

    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    _publish_order(fresh)
    HUB.publish('courier:%s' % user['id'], 'order', dispatch.order_card(fresh, full=True))
    return {'ok': True, 'status': target, 'order': dispatch.order_card(fresh, full=True),
            'waiting': _waiting_view(fresh)}


def _finish(user, order):
    """Заказ выполнен: считаем деньги заново и освобождаем машину.

    Цену не правим по частям, а пересчитываем целиком — с фактическим ожиданием.
    Иначе разбивка в чеке клиента и итог курьера однажды разойдутся, и объяснить
    это будет нечем.
    """
    t = db.now()
    waiting_s = _waiting_total(order, t)
    quote = pricing.quote_order(order, waiting_s=waiting_s)
    fields = pricing.to_order_fields(quote)
    fields.update({'status': 'done', 'done_at': t,
                   'waiting_s': waiting_s, 'waiting_from': None})

    with db.tx():
        changed = db.update('orders', fields, 'id=? AND status=?', (order['id'], order['status']))
        if not changed:
            conflict('Статус заказа успел измениться, обновите экран')
        db.execute('UPDATE couriers SET busy=0, orders_done = orders_done + 1 '
                   'WHERE user_id=?', (user['id'],))
        if order.get('client_id'):
            db.execute('UPDATE clients SET last_order_at=? WHERE id=?',
                       (t, order['client_id']))
        _event(order['id'], user['id'], 'done', {
            'waiting_s': waiting_s, 'price_total': quote['total'],
            'courier_payout': quote['courier_payout'], 'commission': quote['commission'],
        })

    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    # Кэшбек клиенту и награда тому, кто его привёл. Считаем здесь, а не когда
    # человек откроет экран бонусов: он должен увидеть начисление сразу, пока
    # помнит про поездку. Начисление идёт один раз на заказ — повтор не пройдёт.
    gift = bonus.on_order_done(fresh)

    _publish_order(fresh, {'breakdown': quote['breakdown']})
    HUB.publish('courier:%s' % user['id'], 'order', dispatch.order_card(fresh, full=True))
    log('заказ', fresh['public_id'], 'завершён курьером', user['name'],
        '— к получению', i18n.fmt_money(quote['courier_payout']))

    paid = int(fresh.get('paid_amount') or 0)
    return {
        'ok': True, 'status': 'done',
        'order': dispatch.order_card(fresh, full=True),
        'price': {
            'total': quote['total'], 'commission': quote['commission'],
            'payout': quote['courier_payout'], 'waiting': quote['waiting'],
            'waiting_s': waiting_s, 'paid': paid,
            'to_collect': max(0, quote['total'] - paid),
            'breakdown': quote['breakdown'],
        },
        'bonus': {'cashback': int(gift.get('cashback') or 0)},
    }


@router.post(API + '/courier/orders/{id}/waiting')
def waiting(ctx, id):
    """Платное ожидание: включил, когда встал под погрузку, выключил, когда поехал.

    Считаем секунды, а в деньги их превращает pricing на закрытии заказа —
    бесплатные минуты и цена минуты живут в тарифе, а не здесь.
    """
    user = _me(ctx)
    order = _my_order(user['id'], id)
    action = _waiting_action(ctx)

    if order['status'] not in WAITING_STATUSES:
        conflict('Ожидание считается только на погрузке и на разгрузке')

    t = db.now()
    if action == 'start':
        if order.get('waiting_from'):
            return dict(_waiting_view(order, t), ok=True, action='start')
        db.update('orders', {'waiting_from': t}, 'id=? AND status=?',
                  (order['id'], order['status']))
        _event(order['id'], user['id'], 'waiting_start', {'at': t})
    else:
        if not order.get('waiting_from'):
            return dict(_waiting_view(order, t), ok=True, action='stop')
        total = _waiting_total(order, t)
        db.update('orders', {'waiting_s': total, 'waiting_from': None}, 'id=?', (order['id'],))
        _event(order['id'], user['id'], 'waiting_stop',
               {'added_s': total - int(order.get('waiting_s') or 0), 'total_s': total})

    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    view = _waiting_view(fresh, t)
    _publish_order(fresh, {'waiting': view})
    return dict(view, ok=True, action=action)


def _waiting_action(ctx):
    """Приложение может прислать и {"action":"start"}, и {"start":true} —
    понимаем оба, лишний разбор на клиенте никому не нужен."""
    body = ctx.json
    raw = str(body.get('action') or '').strip().lower()
    if raw in ('start', 'stop'):
        return raw
    for name in ('start', 'stop'):
        if name in body:
            on = ctx.field(name, bool, default=False)
            return name if on else ('stop' if name == 'start' else 'start')
    bad('Не сказано, включить ожидание или выключить')


@router.post(API + '/courier/orders/{id}/rate-client')
def rate_client(ctx, id):
    """Оценка клиента после заказа: пять звёзд и пара слов для своих.

    Ставится один раз и только по своему завершённому заказу. Комментарий видят
    админ и другие курьеры в карточке клиента, самому клиенту он не уходит:
    иначе честных оценок не будет, водитель побоится испортить отношения.
    """
    user = _me(ctx)
    order = _my_order(user['id'], id)

    if order['status'] != 'done':
        conflict('Оценить клиента можно после того, как заказ завершён')
    if order.get('courier_rating'):
        conflict('Вы уже оценили этого клиента')

    rating = ctx.need('rating', int)
    if rating < 1 or rating > 5:
        bad('Оценка ставится от одной звезды до пяти')
    comment = ctx.field('comment', str, 500, default='') or None

    t = db.now()
    with db.tx():
        # Условие courier_rating IS NULL — защита от второго нажатия: на слабой
        # связи приложение легко отправит один и тот же запрос дважды.
        changed = db.update('orders', {'courier_rating': rating, 'courier_comment': comment},
                            'id=? AND courier_rating IS NULL', (order['id'],))
        if not changed:
            conflict('Вы уже оценили этого клиента')
        if order.get('client_id'):
            db.execute('UPDATE clients SET rating_sum = rating_sum + ?, '
                       'rating_count = rating_count + 1 WHERE id=?',
                       (rating, order['client_id']))
        _event(order['id'], user['id'], 'client_rated',
               {'rating': rating, 'comment': comment, 'at': t})

    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    HUB.publish('admin', 'client_rated', {
        'order_id': fresh['id'], 'public_id': fresh['public_id'],
        'client_id': fresh.get('client_id'), 'courier_id': user['id'],
        'rating': rating, 'comment': comment, 'at': t,
    })
    return {'ok': True, 'rating': rating, 'comment': comment,
            'client': dispatch.client_card(fresh.get('client_id'), full=True),
            'order': dispatch.order_card(fresh, full=True)}


# ─────────────────────────────────────────────────────────────── история и деньги

def _range(ctx, default='today'):
    """Период выборки. Сутки считаем по бишкекскому времени, а не по UTC:
    для курьера «сегодня» заканчивается в полночь у него, а не в шесть утра."""
    frm, to = ctx.qi('from', 0), ctx.qi('to', 0)
    if frm or to:
        return max(0, frm), (to or db.now() + 60), 'custom'

    code = str(ctx.q('period') or default).strip().lower()
    if code not in PERIODS:
        code = default
    t = db.now()
    day = i18n.local_dt(t).replace(hour=0, minute=0, second=0, microsecond=0)
    start = int(day.timestamp())
    if code == 'today':
        return start, t + 60, code
    if code == 'yesterday':
        return start - 86400, start, code
    if code == 'week':
        return int((day - timedelta(days=day.weekday())).timestamp()), t + 60, code
    if code == 'month':
        return int(day.replace(day=1).timestamp()), t + 60, code
    if code == 'year':
        return int(day.replace(month=1, day=1).timestamp()), t + 60, code
    return 0, t + 60, 'all'


# Время, по которому заказ попадает в период: завершённый — по завершению,
# отменённый — по отмене, остальные — по созданию.
WHEN_SQL = 'COALESCE(done_at, cancelled_at, created_at)'


def _history_item(order):
    points = db.jload(order.get('points'), []) or []
    return {
        'id': order['id'], 'public_id': order['public_id'], 'status': order['status'],
        'created_at': order['created_at'], 'assigned_at': order['assigned_at'],
        'done_at': order['done_at'], 'cancelled_at': order['cancelled_at'],
        'from': (points[0].get('addr') if points else None),
        'to': (points[-1].get('addr') if len(points) > 1 else None),
        'points_count': len(points),
        'distance_m': order['distance_m'], 'duration_s': order['duration_s'],
        'waiting_s': order['waiting_s'],
        'price_total': order['price_total'], 'commission': order['commission'],
        'courier_payout': order['courier_payout'],
        'payment_method': order['payment_method'], 'payment_status': order['payment_status'],
        'paid_amount': order['paid_amount'],
        'client_rating': order['client_rating'],
        # Своя оценка клиента: по ней экран решает, предлагать ли поставить звёзды.
        'courier_rating': order['courier_rating'],
        'client': dispatch.client_card(order['client_id'], full=True),
        'tariff': db.value('SELECT name_ru FROM tariffs WHERE id=?', (order['tariff_id'],)),
        'cancel_reason': order['cancel_reason'], 'cancelled_by': order['cancelled_by'],
    }


def _summary(user_id, frm, to):
    """Итоги за период: сколько заказов, сколько заработано, сколько ушло сервису."""
    r = db.row(
        'SELECT COUNT(*) AS done, '
        '       COALESCE(SUM(courier_payout),0) AS payout, '
        '       COALESCE(SUM(commission),0) AS commission, '
        '       COALESCE(SUM(price_total),0) AS revenue, '
        '       COALESCE(SUM(distance_m),0) AS distance_m, '
        '       COALESCE(SUM(duration_s),0) AS duration_s, '
        '       COALESCE(SUM(waiting_s),0) AS waiting_s, '
        "       COALESCE(SUM(CASE WHEN payment_status='paid' "
        '                    THEN paid_amount ELSE 0 END),0) AS online_paid '
        "FROM orders WHERE courier_id=? AND status='done' AND done_at >= ? AND done_at < ?",
        (user_id, frm, to)) or {}
    cancelled = db.value("SELECT COUNT(*) FROM orders WHERE courier_id=? AND status='cancelled' "
                         'AND COALESCE(cancelled_at, created_at) >= ? '
                         'AND COALESCE(cancelled_at, created_at) < ?', (user_id, frm, to), 0)
    payout = int(r.get('payout') or 0)
    online_paid = int(r.get('online_paid') or 0)
    done = int(r.get('done') or 0)
    return {
        'from': frm, 'to': to,
        'orders': done, 'cancelled': int(cancelled or 0),
        'earned': payout,
        'revenue': int(r.get('revenue') or 0),
        'commission': int(r.get('commission') or 0),
        # Наличными курьер забирает всё, кроме уже оплаченного онлайн.
        'cash': max(0, int(r.get('revenue') or 0) - online_paid),
        'online_paid': online_paid,
        'avg_order': (payout // done) if done else 0,
        'distance_m': int(r.get('distance_m') or 0),
        'duration_s': int(r.get('duration_s') or 0),
        'waiting_s': int(r.get('waiting_s') or 0),
    }


@router.get(API + '/courier/orders')
def orders(ctx):
    """История заказов. active=1 — только то, что курьер везёт прямо сейчас."""
    user = _me(ctx)
    if ctx.q('active') in ('1', 'true', 'yes'):
        order = _active_order(user['id'])
        items = [_history_item(order)] if order else []
        return {'items': items, 'total': len(items), 'active': True,
                'order': dispatch.order_card(order, full=True) if order else None}

    frm, to, code = _range(ctx, 'month')
    page = max(1, ctx.qi('page', 1))
    per_page = min(100, max(5, ctx.qi('per_page', 20)))
    where = ('courier_id=? AND %s >= ? AND %s < ?' % (WHEN_SQL, WHEN_SQL))
    args = (user['id'], frm, to)
    status = (ctx.q('status') or '').strip()
    if status:
        where += ' AND status=?'
        args += (status,)

    total = db.value('SELECT COUNT(*) FROM orders WHERE ' + where, args, 0)
    rows = db.rows('SELECT * FROM orders WHERE %s ORDER BY %s DESC, id DESC LIMIT ? OFFSET ?'
                   % (where, WHEN_SQL), args + (per_page, (page - 1) * per_page))
    return {
        'items': [_history_item(o) for o in rows],
        'total': int(total or 0), 'page': page, 'per_page': per_page,
        'period': {'code': code, 'from': frm, 'to': to},
        'summary': _summary(user['id'], frm, to),
    }


@router.get(API + '/courier/stats')
def stats(ctx):
    """Деньги и репутация: за выбранный период плюс привычные «сегодня и неделя»."""
    user = _me(ctx)
    profile = _profile(user['id'])
    frm, to, code = _range(ctx, 'today')
    t = db.now()
    day = i18n.local_dt(t).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start = int(day.timestamp())
    week_start = int((day - timedelta(days=day.weekday())).timestamp())
    month_start = int(day.replace(day=1).timestamp())

    sent, taken = profile['offers_sent'] or 0, profile['offers_taken'] or 0
    return {
        'period': {'code': code, 'from': frm, 'to': to},
        'summary': _summary(user['id'], frm, to),
        'today': _summary(user['id'], today_start, t + 60),
        'week': _summary(user['id'], week_start, t + 60),
        'month': _summary(user['id'], month_start, t + 60),
        'total': {
            'orders': profile['orders_done'], 'cancelled': profile['orders_cancelled'],
            'earned': db.value("SELECT COALESCE(SUM(courier_payout),0) FROM orders "
                               "WHERE courier_id=? AND status='done'", (user['id'],), 0),
        },
        # Часы на линии за сегодня: цифра общая для всех устройств водителя.
        'online_s': shift_seconds(profile, t),
        'rating': auth.rating_of(profile['rating_sum'], profile['rating_count']),
        'rating_count': profile['rating_count'],
        'acceptance': round(taken / float(sent), 2) if sent else None,
        'offers_sent': sent, 'offers_taken': taken,
        'online': bool(profile['online']), 'busy': bool(profile['busy']),
        'balance': profile['balance'],
        'commission': {'kind': settings.get('commission.kind', 'percent'),
                       'value': settings.get('commission.value', 0)},
    }
