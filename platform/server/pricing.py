# -*- coding: utf-8 -*-
"""Стоимость заказа. Единственное место в сервисе, где считаются деньги.

Всё в тыйынах целыми числами: 1 сом = 100 тыйынов. Дробными бывают только
количества — километры, часы, этажи, — и они переводятся в целые сотые через
Decimal. Считать деньги во float нельзя: на сотне заказов набежит расхождение
в копейках, и объяснить его ни курьеру, ни бухгалтеру будет нечем.

Функция quote() одна на все случаи: и предварительный расчёт в приложении,
и закрытие заказа. Разница только в том, что при закрытии приходит фактическое
время ожидания, а иногда и уточнённое расстояние.
"""
from decimal import Decimal, ROUND_HALF_UP

from . import db, geo, settings
from .core import ApiError

# Виды допуслуг из таблицы extras.
KIND_FIXED = 'fixed'        # цена как есть
KIND_HOURLY = 'hourly'      # цена за час
KIND_PER_UNIT = 'per_unit'  # цена за предмет
KIND_PER_FLOOR = 'per_floor'  # цена за этаж

ONE = Decimal(1)


# ─────────────────────────────────────────────────────────── мелкая арифметика

def _dec(v, default='0'):
    """Число в Decimal без сюрпризов двоичной дроби: идём через строку."""
    if isinstance(v, Decimal):
        return v
    try:
        return Decimal(str(v if v is not None else default))
    except Exception:
        return Decimal(default)


def _int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _hundredths(qty):
    """Количество в целых сотых: 1.5 часа → 150. Дальше умножаем только целыми."""
    return int((_dec(qty) * 100).quantize(ONE, rounding=ROUND_HALF_UP))


def _tenths(qty):
    """Количество в целых десятых: 8 км → 80. Километры считаем с шагом 0,1."""
    return int((_dec(qty) * 10).quantize(ONE, rounding=ROUND_HALF_UP))


def _mul(price, qty):
    """Цена за единицу × количество. Половина тыйына округляется вверх."""
    p, q = _int(price), _hundredths(qty)
    if p <= 0 or q <= 0:
        return 0
    return (p * q + 50) // 100


def _num(v):
    """Число для подписи: 3.0 → «3», 1.5 → «1,5». Запятая, как принято в сомах."""
    s = format(_dec(v), 'f')
    if '.' in s:
        s = s.rstrip('0').rstrip('.')
    return (s or '0').replace('.', ',')


def _qty_out(v):
    """Количество наружу: целое остаётся целым, дробное — числом с плавающей точкой.
    В JSON это читается привычно, а на деньги количество уже не влияет."""
    d = _dec(v)
    return int(d) if d == d.to_integral_value() else float(d)


def _field(src, name, default=0):
    """Поле тарифа или услуги: в базе колонка может прийти пустой."""
    v = src.get(name)
    return default if v is None else v


# ─────────────────────────────────────────────────────────── справочники

def load_tariff(ref):
    """Тариф по готовому словарю, по id или по коду вроде «sprinter»."""
    if isinstance(ref, dict):
        return ref
    if ref is None or ref == '':
        raise ApiError('tariff_required', 'Не выбран тариф', 400)
    key = str(ref)
    if key.isdigit():
        t = db.row('SELECT * FROM tariffs WHERE id=?', (int(key),))
    else:
        t = db.row('SELECT * FROM tariffs WHERE code=?', (key,))
    if not t:
        raise ApiError('tariff_not_found', 'Такого тарифа нет', 404)
    return t


def load_extras():
    """Справочник допуслуг по коду. Читаем на каждый расчёт: их полтора десятка,
    зато цена, поменянная в админке, действует сразу же."""
    return {r['code']: r for r in db.rows('SELECT * FROM extras WHERE active=1')}


def commission_for(total):
    """Комиссия сервиса с заказа: процент или фиксированная сумма, с зажимом
    между commission.min и commission.max. Ноль в max означает «без потолка»."""
    total = max(0, _int(total))
    kind = str(settings.get('commission.kind', 'percent')).lower()
    value = settings.get('commission.value', 0)
    if kind == 'fixed':
        c = int(_dec(value).quantize(ONE, rounding=ROUND_HALF_UP))
    else:
        # проценты держим в сотых долях: 12,5 % → 1250
        c = (total * _hundredths(value) + 5000) // 10000
    low = settings.get_int('commission.min', 0)
    high = settings.get_int('commission.max', 0)
    if low > 0:
        c = max(c, low)
    if high > 0:
        c = min(c, high)
    # с заказа нельзя взять больше, чем он стоит: курьер не должен остаться должен
    return max(0, min(c, total))


# ─────────────────────────────────────────────────────────── расчёт

def quote(tariff, points=None, distance_m=0, duration_s=0, loaders=0, extras=None,
          waiting_s=0, hours=None, catalog=None):
    """Полный расчёт заказа.

    tariff      — словарь тарифа, id или код
    points      — точки маршрута, нужны только если расстояние ещё не посчитано
    distance_m  — метры, duration_s — секунды в пути
    loaders     — сколько грузчиков просит клиент (включая бесплатных по тарифу)
    extras      — [{code, qty}] или готовые позиции с ценой
    waiting_s   — фактическое ожидание, при предварительном расчёте ноль
    hours       — часы работы бригады, если клиент выбрал их руками
    """
    t = load_tariff(tariff)
    pts = geo.clean_points(points)

    distance_m = max(0, _int(distance_m))
    duration_s = max(0, _int(duration_s))
    waiting_s = max(0, _int(waiting_s))
    # расстояние могли не передать (быстрый расчёт по двум точкам) — прикинем сами
    if not distance_m and len(pts) >= 2:
        distance_m = geo.road_distance(pts)
    if not duration_s and distance_m:
        duration_s = geo.estimate_duration(distance_m)

    # ── подача ───────────────────────────────────────────────────────────────
    base = max(0, _int(_field(t, 'base_price')))
    inc_tenths = max(0, _tenths(_field(t, 'included_km')))
    inc_min = max(0, _int(_field(t, 'included_min')))

    # ── километры сверх включённых ───────────────────────────────────────────
    tenths = (distance_m + 50) // 100                 # метры → десятые километра
    paid_tenths = max(0, tenths - inc_tenths)
    per_km = max(0, _int(_field(t, 'per_km')))
    price_distance = (per_km * paid_tenths + 5) // 10

    # ── минуты сверх включённых ──────────────────────────────────────────────
    minutes = -(-duration_s // 60)                    # неполная минута считается целой
    paid_min = max(0, minutes - inc_min)
    per_min = max(0, _int(_field(t, 'per_min')))
    price_time = per_min * paid_min

    # ── часы работы бригады ──────────────────────────────────────────────────
    min_hours = _dec(_field(t, 'loader_min_hours', 1), '1')
    if min_hours <= 0:
        min_hours = ONE
    if hours is not None and _dec(hours) > 0:
        work_hours = _dec(hours)
    else:
        # грузчики заняты всю дорогу и всё ожидание, неполный час округляем вверх
        busy_s = duration_s + waiting_s
        work_hours = Decimal(max(1, -(-busy_s // 3600)))
    loader_hours = max(work_hours, min_hours)

    # ── грузчики ─────────────────────────────────────────────────────────────
    want_loaders = max(0, _int(loaders))
    free_loaders = max(0, _int(_field(t, 'loaders_included')))
    paid_loaders = max(0, want_loaders - free_loaders)
    per_loader = _mul(_field(t, 'loader_hour_price'), loader_hours)
    price_loaders = per_loader * paid_loaders

    # ── допуслуги ────────────────────────────────────────────────────────────
    book = catalog if catalog is not None else load_extras()
    items = []
    for raw in (extras or []):
        item = _extra_item(raw, book, work_hours)
        if item:
            items.append(item)
    extras_total = sum(i['sum'] for i in items)

    # ── ожидание ─────────────────────────────────────────────────────────────
    waiting_min = -(-waiting_s // 60)
    free_wait = _int(_field(t, 'waiting_free_min', None),
                     settings.get_int('order.waiting_free_min', 10))
    paid_wait = max(0, waiting_min - max(0, free_wait))
    price_waiting = max(0, _int(_field(t, 'waiting_per_min'))) * paid_wait

    # ── итог ─────────────────────────────────────────────────────────────────
    subtotal = base + price_distance + price_time + price_loaders + extras_total + price_waiting
    floor = max(max(0, _int(_field(t, 'min_price'))), settings.get_int('order.min_price', 0))
    total = max(subtotal, floor)
    surcharge = total - subtotal
    commission = commission_for(total)

    res = {
        'tariff_id': _int(t.get('id')) or None,
        'tariff_code': t.get('code'),
        'currency': settings.get('service.currency', 'KGS'),
        'distance_m': distance_m,
        'duration_s': duration_s,
        'billable_km': _qty_out(_dec(paid_tenths) / 10),
        'billable_min': paid_min,
        'hours': _qty_out(loader_hours),
        'loaders_count': want_loaders,
        'loaders_free': min(want_loaders, free_loaders),
        'loaders_paid': paid_loaders,
        'waiting_s': waiting_s,
        'waiting_min': paid_wait,
        'base': base,
        'distance': price_distance,
        'time': price_time,
        'loaders': price_loaders,
        'loaders_price': price_loaders,   # то же число под привычным именем
        'extras': items,
        'extras_total': extras_total,
        'waiting': price_waiting,
        'min_price_extra': surcharge,
        'subtotal': subtotal,
        'total': total,
        'commission': commission,
        'courier_payout': total - commission,
    }
    res['breakdown'] = _breakdown(t, res, paid_tenths, paid_min, loader_hours, per_loader)
    return res


def _extra_item(raw, book, work_hours):
    """Одна строка допуслуги. Количество зажимаем рамками из справочника —
    цену считает сервер, и присланное клиентом «100 этажей» здесь и останавливается."""
    if not isinstance(raw, dict):
        return None
    code = str(raw.get('code') or '').strip()
    d = book.get(code)
    if not d:
        # услугу могли выключить в админке уже после того, как клиент открыл экран.
        # Роняем не заказ, а только эту строку — пересчитанная цена придёт клиенту в ответе.
        return None
    kind = str(_field(d, 'kind', KIND_FIXED) or KIND_FIXED)
    price = max(0, _int(_field(d, 'price')))

    if kind == KIND_FIXED:
        qty = ONE
    else:
        given = raw.get('qty')
        if given is None:
            qty = work_hours if kind == KIND_HOURLY else ONE
        else:
            qty = _dec(given)
        low = _dec(_field(d, 'min_qty', 1), '1')
        high = _dec(_field(d, 'max_qty', 99), '99')
        if high < low:
            high = low
        qty = min(max(qty, low), high)

    return {
        'code': code,
        'name_ru': d.get('name_ru') or code,
        'name_ky': d.get('name_ky') or d.get('name_ru') or code,
        'kind': kind,
        'qty': _qty_out(qty),
        'unit_price': price,
        'unit_ru': d.get('unit_ru') or '',
        'unit_ky': d.get('unit_ky') or d.get('unit_ru') or '',
        'sum': _mul(price, qty),
    }


def _line(code, title_ru, title_ky, qty, unit_price, total, unit_ru='', unit_ky=''):
    return {'code': code, 'title_ru': title_ru, 'title_ky': title_ky,
            'qty': _qty_out(qty), 'unit_price': _int(unit_price), 'sum': _int(total),
            'unit_ru': unit_ru, 'unit_ky': unit_ky}


def _breakdown(t, res, paid_tenths, paid_min, loader_hours, per_loader):
    """Разбивка для чека: то, что клиент видит на экране и в письме.
    Строки с нулём не показываем — пустые копейки только путают."""
    name_ru = t.get('name_ru') or 'Тариф'
    name_ky = t.get('name_ky') or name_ru
    inc_km = _dec(_field(t, 'included_km'))
    inc_min = _int(_field(t, 'included_min'))

    bits_ru, bits_ky = [], []
    if inc_km > 0:
        bits_ru.append('%s км' % _num(inc_km))
        bits_ky.append('%s км' % _num(inc_km))
    if inc_min > 0:
        bits_ru.append('%d мин' % inc_min)
        bits_ky.append('%d мүнөт' % inc_min)
    if bits_ru:
        base_ru = '%s: включено %s' % (name_ru, ' и '.join(bits_ru))
        base_ky = '%s: %s кирет' % (name_ky, ' жана '.join(bits_ky))
    else:
        base_ru = 'Тариф «%s»' % name_ru
        base_ky = '«%s» тарифи' % name_ky

    lines = [_line('base', base_ru, base_ky, 1, res['base'], res['base'])]

    if res['distance'] > 0:
        lines.append(_line('distance', 'Километры сверх тарифа', 'Тарифтен ашык километр',
                           _dec(paid_tenths) / 10, _field(t, 'per_km'), res['distance'],
                           'км', 'км'))
    if res['time'] > 0:
        lines.append(_line('time', 'Минуты сверх тарифа', 'Тарифтен ашык мүнөт',
                           paid_min, _field(t, 'per_min'), res['time'], 'мин', 'мүн'))
    if res['loaders_price'] > 0:
        hrs = _num(loader_hours)
        lines.append(_line('loaders',
                           'Грузчики, %s ч' % hrs, 'Жүкчүлөр, %s саат' % hrs,
                           res['loaders_paid'], per_loader, res['loaders_price'],
                           'чел.', 'киши'))
    for it in res['extras']:
        if it['sum'] <= 0:
            continue
        lines.append(_line(it['code'], it['name_ru'], it['name_ky'], it['qty'],
                           it['unit_price'], it['sum'], it['unit_ru'], it['unit_ky']))
    if res['waiting'] > 0:
        lines.append(_line('waiting', 'Платное ожидание', 'Күтүү убактысы',
                           res['waiting_min'], _field(t, 'waiting_per_min'), res['waiting'],
                           'мин', 'мүн'))
    if res['min_price_extra'] > 0:
        lines.append(_line('min_price', 'Доплата до минимальной стоимости',
                           'Минималдуу баага чейин кошумча',
                           1, res['min_price_extra'], res['min_price_extra']))
    return lines


# ─────────────────────────────────────────────────────────── связь с заказом

def to_order_fields(q):
    """Расчёт → колонки таблицы orders. Чтобы роутеры не раскладывали руками."""
    return {
        'price_base': _int(q.get('base')),
        'price_distance': _int(q.get('distance')),
        'price_time': _int(q.get('time')),
        'price_loaders': _int(q.get('loaders_price')),
        'price_extras': _int(q.get('extras_total')),
        'price_waiting': _int(q.get('waiting')),
        'price_total': _int(q.get('total')),
        'commission': _int(q.get('commission')),
        'courier_payout': _int(q.get('courier_payout')),
    }


def quote_order(order, waiting_s=None, distance_m=None, duration_s=None, hours=None):
    """Пересчёт по сохранённому заказу: закрытие смены, ожидание по факту,
    уточнённый пробег. Цену всегда считаем заново, а не правим сохранённую."""
    pts = db.jload(order.get('points'), []) or []
    extras = db.jload(order.get('extras'), []) or []
    return quote(
        order.get('tariff_id'),
        points=pts,
        distance_m=order.get('distance_m') if distance_m is None else distance_m,
        duration_s=order.get('duration_s') if duration_s is None else duration_s,
        loaders=order.get('loaders') or 0,
        extras=extras,
        waiting_s=order.get('waiting_s') if waiting_s is None else waiting_s,
        hours=hours,
    )
