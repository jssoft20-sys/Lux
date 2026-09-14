# -*- coding: utf-8 -*-
"""Админка: настройки, справочники, заказы, курьеры, клиенты, статистика и почта.

Здесь всё, чем сервис управляют без программиста. Каждый маршрут начинается
с проверки роли — ни одного «ну тут же и так админский префикс».

Два места, где легко навредить, и поэтому они сделаны строго:

1. Секреты. Пароль SMTP, ключ геокодера и секрет платёжки наружу не уходят никогда,
   даже админу: в ответе вместо значения стоит признак «задано». Пустая строка при
   сохранении означает «не трогать», иначе открытая форма затирала бы пароль каждым
   нажатием «Сохранить».
2. Деньги и статусы заказа. Меняются только через те же функции, что и в обычной
   работе сервиса, чтобы у заказа не появилось состояний, которых не бывает.
"""
import calendar
import re
from datetime import datetime, timezone

from .. import (auth, db, dispatch, geo, i18n_server as i18n, mailer, payments,
                pricing, settings)
from ..core import HUB, ApiError, Router, bad, conflict, log, not_found

API = '/api/v1'
router = Router()

# Значения этих настроек наружу не отдаём — только признак «заполнено».
SECRET_KEYS = ('payment.secret', 'payment.optima_key', 'payment.callback_password',
               'smtp.pass', 'geo.key', 'map.key', 'route.key')

# Ключи, которых ещё нет в settings.DEFAULTS. Тип значения берётся отсюда, иначе
# число приехало бы из формы строкой и границы из LIMITS не сработали бы.
EXTRA_DEFAULTS = {
    'route.key': '',
    'route.rush_factor': geo.RUSH_FACTOR,
    'route.night_factor': geo.NIGHT_FACTOR,
}

# Настройки живут только в этих группах: случайный ключ в базу не попадёт.
SETTING_PREFIXES = ('service.', 'commission.', 'payment.', 'dispatch.', 'map.',
                    'geo.', 'route.', 'smtp.', 'mail.', 'order.', 'security.',
                    'bonus.', 'price.')

# Числовые настройки с разумными границами: ноль радиуса или ttl в сутки —
# это не «гибкая настройка», а сломанный сервис.
LIMITS = {
    'commission.value': (0, 10000000), 'commission.min': (0, 10000000),
    'commission.max': (0, 10000000),
    'dispatch.radius_m': (300, 100000), 'dispatch.offer_ttl_s': (5, 120),
    'dispatch.batch': (1, 50), 'dispatch.max_rounds': (1, 50),
    'dispatch.w_distance': (0, 100), 'dispatch.w_rating': (0, 100),
    'dispatch.w_priority': (0, 100), 'dispatch.w_acceptance': (0, 100),
    'dispatch.new_courier_boost': (0, 100), 'dispatch.min_rating': (0, 5),
    'order.search_timeout_s': (30, 3600), 'order.cancel_free_s': (0, 3600),
    'order.min_price': (0, 100000000), 'order.max_points': (2, 10),
    'order.waiting_free_min': (0, 240),
    'map.zoom': (1, 21), 'map.max_zoom': (1, 22),
    'map.center_lat': (-90, 90), 'map.center_lng': (-180, 180),
    'route.road_factor': (1, 3), 'route.avg_speed_kmh': (5, 120),
    # Час пик дольше свободной дороги, ночь быстрее — иначе это опечатка.
    'route.rush_factor': (1, 3), 'route.night_factor': (0.5, 1),
    'smtp.port': (1, 65535), 'security.session_days': (1, 365),
    'payment.lifetime_s': (300, 86400),
}

# Настройки, у которых выбор из списка.
CHOICES = {
    'commission.kind': ('percent', 'fixed'),
    'payment.provider': payments.PROVIDERS,
    'dispatch.mode': ('nearest', 'score', 'broadcast'),
    'map.provider': ('osm', 'carto', 'yandex', '2gis'),
    'geo.provider': ('nominatim', 'yandex', '2gis'),
    'geo.suggest_provider': ('nominatim', 'yandex', '2gis'),
    'route.provider': ('straight', 'osrm', 'yandex'),
    'smtp.secure': ('none', 'ssl', 'tls'),
    'service.currency': ('KGS', 'USD', 'RUB', 'KZT'),
}

ORDER_STATUSES = ('draft', 'searching', 'assigned', 'to_pickup', 'at_pickup',
                  'in_transit', 'at_dropoff', 'done', 'cancelled', 'expired')
LIVE_STATUSES = ('draft', 'searching', 'assigned', 'to_pickup', 'at_pickup',
                 'in_transit', 'at_dropoff')
USER_STATUSES = ('pending', 'active', 'blocked')
EXTRA_KINDS = ('fixed', 'hourly', 'per_unit', 'per_floor')

# Проверка документов курьера: 'none' — фото ещё не присылал.
VERIFY_STATUSES = ('none', 'pending', 'approved', 'rejected')
VERIFY_DECISIONS = ('approved', 'rejected')
VERIFY_NAME = {'none': 'Без документов', 'pending': 'Ждёт проверки',
               'approved': 'Проверен', 'rejected': 'Отказано'}

# Отметка времени, которую ставит каждый статус заказа.
STATUS_STAMP = {'searching': 'searching_at', 'assigned': 'assigned_at',
                'at_pickup': 'at_pickup_at', 'in_transit': 'started_at',
                'done': 'done_at', 'cancelled': 'cancelled_at'}

CODE_RX = re.compile(r'^[a-z0-9][a-z0-9_-]{1,31}$')
PER_PAGE = 30
MAX_PER_PAGE = 100


# ─────────────────────────────────────────────────────────────── доступ

def _admin(ctx):
    """Админ и никто другой. Проверка стоит в каждом обработчике: один общий
    «префикс /admin закрыт» рано или поздно обходится новым маршрутом."""
    return auth.require(ctx, 'admin')


def _actor(user):
    return 'admin:%s' % (user.get('id') if isinstance(user, dict) else user)


def _event(order_id, actor, kind, data=None):
    db.insert('order_events', {
        'order_id': order_id, 'at': db.now(), 'actor': actor,
        'type': kind, 'data': db.jdump(data) if data is not None else None,
    })


def _publish(order, extra=None):
    state = dispatch.order_state(order)
    if extra:
        state.update(extra)
    HUB.publish('order:%s' % order['public_id'], 'order', state)
    HUB.publish('admin', 'order', dict(state, id=order['id'],
                                       courier_id=order.get('courier_id')))


# ─────────────────────────────────────────────────────────────── разбор значений

def _as_bool(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    return str(v).strip().lower() in ('1', 'true', 'yes', 'on', 'да')


def _as_int(v, name):
    try:
        return int(round(float(str(v).replace(',', '.').strip())))
    except (TypeError, ValueError):
        bad('Поле «%s» ждёт число' % name, 'bad_field')


def _as_float(v, name):
    try:
        return float(str(v).replace(',', '.').strip())
    except (TypeError, ValueError):
        bad('Поле «%s» ждёт число' % name, 'bad_field')


def _clamp(key, value):
    low, high = LIMITS.get(key, (None, None))
    if low is None:
        return value
    return min(max(value, low), high)


def _body(ctx):
    """Тело запроса. Допускаем и {'values': {...}} — так удобнее слать форму целиком."""
    data = ctx.json
    inner = data.get('values')
    return inner if isinstance(inner, dict) else data


def _page(ctx):
    page = max(1, ctx.qi('page', 1))
    per = ctx.qi('per_page', PER_PAGE) or PER_PAGE
    return page, max(1, min(per, MAX_PER_PAGE))


def _tz_offset():
    """Сдвиг часового пояса сервиса в секундах: нужен, чтобы «за сегодня» в отчёте
    совпадало с сегодня по бишкекским часам, а не по гринвичским."""
    off = i18n.local_dt(db.now()).utcoffset()
    return int(off.total_seconds()) if off else 0


def _day_start(unix, off):
    """Начало местных суток для момента unix, в unix-секундах."""
    local = datetime.fromtimestamp(int(unix) + off, tz=timezone.utc)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return calendar.timegm(midnight.timetuple()) - off


def _stamp(raw, off, end=False):
    """Дата из запроса: unix-число или «2026-03-14» по местному времени."""
    raw = str(raw or '').strip()
    if not raw:
        return None
    if raw.isdigit():
        return int(raw)
    try:
        d = datetime.strptime(raw[:10], '%Y-%m-%d')
    except ValueError:
        bad('Дата пишется как 2026-03-14', 'bad_date')
    base = calendar.timegm(d.timetuple()) - off
    return base + 86400 if end else base


def _range(ctx):
    """Период отчёта: period=today|yesterday|week|month|year|all либо from/to."""
    off = _tz_offset()
    now = db.now()
    frm = _stamp(ctx.q('from'), off)
    to = _stamp(ctx.q('to'), off, end=True)
    if frm is not None or to is not None:
        return (frm if frm is not None else 0), (to if to is not None else now + 1), off

    period = (ctx.q('period') or 'week').strip().lower()
    today = _day_start(now, off)
    if period in ('day', 'today'):
        return today, now + 1, off
    if period == 'yesterday':
        return today - 86400, today, off
    if period == 'month':
        return today - 29 * 86400, now + 1, off
    if period == 'year':
        return today - 364 * 86400, now + 1, off
    if period == 'all':
        return 0, now + 1, off
    return today - 6 * 86400, now + 1, off


# ─────────────────────────────────────────────────────────────── настройки

def _settings_payload():
    # Ключей route.rush_factor и route.night_factor может ещё не быть в базе —
    # подкладываем значения по умолчанию, чтобы форма показала настоящие цифры,
    # а не пустые поля.
    values = dict(EXTRA_DEFAULTS)
    values.update(settings.load())
    secrets_state = {}
    for key in SECRET_KEYS:
        secrets_state[key] = bool(str(values.get(key) or '').strip())
        values[key] = ''          # наружу уходит пустое поле, а не пароль
    mail_conf = mailer.config()
    return {
        'values': values,
        'secrets': secrets_state,
        'choices': {k: list(v) for k, v in CHOICES.items()},
        'limits': {k: list(v) for k, v in LIMITS.items()},
        'meta': {
            'langs': list(i18n.LANGS),
            'payment_providers': payments.providers(),
            'payment_active': payments.provider(),
            'mail_ready': mailer.configured(mail_conf),
            'mail_queue': mailer.queue_size(),
            'mail_templates': mailer.templates(),
            'tz_offset': _tz_offset(),
            'now': db.now(),
        },
    }


@router.get(API + '/admin/settings')
def settings_get(ctx):
    _admin(ctx)
    return _settings_payload()


@router.put(API + '/admin/settings')
def settings_put(ctx):
    """Сохранение настроек. Принимаем только знакомые ключи и приводим значения
    к тому же типу, что у значения по умолчанию."""
    user = _admin(ctx)
    incoming = _body(ctx)
    if not isinstance(incoming, dict) or not incoming:
        bad('Нечего сохранять', 'empty')

    clean = {}
    for key, value in incoming.items():
        key = str(key).strip()
        if len(key) > 64 or not any(key.startswith(p) for p in SETTING_PREFIXES):
            continue
        if key in SECRET_KEYS and not str(value or '').strip():
            continue                       # пустое поле пароля значит «оставить как было»
        clean[key] = _setting_value(key, value)
    if not clean:
        bad('Ни одной знакомой настройки в запросе не нашлось', 'empty')

    # процент комиссии больше сотни — это всегда опечатка, а не тариф
    kind = clean.get('commission.kind', settings.get('commission.kind', 'percent'))
    if kind == 'percent' and 'commission.value' in clean:
        clean['commission.value'] = min(max(clean['commission.value'], 0), 100)

    settings.put_many(clean)
    keys = sorted(clean)
    log('админ', user.get('email'), 'сохранил настройки:', ', '.join(keys))
    HUB.publish('admin', 'settings', {'keys': keys, 'at': db.now()})
    payload = _settings_payload()
    payload['saved'] = keys
    return payload


def _setting_value(key, value):
    ref = settings.DEFAULTS.get(key, EXTRA_DEFAULTS.get(key))
    if key in CHOICES:
        got = str(value).strip().lower()
        if got not in CHOICES[key]:
            bad('Для «%s» доступно: %s' % (key, ', '.join(CHOICES[key])), 'bad_choice')
        return got
    if isinstance(ref, bool):
        return _as_bool(value)
    if isinstance(ref, int):
        return _clamp(key, _as_int(value, key))
    if isinstance(ref, float):
        return _clamp(key, _as_float(value, key))
    if isinstance(ref, str):
        return str(value if value is not None else '').strip()[:1000]
    if isinstance(value, (dict, list, bool, int, float)):
        return value                      # ключ без значения по умолчанию, например mail.templates
    return str(value or '')[:4000]


# ─────────────────────────────────────────────────────────────── тарифы

TARIFF_MONEY = ('base_price', 'per_km', 'per_min', 'min_price',
                'waiting_per_min', 'loader_hour_price')
TARIFF_INT = ('included_min', 'waiting_free_min', 'loaders_included',
              'body_w', 'body_d', 'body_h', 'capacity_kg', 'sort')
TARIFF_FLOAT = ('included_km', 'loader_min_hours')
TARIFF_TEXT = ('name_ru', 'name_ky', 'desc_ru', 'desc_ky', 'vehicle_class', 'icon')


def _catalog_fields(body, money, ints, floats, texts):
    """Общая часть разбора тарифа и допуслуги: только знакомые поля, только числа."""
    out = {}
    for f in money + ints:
        if f in body:
            out[f] = max(0, _as_int(body[f], f))
    for f in floats:
        if f in body:
            out[f] = max(0.0, _as_float(body[f], f))
    for f in texts:
        if f in body:
            out[f] = str(body[f] or '').strip()[:200] or None
    if 'active' in body:
        out['active'] = 1 if _as_bool(body['active']) else 0
    return out


def _code_of(body, table, current_id=None):
    code = str(body.get('code') or '').strip().lower()
    if not CODE_RX.match(code):
        bad('Код пишется латиницей и цифрами, от 2 до 32 символов', 'bad_code')
    twin = db.row('SELECT id FROM %s WHERE code=?' % table, (code,))
    if twin and twin['id'] != current_id:
        conflict('Такой код уже занят')
    return code


@router.get(API + '/admin/tariffs')
def tariffs_list(ctx):
    _admin(ctx)
    rows = db.rows('SELECT * FROM tariffs ORDER BY sort, id')
    used = {r['tariff_id']: r['n'] for r in db.rows(
        'SELECT tariff_id, COUNT(*) n FROM orders GROUP BY tariff_id')}
    for r in rows:
        r['orders_count'] = used.get(r['id'], 0)
    return {'items': rows, 'total': len(rows)}


@router.get(API + '/admin/tariffs/{tid}')
def tariff_get(ctx, tid):
    _admin(ctx)
    row = db.row('SELECT * FROM tariffs WHERE id=?', (_as_int(tid, 'id'),))
    if not row:
        not_found('Такого тарифа нет')
    row['orders_count'] = db.value('SELECT COUNT(*) FROM orders WHERE tariff_id=?',
                                   (row['id'],), 0)
    return row


@router.post(API + '/admin/tariffs')
def tariff_create(ctx):
    user = _admin(ctx)
    body = _body(ctx)
    data = _catalog_fields(body, TARIFF_MONEY, TARIFF_INT, TARIFF_FLOAT, TARIFF_TEXT)
    data['code'] = _code_of(body, 'tariffs')
    for need in ('name_ru', 'name_ky'):
        if not data.get(need):
            bad('Название на двух языках обязательно', 'field_required')
    data.setdefault('active', 1)
    tid = db.insert('tariffs', data)
    log('админ', user.get('email'), 'завёл тариф', data['code'])
    HUB.publish('admin', 'settings', {'keys': ['tariffs'], 'at': db.now()})
    return db.row('SELECT * FROM tariffs WHERE id=?', (tid,)), 201


@router.patch(API + '/admin/tariffs/{tid}')
def tariff_patch(ctx, tid):
    user = _admin(ctx)
    tid = _as_int(tid, 'id')
    row = db.row('SELECT * FROM tariffs WHERE id=?', (tid,))
    if not row:
        not_found('Такого тарифа нет')
    body = _body(ctx)
    data = _catalog_fields(body, TARIFF_MONEY, TARIFF_INT, TARIFF_FLOAT, TARIFF_TEXT)
    if 'code' in body:
        data['code'] = _code_of(body, 'tariffs', tid)
    if data.get('name_ru') is None and 'name_ru' in body:
        bad('Без названия тариф не сохранить', 'field_required')
    if not data:
        bad('Нечего менять', 'empty')
    db.update('tariffs', data, 'id=?', (tid,))
    log('админ', user.get('email'), 'правил тариф', row['code'], '·', ', '.join(sorted(data)))
    HUB.publish('admin', 'settings', {'keys': ['tariffs'], 'at': db.now()})
    return db.row('SELECT * FROM tariffs WHERE id=?', (tid,))


@router.delete(API + '/admin/tariffs/{tid}')
def tariff_delete(ctx, tid):
    """Тариф, по которому были заказы, не удаляем — выключаем. Иначе в старых
    заказах пропадёт название, и отчёт за прошлый месяц перестанет читаться."""
    user = _admin(ctx)
    tid = _as_int(tid, 'id')
    row = db.row('SELECT * FROM tariffs WHERE id=?', (tid,))
    if not row:
        not_found('Такого тарифа нет')
    used = db.value('SELECT COUNT(*) FROM orders WHERE tariff_id=?', (tid,), 0)
    if used:
        db.update('tariffs', {'active': 0}, 'id=?', (tid,))
        log('админ', user.get('email'), 'выключил тариф', row['code'])
        return {'ok': True, 'deactivated': True, 'orders_count': used,
                'message': 'По тарифу есть %d заказов, поэтому он выключен, а не удалён' % used}
    db.execute('DELETE FROM tariffs WHERE id=?', (tid,))
    log('админ', user.get('email'), 'удалил тариф', row['code'])
    return {'ok': True, 'deleted': True}


# ─────────────────────────────────────────────────────────────── допуслуги

EXTRA_MONEY = ('price',)
EXTRA_INT = ('sort',)
EXTRA_FLOAT = ('min_qty', 'max_qty', 'step')
EXTRA_TEXT = ('name_ru', 'name_ky', 'unit_ru', 'unit_ky')


def _extra_body(ctx, current=None):
    body = _body(ctx)
    data = _catalog_fields(body, EXTRA_MONEY, EXTRA_INT, EXTRA_FLOAT, EXTRA_TEXT)
    if 'kind' in body:
        kind = str(body['kind'] or '').strip().lower()
        if kind not in EXTRA_KINDS:
            bad('Вид услуги бывает: %s' % ', '.join(EXTRA_KINDS), 'bad_kind')
        data['kind'] = kind
    if 'tariff_ids' in body:
        raw = body['tariff_ids']
        if raw in (None, '', [], 'all'):
            data['tariff_ids'] = None          # пусто значит «для всех тарифов»
        elif isinstance(raw, list):
            ids = [int(x) for x in raw if str(x).strip().lstrip('-').isdigit()]
            data['tariff_ids'] = db.jdump(ids) if ids else None
        else:
            bad('Список тарифов ждёт массив идентификаторов', 'bad_field')
    low = data.get('min_qty', (current or {}).get('min_qty', 1))
    high = data.get('max_qty', (current or {}).get('max_qty', 20))
    if high and low and high < low:
        bad('Максимальное количество меньше минимального', 'bad_range')
    if 'step' in data and data['step'] <= 0:
        bad('Шаг количества должен быть больше нуля', 'bad_range')
    return body, data


@router.get(API + '/admin/extras')
def extras_list(ctx):
    _admin(ctx)
    rows = db.rows('SELECT * FROM extras ORDER BY sort, id')
    for r in rows:
        r['tariff_ids'] = db.jload(r.get('tariff_ids'), None)
    return {'items': rows, 'total': len(rows)}


@router.get(API + '/admin/extras/{eid}')
def extra_get(ctx, eid):
    _admin(ctx)
    row = db.row('SELECT * FROM extras WHERE id=?', (_as_int(eid, 'id'),))
    if not row:
        not_found('Такой услуги нет')
    row['tariff_ids'] = db.jload(row.get('tariff_ids'), None)
    return row


@router.post(API + '/admin/extras')
def extra_create(ctx):
    user = _admin(ctx)
    body, data = _extra_body(ctx)
    data['code'] = _code_of(body, 'extras')
    for need in ('name_ru', 'name_ky'):
        if not data.get(need):
            bad('Название на двух языках обязательно', 'field_required')
    data.setdefault('kind', 'fixed')
    data.setdefault('active', 1)
    eid = db.insert('extras', data)
    log('админ', user.get('email'), 'завёл услугу', data['code'])
    HUB.publish('admin', 'settings', {'keys': ['extras'], 'at': db.now()})
    return db.row('SELECT * FROM extras WHERE id=?', (eid,)), 201


@router.patch(API + '/admin/extras/{eid}')
def extra_patch(ctx, eid):
    user = _admin(ctx)
    eid = _as_int(eid, 'id')
    row = db.row('SELECT * FROM extras WHERE id=?', (eid,))
    if not row:
        not_found('Такой услуги нет')
    body, data = _extra_body(ctx, row)
    if 'code' in body:
        data['code'] = _code_of(body, 'extras', eid)
    if not data:
        bad('Нечего менять', 'empty')
    db.update('extras', data, 'id=?', (eid,))
    log('админ', user.get('email'), 'правил услугу', row['code'])
    HUB.publish('admin', 'settings', {'keys': ['extras'], 'at': db.now()})
    fresh = db.row('SELECT * FROM extras WHERE id=?', (eid,))
    fresh['tariff_ids'] = db.jload(fresh.get('tariff_ids'), None)
    return fresh


@router.delete(API + '/admin/extras/{eid}')
def extra_delete(ctx, eid):
    """Услуги живут в заказах по коду, а не по ссылке, поэтому старые коды не удаляем,
    если они уже встречались в заказах."""
    user = _admin(ctx)
    eid = _as_int(eid, 'id')
    row = db.row('SELECT * FROM extras WHERE id=?', (eid,))
    if not row:
        not_found('Такой услуги нет')
    used = db.value("SELECT COUNT(*) FROM orders WHERE extras LIKE ?",
                    ('%"%s"%' % row['code'],), 0)
    if used:
        db.update('extras', {'active': 0}, 'id=?', (eid,))
        return {'ok': True, 'deactivated': True, 'orders_count': used,
                'message': 'Услуга встречается в %d заказах, поэтому выключена' % used}
    db.execute('DELETE FROM extras WHERE id=?', (eid,))
    log('админ', user.get('email'), 'удалил услугу', row['code'])
    return {'ok': True, 'deleted': True}


# ─────────────────────────────────────────────────────────────── заказы

ORDER_LIST_SQL = (
    'SELECT o.id, o.public_id, o.status, o.created_at, o.assigned_at, o.done_at, '
    '       o.cancelled_at, o.distance_m, o.duration_s, o.loaders, o.points, '
    '       o.price_total, o.commission, o.courier_payout, o.payment_method, '
    '       o.payment_status, o.paid_amount, o.client_rating, o.lang, '
    '       o.client_id, o.courier_id, o.tariff_id, '
    '       c.name AS client_name, c.phone AS client_phone, '
    '       u.name AS courier_name, u.phone AS courier_phone, '
    '       t.code AS tariff_code, t.name_ru AS tariff_name_ru, t.name_ky AS tariff_name_ky '
    'FROM orders o '
    'LEFT JOIN clients c ON c.id = o.client_id '
    'LEFT JOIN users u ON u.id = o.courier_id '
    'LEFT JOIN tariffs t ON t.id = o.tariff_id ')


def _order_filters(ctx):
    off = _tz_offset()
    where, args = [], []
    raw_status = (ctx.q('status') or '').strip()
    if raw_status and raw_status != 'all':
        wanted = [s for s in re.split(r'[,\s]+', raw_status) if s in ORDER_STATUSES]
        if raw_status == 'live':
            wanted = list(LIVE_STATUSES)
        if wanted:
            where.append('o.status IN (%s)' % ','.join('?' * len(wanted)))
            args += wanted
    frm = _stamp(ctx.q('from'), off)
    to = _stamp(ctx.q('to'), off, end=True)
    if frm is not None:
        where.append('o.created_at >= ?')
        args.append(frm)
    if to is not None:
        where.append('o.created_at < ?')
        args.append(to)
    q = (ctx.q('q') or '').strip()
    if q:
        like = '%' + q.replace('%', '') + '%'
        where.append('(o.public_id LIKE ? OR c.phone LIKE ? OR c.name LIKE ? '
                     'OR u.name LIKE ? OR o.points LIKE ?)')
        args += [q.upper() + '%', like, like, like, like]
    courier = ctx.qi('courier_id', 0)
    if courier:
        where.append('o.courier_id = ?')
        args.append(courier)
    client = ctx.qi('client_id', 0)
    if client:
        where.append('o.client_id = ?')
        args.append(client)
    return (' WHERE ' + ' AND '.join(where)) if where else '', args


def _addr_pair(points_json):
    pts = db.jload(points_json, []) or []
    first = (pts[0].get('addr') if pts else '') or ''
    last = (pts[-1].get('addr') if len(pts) > 1 else '') or ''
    return first, last, max(0, len(pts) - 2)


def _order_row(r):
    frm, to, stops = _addr_pair(r.pop('points', None))
    r['from_addr'], r['to_addr'], r['stops'] = frm, to, stops
    r['status_name'] = i18n.status_name(r['status'], 'ru')
    r['payment_name'] = i18n.payment_name(r.get('payment_status'), 'ru')
    return r


@router.get(API + '/admin/orders')
def orders_list(ctx):
    _admin(ctx)
    where, args = _order_filters(ctx)
    page, per = _page(ctx)
    total = db.value('SELECT COUNT(*) FROM orders o '
                     'LEFT JOIN clients c ON c.id = o.client_id '
                     'LEFT JOIN users u ON u.id = o.courier_id' + where, args, 0)
    rows = db.rows(ORDER_LIST_SQL + where + ' ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?',
                   args + [per, (page - 1) * per])
    sums = db.row('SELECT COUNT(*) n, '
                  "COALESCE(SUM(CASE WHEN o.status='done' THEN o.price_total END),0) revenue, "
                  "COALESCE(SUM(CASE WHEN o.status='done' THEN o.commission END),0) commission "
                  'FROM orders o LEFT JOIN clients c ON c.id = o.client_id '
                  'LEFT JOIN users u ON u.id = o.courier_id' + where, args) or {}
    return {
        'items': [_order_row(r) for r in rows],
        'page': page, 'per_page': per, 'total': total,
        'pages': max(1, -(-total // per)),
        'totals': {'orders': sums.get('n', 0), 'revenue': sums.get('revenue', 0),
                   'commission': sums.get('commission', 0)},
        'statuses': list(ORDER_STATUSES),
    }


def _order(oid):
    row = db.row('SELECT * FROM orders WHERE id=?', (_as_int(oid, 'id'),))
    if not row:
        not_found(i18n.error_text('order_not_found'))
    return row


def _order_full(order):
    """Карточка заказа со всей подноготной: лента событий, предложения, деньги.

    Ссылку отслеживания отдаём вместе с токеном намеренно: клиент теряет её чаще,
    чем кажется, и оператор должен уметь отправить её заново, не заводя новый заказ.
    """
    out = dict(order)
    base = str(settings.get('service.base_url', '') or '').rstrip('/')
    out['track_url'] = ('%s/?o=%s&t=%s' % (base, order['public_id'], order['track_token'])
                        if base else '')
    out['points'] = db.jload(order.get('points'), []) or []
    out['route'] = db.jload(order.get('route'), []) or []
    out['extras'] = db.jload(order.get('extras'), []) or []
    out['status_name'] = i18n.status_name(order['status'], 'ru')
    out['payment_name'] = i18n.payment_name(order.get('payment_status'), 'ru')
    out['client'] = db.row('SELECT id, phone, name, lang, orders_count, blocked, '
                           'rating_sum, rating_count, created_at FROM clients WHERE id=?',
                           (order['client_id'],)) if order.get('client_id') else None
    out['courier'] = dispatch.courier_card(order['courier_id']) if order.get('courier_id') else None
    out['events'] = [
        {'id': e['id'], 'at': e['at'], 'actor': e['actor'], 'type': e['type'],
         'data': db.jload(e['data'], None)}
        for e in db.rows('SELECT * FROM order_events WHERE order_id=? ORDER BY at, id',
                         (order['id'],))]
    out['offers'] = db.rows(
        'SELECT f.id, f.courier_id, f.sent_at, f.expires_at, f.status, f.distance_m, f.score, '
        '       u.name AS courier_name FROM offers f '
        'LEFT JOIN users u ON u.id = f.courier_id '
        'WHERE f.order_id=? ORDER BY f.id', (order['id'],))
    # Разбивка по позициям собирается тем же кодом, что и чек клиенту.
    try:
        out['breakdown'] = pricing.quote_order(order)['breakdown']
    except ApiError:
        out['breakdown'] = []              # тариф успели удалить — карточка всё равно нужна
    return out


@router.get(API + '/admin/orders/{oid}')
def order_get(ctx, oid):
    _admin(ctx)
    return _order_full(_order(oid))


def _free_courier(courier_id):
    if courier_id:
        db.execute('UPDATE couriers SET busy=0 WHERE user_id=?', (courier_id,))


def _admin_cancel(order, user, reason):
    t = db.now()
    with db.tx():
        if order['status'] in ('cancelled', 'done'):
            conflict('Заказ уже закрыт')
        db.update('orders', {'status': 'cancelled', 'cancelled_at': t,
                             'cancelled_by': 'admin', 'cancel_reason': reason or None},
                  'id=?', (order['id'],))
        _free_courier(order.get('courier_id'))
        _event(order['id'], _actor(user), 'cancelled', {'reason': reason, 'by': 'admin'})
    dispatch.cancel_search(order['id'])
    return 'cancelled'


def _admin_assign(order, user, courier_id):
    """Ручное назначение курьера из админки: когда диспетчер не справился,
    а машина стоит рядом и оператор это видит."""
    courier = db.row('SELECT u.id, u.name, u.status, c.busy FROM users u '
                     'JOIN couriers c ON c.user_id = u.id WHERE u.id=?', (courier_id,))
    if not courier:
        not_found('Такого курьера нет')
    if courier['status'] != 'active':
        conflict('Курьер не активен, назначать нельзя')
    if courier['busy']:
        conflict('Курьер сейчас на другом заказе')
    t = db.now()
    with db.tx():
        if order['status'] in ('done', 'cancelled'):
            conflict('Заказ уже закрыт')
        _free_courier(order.get('courier_id'))
        db.update('orders', {'courier_id': courier_id, 'status': 'assigned',
                             'assigned_at': t}, 'id=?', (order['id'],))
        db.execute('UPDATE couriers SET busy=1 WHERE user_id=?', (courier_id,))
        db.execute("UPDATE offers SET status='expired' WHERE order_id=? AND status='sent'",
                   (order['id'],))
        _event(order['id'], _actor(user), 'assigned',
               {'courier_id': courier_id, 'by': 'admin'})
    dispatch.cancel_search(order['id'])
    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    HUB.publish('courier:%s' % courier_id, 'order', dispatch.order_card(fresh, full=True))
    return 'assigned'


def _admin_status(order, user, status):
    """Смена статуса руками. Отмена, возврат в поиск и закрытие — отдельными путями,
    остальные статусы просто проставляются вместе со своей отметкой времени."""
    if status not in ORDER_STATUSES:
        bad('Неизвестный статус заказа', 'bad_status')
    if status == order['status']:
        return None
    if status == 'cancelled':
        return _admin_cancel(order, user, 'Отменил оператор')
    if status == 'searching':
        with db.tx():
            db.update('orders', {'status': 'draft', 'courier_id': None, 'assigned_at': None},
                      'id=?', (order['id'],))
            _free_courier(order.get('courier_id'))
            _event(order['id'], _actor(user), 'search_restart', {'by': 'admin'})
        dispatch.start_search(order['id'])
        return 'searching'

    t = db.now()
    patch = {'status': status}
    stamp = STATUS_STAMP.get(status)
    if stamp and not order.get(stamp):
        patch[stamp] = t
    with db.tx():
        db.update('orders', patch, 'id=?', (order['id'],))
        if status == 'done':
            _free_courier(order.get('courier_id'))
            if order.get('courier_id'):
                db.execute('UPDATE couriers SET orders_done = orders_done + 1 WHERE user_id=?',
                           (order['courier_id'],))
        _event(order['id'], _actor(user), 'status', {'status': status, 'by': 'admin'})
    return status


@router.patch(API + '/admin/orders/{oid}')
def order_patch(ctx, oid):
    user = _admin(ctx)
    order = _order(oid)
    body = _body(ctx)
    changed = []

    if 'comment' in body:
        db.update('orders', {'comment': str(body['comment'] or '').strip()[:500] or None},
                  'id=?', (order['id'],))
        _event(order['id'], _actor(user), 'comment', {'text': body['comment']})
        changed.append('comment')

    if 'courier_id' in body:
        cid = _as_int(body['courier_id'] or 0, 'courier_id')
        if cid:
            changed.append(_admin_assign(order, user, cid))
        else:
            with db.tx():
                _free_courier(order.get('courier_id'))
                db.update('orders', {'courier_id': None, 'assigned_at': None, 'status': 'draft'},
                          'id=?', (order['id'],))
                _event(order['id'], _actor(user), 'unassigned', {'by': 'admin'})
            changed.append('unassigned')
        order = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))

    if 'payment' in body or 'payment_status' in body:
        want = str(body.get('payment') or body.get('payment_status') or '').strip().lower()
        if want in ('paid', 'ok', 'true'):
            payments.mark_manual(order, True, actor=_actor(user))
            changed.append('payment:paid')
        elif want in ('pending', 'none', 'unpaid', 'reset'):
            payments.mark_manual(order, False, actor=_actor(user),
                                 note=str(body.get('note') or '')[:200])
            changed.append('payment:reset')
        else:
            bad('Оплату можно отметить как paid или pending', 'bad_field')
        order = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))

    if 'status' in body:
        done = _admin_status(order, user, str(body['status']).strip().lower())
        if done:
            changed.append('status:' + done)

    if not changed:
        bad('Нечего менять', 'empty')
    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    _publish(fresh)
    log('админ', user.get('email'), 'правил заказ', fresh['public_id'], '·', ', '.join(changed))
    return {'ok': True, 'changed': changed, 'order': _order_full(fresh)}


# ─────────────────────────────────────────────────────────────── курьеры

COURIER_SQL = (
    'SELECT u.id, u.email, u.name, u.phone, u.status, u.lang, u.avatar, '
    '       u.created_at, u.last_login_at, '
    '       c.vehicle_class, c.car_model, c.car_plate, c.car_color, '
    '       c.body_w, c.body_d, c.body_h, c.capacity_kg, '
    '       c.rating_sum, c.rating_count, c.orders_done, c.orders_cancelled, '
    '       c.offers_sent, c.offers_taken, c.priority, c.online, c.busy, '
    '       c.lat, c.lng, c.heading, c.geo_at, c.balance, c.note, '
    '       c.verify_status, c.verify_photo, c.verify_note, c.verified_at, c.photo '
    "FROM users u JOIN couriers c ON c.user_id = u.id WHERE u.role='courier' ")


def _photo_url(name):
    """Ссылка на файл фото. Отдаёт его отдельный маршрут, который проверяет права:
    паспорт видят только сам курьер и админ."""
    name = str(name or '').strip()
    return (API + '/uploads/' + name) if name else None


def _courier_row(r):
    r['rating'] = round(dispatch.rating_of(r['rating_sum'], r['rating_count']), 2)
    sent = r.get('offers_sent') or 0
    r['acceptance'] = round((r.get('offers_taken') or 0) / sent, 3) if sent else None
    r['status_name'] = i18n.user_status_name(r['status'], 'ru')
    r['at'] = [r['lat'], r['lng']] if r.get('lat') is not None else None
    # Проверка документов: видно прямо в списке, чтобы не открывать карточку.
    verify = str(r.get('verify_status') or 'none')
    r['verify_status'] = verify
    r['verify_name'] = VERIFY_NAME.get(verify, VERIFY_NAME['none'])
    r['verified'] = verify == 'approved'
    r['verify_photo_url'] = _photo_url(r.get('verify_photo'))
    r['photo_url'] = _photo_url(r.get('photo'))
    return r


@router.get(API + '/admin/couriers')
def couriers_list(ctx):
    _admin(ctx)
    where, args = [], []
    status = (ctx.q('status') or '').strip()
    if status in USER_STATUSES:
        where.append('u.status = ?')
        args.append(status)
    verify = (ctx.q('verify') or ctx.q('verify_status') or '').strip()
    if verify in VERIFY_STATUSES:
        where.append('c.verify_status = ?')
        args.append(verify)
    if ctx.q('online') in ('1', 'true', 'yes'):
        where.append('c.online = 1')
    q = (ctx.q('q') or '').strip()
    if q:
        like = '%' + q.replace('%', '') + '%'
        where.append('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR c.car_plate LIKE ?)')
        args += [like, like, like, like]
    tail = (' AND ' + ' AND '.join(where)) if where else ''
    page, per = _page(ctx)
    total = db.value("SELECT COUNT(*) FROM users u JOIN couriers c ON c.user_id=u.id "
                     "WHERE u.role='courier'" + tail, args, 0)
    rows = db.rows(COURIER_SQL + tail +
                   ' ORDER BY c.online DESC, u.status, u.id DESC LIMIT ? OFFSET ?',
                   args + [per, (page - 1) * per])
    counts = {r['status']: r['n'] for r in db.rows(
        "SELECT status, COUNT(*) n FROM users WHERE role='courier' GROUP BY status")}
    by_verify = _verify_counts()
    return {
        'items': [_courier_row(r) for r in rows],
        'page': page, 'per_page': per, 'total': total, 'pages': max(1, -(-total // per)),
        'counts': {'pending': counts.get('pending', 0), 'active': counts.get('active', 0),
                   'blocked': counts.get('blocked', 0),
                   'online': db.value('SELECT COUNT(*) FROM couriers WHERE online=1', (), 0),
                   # Сколько анкет ждёт проверки — цифра для значка в меню.
                   'verify_pending': by_verify['pending']},
        'verify_counts': by_verify,
    }


def _courier(cid):
    row = db.row(COURIER_SQL + ' AND u.id=?', (_as_int(cid, 'id'),))
    if not row:
        not_found('Такого курьера нет')
    return _courier_row(row)


@router.get(API + '/admin/couriers/{cid}')
def courier_get(ctx, cid):
    _admin(ctx)
    row = _courier(cid)
    row['orders'] = [_order_row(r) for r in db.rows(
        ORDER_LIST_SQL + ' WHERE o.courier_id=? ORDER BY o.created_at DESC LIMIT 20', (row['id'],))]
    money = db.row("SELECT COALESCE(SUM(price_total),0) revenue, "
                   'COALESCE(SUM(courier_payout),0) payout, COALESCE(SUM(commission),0) commission '
                   "FROM orders WHERE courier_id=? AND status='done'", (row['id'],)) or {}
    row['money'] = money
    return row


COURIER_TEXT = ('car_model', 'car_plate', 'car_color', 'vehicle_class', 'note')
COURIER_INT = ('body_w', 'body_d', 'body_h', 'capacity_kg')


@router.patch(API + '/admin/couriers/{cid}')
def courier_patch(ctx, cid):
    """Одобрение, блокировка, приоритет, заметка и отзыв проверки документов.

    Смена статуса аккаунта уходит письмом: человек ждёт ответа и должен узнать
    о нём не из приложения, а сразу. Решение по документам с письмом — это
    отдельный маршрут /admin/verify/{id}, здесь только ручная правка.
    """
    user = _admin(ctx)
    row = _courier(cid)
    body = _body(ctx)
    changed = []

    user_patch, courier_patch = {}, {}
    if 'name' in body:
        user_patch['name'] = str(body['name'] or '').strip()[:120]
    if 'phone' in body:
        phone = auth.normalize_phone(str(body['phone'] or ''))
        if not phone:
            bad(i18n.error_text('bad_phone'), 'bad_phone')
        user_patch['phone'] = phone
    for f in COURIER_TEXT:
        if f in body:
            courier_patch[f] = str(body[f] or '').strip()[:200] or None
    for f in COURIER_INT:
        if f in body:
            courier_patch[f] = max(0, _as_int(body[f], f))
    if 'priority' in body:
        courier_patch['priority'] = min(50, max(-50, _as_int(body['priority'], 'priority')))
    if 'balance' in body:
        courier_patch['balance'] = _as_int(body['balance'], 'balance')

    # Проверку документов отсюда можно отозвать или вернуть — например, когда
    # у человека сменилась машина. Решение по очереди с письмом живёт отдельно,
    # в PATCH /admin/verify/{id}, здесь письма нет.
    new_verify = None
    if 'verify_status' in body:
        new_verify = str(body['verify_status'] or '').strip().lower()
        if new_verify not in VERIFY_STATUSES:
            bad('Проверка бывает: %s' % ', '.join(VERIFY_STATUSES), 'bad_status')
        if new_verify != row['verify_status']:
            courier_patch['verify_status'] = new_verify
            courier_patch['verified_at'] = db.now()
            # Замечание берём только из verify_note: поле note — это внутренняя
            # заметка о курьере, и путать их нельзя, её человек не видит.
            if 'verify_note' in body:
                courier_patch['verify_note'] = str(body['verify_note'] or '').strip()[:300] or None
            if new_verify != 'approved':
                courier_patch['online'] = 0    # без проверки на линии делать нечего
        else:
            new_verify = None

    new_status = None
    if 'status' in body:
        new_status = str(body['status'] or '').strip().lower()
        if new_status not in USER_STATUSES:
            bad('Статус бывает: %s' % ', '.join(USER_STATUSES), 'bad_status')
        if new_status != row['status']:
            user_patch['status'] = new_status
            if new_status != 'active':
                courier_patch['online'] = 0      # заблокированный не должен висеть на линии
        else:
            new_status = None

    if user_patch:
        db.update('users', user_patch, 'id=?', (row['id'],))
        changed += sorted(user_patch)
    if courier_patch:
        db.update('couriers', courier_patch, 'user_id=?', (row['id'],))
        changed += sorted(courier_patch)
    if not changed:
        bad('Нечего менять', 'empty')

    mail_sent = False
    if new_status and row.get('email'):
        reason = str(body.get('reason') or body.get('note') or '').strip()[:300]
        base = str(settings.get('service.base_url', '') or '').rstrip('/')
        if new_status == 'active':
            mail_sent = mailer.send(row['email'], 'courier_approved',
                                    {'name': row['name'], 'url': (base + '/courier') if base else ''},
                                    row.get('lang') or 'ru')
        elif new_status == 'blocked':
            mail_sent = mailer.send(row['email'], 'courier_rejected',
                                    {'name': row['name'], 'reason': reason},
                                    row.get('lang') or 'ru')
        HUB.publish('courier:%s' % row['id'], 'status',
                    {'status': new_status, 'reason': reason})
    if new_verify:
        HUB.publish('courier:%s' % row['id'], 'verify',
                    {'status': new_verify, 'at': db.now(),
                     'note': courier_patch.get('verify_note', row['verify_note']),
                     'text': dispatch.VERIFY_TEXT[new_verify]})
    log('админ', user.get('email'), 'правил курьера', row['id'], '·', ', '.join(changed))
    fresh = _courier(row['id'])
    return {'ok': True, 'changed': changed, 'mail_sent': bool(mail_sent), 'courier': fresh}


# ─────────────────────────────────────────────────────────────── проверка документов

def _verify_counts():
    """Сколько курьеров в каждом состоянии проверки. Ноли тоже возвращаем:
    экрану удобнее показать «0», чем разбираться с отсутствующим ключом."""
    rows = db.rows("SELECT c.verify_status s, COUNT(*) n "
                   'FROM couriers c JOIN users u ON u.id = c.user_id '
                   "WHERE u.role='courier' GROUP BY c.verify_status")
    got = {str(r['s'] or 'none'): r['n'] for r in rows}
    return {s: got.get(s, 0) for s in VERIFY_STATUSES}


def _verify_row(r):
    """Строка очереди: кто, на чём ездит, когда подал и что за фото прислал."""
    row = _courier_row(r)
    return {
        'user_id': row['id'], 'name': row['name'], 'phone': row['phone'],
        'email': row['email'], 'lang': row['lang'], 'status': row['status'],
        'status_name': row['status_name'],
        'car': {'model': row['car_model'], 'plate': row['car_plate'],
                'color': row['car_color'], 'class': row['vehicle_class'],
                'capacity_kg': row['capacity_kg'],
                'body': {'w': row['body_w'], 'd': row['body_d'], 'h': row['body_h']}},
        'verify_status': row['verify_status'], 'verify_name': row['verify_name'],
        'verify_note': row['verify_note'],
        'photo': row['verify_photo'], 'photo_url': row['verify_photo_url'],
        'avatar_url': row['photo_url'],
        'registered_at': row['created_at'],       # когда завёл аккаунт
        'verified_at': row['verified_at'],        # когда прислал фото или получил решение
        'orders_done': row['orders_done'], 'rating': row['rating'],
    }


@router.get(API + '/admin/verify')
def verify_queue(ctx):
    """Очередь на проверку. По умолчанию — те, кто ждёт решения; ?status=all
    показывает всех, чтобы можно было пересмотреть старый отказ."""
    _admin(ctx)
    want = (ctx.q('status') or 'pending').strip().lower()
    where, args = '', []
    if want in VERIFY_STATUSES:
        where = ' AND c.verify_status = ?'
        args = [want]
    elif want not in ('all', ''):
        bad('Проверка бывает: %s' % ', '.join(VERIFY_STATUSES + ('all',)), 'bad_status')

    page, per = _page(ctx)
    total = db.value('SELECT COUNT(*) FROM users u JOIN couriers c ON c.user_id=u.id '
                     "WHERE u.role='courier'" + where, args, 0)
    # Первыми те, кто ждёт дольше всех: очередь должна быть справедливой.
    rows = db.rows(COURIER_SQL + where +
                   ' ORDER BY COALESCE(c.verified_at, u.created_at), u.id LIMIT ? OFFSET ?',
                   args + [per, (page - 1) * per])
    return {
        'items': [_verify_row(r) for r in rows],
        'page': page, 'per_page': per, 'total': total, 'pages': max(1, -(-total // per)),
        'counts': _verify_counts(),
        'statuses': list(VERIFY_STATUSES),
        'filter': want if want in VERIFY_STATUSES else 'all',
    }


@router.patch(API + '/admin/verify/{uid}')
def verify_decide(ctx, uid):
    """Решение по документам: одобрить или отказать с причиной.

    Одобрение заодно открывает аккаунт: если анкета висела на модерации, человек
    после проверки документов должен просто войти и работать, а не ждать второго
    решения о том же самом. Отказ аккаунт не закрывает — курьеру нужно попасть
    внутрь, прочитать замечание и прислать фото заново.
    """
    user = _admin(ctx)
    row = _courier(uid)
    body = _body(ctx)

    decision = str(body.get('status') or body.get('verify_status') or '').strip().lower()
    if decision in ('approve', 'ok', 'yes'):
        decision = 'approved'
    elif decision in ('reject', 'no'):
        decision = 'rejected'
    if decision not in VERIFY_DECISIONS:
        bad('Решение бывает approved или rejected', 'bad_status')

    note = str(body.get('note') or body.get('reason') or '').strip()[:300]
    if decision == 'rejected' and not note:
        bad('Напишите, что не так с документами: человек должен понимать, '
            'что переснять', 'field_required')

    t = db.now()
    patch = {'verify_status': decision, 'verify_note': note or None, 'verified_at': t}
    if decision == 'rejected':
        patch['online'] = 0        # на линии стоять без проверки незачем
    user_patch = {}
    if decision == 'approved' and row['status'] == 'pending':
        user_patch['status'] = 'active'

    with db.tx():
        db.update('couriers', patch, 'user_id=?', (row['id'],))
        if user_patch:
            db.update('users', user_patch, 'id=?', (row['id'],))

    mail_sent = False
    if row.get('email'):
        base = str(settings.get('service.base_url', '') or '').rstrip('/')
        if decision == 'approved':
            mail_sent = mailer.send(row['email'], 'courier_approved',
                                    {'name': row['name'],
                                     'url': (base + '/courier') if base else ''},
                                    row.get('lang') or 'ru')
        else:
            mail_sent = mailer.send(row['email'], 'courier_rejected',
                                    {'name': row['name'], 'reason': note},
                                    row.get('lang') or 'ru')

    fresh = _courier(row['id'])
    # Приложение курьера слушает свою тему: экран проверки обновится сам,
    # человеку не придётся дёргать «обновить».
    HUB.publish('courier:%s' % row['id'], 'verify',
                {'status': decision, 'note': note or None, 'at': t,
                 'text': dispatch.VERIFY_TEXT[decision],
                 'user_status': fresh['status']})
    HUB.publish('admin', 'verify', {'user_id': row['id'], 'name': row['name'],
                                    'status': decision, 'at': t})
    log('админ', user.get('email'), 'проверка курьера', row['id'],
        '— одобрен' if decision == 'approved' else '— отказ: ' + (note or 'без причины'))
    return {'ok': True, 'status': decision, 'note': note or None,
            'mail_sent': bool(mail_sent), 'account_opened': bool(user_patch),
            'courier': fresh, 'counts': _verify_counts()}


# ─────────────────────────────────────────────────────────────── клиенты

@router.get(API + '/admin/clients')
def clients_list(ctx):
    _admin(ctx)
    where, args = [], []
    q = (ctx.q('q') or '').strip()
    if q:
        like = '%' + q.replace('%', '') + '%'
        where.append('(phone LIKE ? OR name LIKE ?)')
        args += [like, like]
    if ctx.q('blocked') in ('1', 'true', 'yes'):
        where.append('blocked = 1')
    tail = (' WHERE ' + ' AND '.join(where)) if where else ''
    page, per = _page(ctx)
    total = db.value('SELECT COUNT(*) FROM clients' + tail, args, 0)
    rows = db.rows('SELECT * FROM clients' + tail +
                   ' ORDER BY COALESCE(last_order_at, created_at) DESC, id DESC LIMIT ? OFFSET ?',
                   args + [per, (page - 1) * per])
    for r in rows:
        r['rating'] = round(r['rating_sum'] / r['rating_count'], 2) if r['rating_count'] else None
    return {'items': rows, 'page': page, 'per_page': per, 'total': total,
            'pages': max(1, -(-total // per))}


def _client(cid):
    row = db.row('SELECT * FROM clients WHERE id=?', (_as_int(cid, 'id'),))
    if not row:
        not_found('Такого клиента нет')
    row['rating'] = round(row['rating_sum'] / row['rating_count'], 2) if row['rating_count'] else None
    return row


@router.get(API + '/admin/clients/{cid}')
def client_get(ctx, cid):
    _admin(ctx)
    row = _client(cid)
    row['orders'] = [_order_row(r) for r in db.rows(
        ORDER_LIST_SQL + ' WHERE o.client_id=? ORDER BY o.created_at DESC LIMIT 20', (row['id'],))]
    row['money'] = db.row("SELECT COALESCE(SUM(price_total),0) spent, COUNT(*) done "
                          "FROM orders WHERE client_id=? AND status='done'", (row['id'],))
    return row


@router.patch(API + '/admin/clients/{cid}')
def client_patch(ctx, cid):
    user = _admin(ctx)
    row = _client(cid)
    body = _body(ctx)
    patch = {}
    if 'blocked' in body:
        patch['blocked'] = 1 if _as_bool(body['blocked']) else 0
    if 'name' in body:
        patch['name'] = str(body['name'] or '').strip()[:120] or None
    if 'lang' in body:
        patch['lang'] = i18n.norm_lang(body['lang'])
    if not patch:
        bad('Нечего менять', 'empty')
    db.update('clients', patch, 'id=?', (row['id'],))
    log('админ', user.get('email'), 'правил клиента', row['phone'], '·', ', '.join(sorted(patch)))
    return {'ok': True, 'changed': sorted(patch), 'client': _client(row['id'])}


# ─────────────────────────────────────────────────────────────── статистика

@router.get(API + '/admin/stats')
def stats(ctx):
    """Сводка за период: заказы, деньги, конверсия поиска, топ курьеров,
    разбивка по тарифам, по дням и по часам."""
    _admin(ctx)
    frm, to, off = _range(ctx)
    args = (frm, to)

    by_status = {r['status']: r for r in db.rows(
        'SELECT status, COUNT(*) n, COALESCE(SUM(price_total),0) total, '
        'COALESCE(SUM(commission),0) comm FROM orders '
        'WHERE created_at >= ? AND created_at < ? GROUP BY status', args)}
    orders_total = sum(r['n'] for r in by_status.values())
    done = by_status.get('done', {})
    done_n = done.get('n', 0)
    revenue = done.get('total', 0)
    commission = done.get('comm', 0)

    searched = db.value('SELECT COUNT(*) FROM orders WHERE created_at >= ? AND created_at < ? '
                        'AND searching_at IS NOT NULL', args, 0)
    assigned = db.value('SELECT COUNT(*) FROM orders WHERE created_at >= ? AND created_at < ? '
                        'AND assigned_at IS NOT NULL', args, 0)

    top = db.rows(
        'SELECT u.id, u.name, u.phone, COUNT(*) n, '
        'COALESCE(SUM(o.price_total),0) revenue, COALESCE(SUM(o.courier_payout),0) payout '
        'FROM orders o JOIN users u ON u.id = o.courier_id '
        "WHERE o.status='done' AND o.done_at >= ? AND o.done_at < ? "
        'GROUP BY u.id ORDER BY n DESC, revenue DESC LIMIT 10', args)

    by_tariff = db.rows(
        'SELECT o.tariff_id, t.code, t.name_ru, t.name_ky, COUNT(*) n, '
        'COALESCE(SUM(o.price_total),0) total, '
        "COALESCE(SUM(CASE WHEN o.status='done' THEN 1 ELSE 0 END),0) done "
        'FROM orders o LEFT JOIN tariffs t ON t.id = o.tariff_id '
        'WHERE o.created_at >= ? AND o.created_at < ? '
        'GROUP BY o.tariff_id ORDER BY n DESC', args)

    hours = {int(r['h']): r for r in db.rows(
        "SELECT CAST(strftime('%H', created_at + ?, 'unixepoch') AS INTEGER) h, COUNT(*) n, "
        'COALESCE(SUM(price_total),0) total FROM orders '
        'WHERE created_at >= ? AND created_at < ? GROUP BY h', (off, frm, to))}
    by_hour = [{'hour': h, 'orders': hours.get(h, {}).get('n', 0),
                'total': hours.get(h, {}).get('total', 0)} for h in range(24)]

    by_day = db.rows(
        "SELECT date(created_at + ?, 'unixepoch') d, COUNT(*) n, "
        "COALESCE(SUM(CASE WHEN status='done' THEN price_total END),0) revenue "
        'FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY d ORDER BY d',
        (off, frm, to))

    couriers_new = db.value("SELECT COUNT(*) FROM users WHERE role='courier' "
                            'AND created_at >= ? AND created_at < ?', args, 0)
    clients_new = db.value('SELECT COUNT(*) FROM clients WHERE created_at >= ? AND created_at < ?',
                           args, 0)

    # Новые против вернувшихся. Вернувшийся — тот, кто заказывал в этом периоде,
    # а завёлся раньше. Это главное число сервиса: если оно не растёт, реклама
    # приводит людей, которые не возвращаются, и деньги уходят впустую.
    ordered = db.rows('SELECT o.client_id, COUNT(*) n, MIN(c.created_at) born '
                      'FROM orders o JOIN clients c ON c.id = o.client_id '
                      'WHERE o.created_at >= ? AND o.created_at < ? GROUP BY o.client_id', args)
    clients_active = len(ordered)
    clients_back = sum(1 for r in ordered if (r['born'] or 0) < frm)
    clients_repeat = sum(1 for r in ordered if (r['n'] or 0) > 1)
    orders_per_client = (sum(r['n'] for r in ordered) * 100 // clients_active
                         if clients_active else 0)

    # Отмены: кто отменил, почему и на каком шаге. Шаг восстанавливаем по отметкам
    # времени — отдельного поля для него нет, а знать его важнее всего: отмена до
    # поиска машины ничего не стоит, отмена после подачи стоит курьеру дороги.
    cancelled_rows = db.rows(
        'SELECT cancelled_by, cancel_reason, searching_at, assigned_at '
        "FROM orders WHERE status='cancelled' AND cancelled_at >= ? AND cancelled_at < ?", args)
    steps = {'before_search': 0, 'searching': 0, 'assigned': 0}
    reasons, by_whom = {}, {}
    for r in cancelled_rows:
        if r.get('assigned_at'):
            steps['assigned'] += 1
        elif r.get('searching_at'):
            steps['searching'] += 1
        else:
            steps['before_search'] += 1
        why = (r.get('cancel_reason') or '').strip() or '—'
        reasons[why] = reasons.get(why, 0) + 1
        who = r.get('cancelled_by') or 'system'
        by_whom[who] = by_whom.get(who, 0) + 1
    top_reasons = [{'reason': k, 'count': v} for k, v in
                   sorted(reasons.items(), key=lambda kv: -kv[1])[:10]]
    return {
        'period': {'from': frm, 'to': to, 'tz_offset': off,
                   'label': ctx.q('period') or 'week'},
        'orders': {
            'total': orders_total,
            'done': done_n,
            'cancelled': by_status.get('cancelled', {}).get('n', 0),
            'expired': by_status.get('expired', {}).get('n', 0),
            'live': sum(by_status.get(s, {}).get('n', 0) for s in LIVE_STATUSES),
            'by_status': {s: by_status.get(s, {}).get('n', 0) for s in ORDER_STATUSES},
        },
        'money': {
            'revenue': revenue, 'commission': commission,
            'payout': revenue - commission,
            'avg_check': revenue // done_n if done_n else 0,
        },
        'conversion': {
            'searched': searched, 'assigned': assigned,
            'percent': round(assigned * 100.0 / searched, 1) if searched else 0.0,
            'done_percent': round(done_n * 100.0 / orders_total, 1) if orders_total else 0.0,
        },
        'couriers': {
            'top': top,
            'new': couriers_new,
            'online': db.value('SELECT COUNT(*) FROM couriers WHERE online=1', (), 0),
            'busy': db.value('SELECT COUNT(*) FROM couriers WHERE busy=1', (), 0),
            'active': db.value("SELECT COUNT(*) FROM users WHERE role='courier' "
                               "AND status='active'", (), 0),
            'pending': db.value("SELECT COUNT(*) FROM users WHERE role='courier' "
                                "AND status='pending'", (), 0),
        },
        'clients': {'new': clients_new,
                    'total': db.value('SELECT COUNT(*) FROM clients', (), 0),
                    'active': clients_active,          # заказывали в этом периоде
                    'returning': clients_back,         # из них завелись раньше
                    'repeat': clients_repeat,          # сделали больше одного заказа
                    'orders_per_client': orders_per_client},   # в сотых долях
        'cancels': {'total': len(cancelled_rows), 'by_step': steps,
                    'by_whom': by_whom, 'reasons': top_reasons},
        'by_tariff': by_tariff,
        'by_hour': by_hour,
        'by_day': by_day,
    }


# ─────────────────────────────────────────────────────────────── живая карта

def _live_snapshot():
    """Что показать на карте сразу после подключения, не дожидаясь первого события."""
    couriers = [_courier_row(r) for r in db.rows(
        COURIER_SQL + " AND c.online = 1 AND u.status='active' ORDER BY u.id")]
    orders = [_order_row(r) for r in db.rows(
        ORDER_LIST_SQL + ' WHERE o.status IN (%s) ORDER BY o.created_at DESC LIMIT 100'
        % ','.join('?' * len(LIVE_STATUSES)), list(LIVE_STATUSES))]
    return {'couriers': couriers, 'orders': orders, 'at': db.now()}


@router.get(API + '/admin/stream')
def admin_stream(ctx):
    """Живая карта: позиции курьеров, заказы, предложения — всё, что кладут в тему admin."""
    _admin(ctx)
    ctx.h.sse_loop(['admin', 'couriers'],
                   on_open=lambda: [('snapshot', _live_snapshot())])


# ─────────────────────────────────────────────────────────────── почта

@router.post(API + '/admin/mail/test')
def mail_test(ctx):
    user = _admin(ctx)
    to = ctx.need('to', str, 200)
    res = mailer.test(to)
    log('админ', user.get('email'), 'проверил почту на', to)
    return res


@router.get(API + '/admin/mail/log')
def mail_log(ctx):
    _admin(ctx)
    limit = max(1, min(ctx.qi('limit', 100), 500))
    status = (ctx.q('status') or '').strip() or None
    items = mailer.recent(limit, status)
    counts = {r['status']: r['n'] for r in db.rows(
        'SELECT status, COUNT(*) n FROM mail_log GROUP BY status')}
    return {'items': items, 'counts': counts, 'queue': mailer.queue_size(),
            'enabled': mailer.enabled(), 'templates': mailer.templates()}


def register(app):
    """Подключение админских маршрутов к приложению."""
    app.router.include(router)
    return router
