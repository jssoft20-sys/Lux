# -*- coding: utf-8 -*-
"""Стоимость заказа. Единственное место в сервисе, где считаются деньги.

Всё в тыйынах целыми числами: 1 сом = 100 тыйынов. Дробными бывают только
количества — километры, часы, этажи, — и они переводятся в целые сотые через
Decimal. Считать деньги во float нельзя: на сотне заказов набежит расхождение
в копейках, и объяснить его ни курьеру, ни бухгалтеру будет нечем.

Функция quote() одна на все случаи: и предварительный расчёт в приложении,
и закрытие заказа. Разница только в том, что при закрытии приходит фактическое
время ожидания, а иногда и уточнённое расстояние.

Три вещи, которые считаются здесь же, потому что они часть цены:

* «от двери до двери» — надбавка за каждую точку, где курьер поднимается к двери,
  а не ждёт у машины;
* списание бонусов — отдельной строкой со знаком минус, не больше доли заказа,
  разрешённой в настройках (сам счёт и журнал живут в bonus.py);
* бронь (предоплата) — сколько клиент платит вперёд картой или по QR, остальное
  отдаёт курьеру наличными.

Старые вызовы quote() работают как раньше: все новые аргументы необязательные,
а без них новые строки в расчёте просто нулевые.
"""
from decimal import Decimal, ROUND_HALF_UP

from . import bonus, db, geo, settings
from .core import ApiError

# Виды допуслуг из таблицы extras.
KIND_FIXED = 'fixed'        # цена как есть
KIND_HOURLY = 'hourly'      # цена за час
KIND_PER_UNIT = 'per_unit'  # цена за предмет
KIND_PER_FLOOR = 'per_floor'  # цена за этаж

# Код позиции «от двери до двери». В справочнике extras её нет: она считается
# не за единицу услуги, а за каждую точку маршрута, где человек её включил.
DOOR_CODE = 'door_to_door'

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


def prepay_amount(total, commission=None):
    """Бронь: сколько клиент платит вперёд.

    Смысл брони — не собрать деньги, а убедиться, что человек настоящий: он платит
    комиссию сервиса, а остальное отдаёт курьеру на месте. Поэтому размер брони
    привязан к комиссии и зажат границами: на дешёвом заказе бронь не должна
    выглядеть смешной, на дорогом — грабительской.
    """
    total = max(0, _int(total))
    if total <= 0:
        return 0
    share = _dec(settings.get('payment.prepay_percent', 0))
    if share > 0:
        # процент задан явно — считаем от заказа, проценты в сотых долях
        base = (total * _hundredths(share) + 5000) // 10000
    else:
        base = commission_for(total) if commission is None else max(0, _int(commission))

    # Комиссия сервиса может быть и пятнадцать процентов, и двадцать — но вперёд,
    # до подачи машины, столько никто платить не станет. Поэтому бронь дополнительно
    # зажимается долей самого заказа: обычно это пять-десять процентов. Внутри вилки
    # размер идёт от комиссии — выше комиссия, больше бронь.
    pct_low = max(0, settings.get_int('payment.prepay_pct_min', 5))
    pct_high = max(pct_low, settings.get_int('payment.prepay_pct_max', 10))
    if pct_high > 0:
        base = min(base, (total * pct_high + 50) // 100)
    if pct_low > 0:
        base = max(base, (total * pct_low + 50) // 100)

    low = settings.get_int('payment.prepay_min', 5000)
    high = settings.get_int('payment.prepay_max', 50000)
    if low > 0:
        base = max(base, low)
    if high > 0:
        base = min(base, high)
    return max(0, min(base, total))


def prepay_for_order(order):
    """Бронь по сохранённому заказу: считаем от его цены и вычитаем то, что уже
    закрыто бонусами, — просить вперёд больше, чем человек вообще должен, нельзя."""
    total = max(0, _int(order.get('price_total')))
    left = max(0, total - bonus.applied_to_order(order.get('id')))
    return min(prepay_amount(total, order.get('commission')), left)


def door_price():
    """Надбавка «от двери до двери» за одну точку. Это отдельная работа: курьер
    поднимается к квартире и спускается обратно, а не ждёт у машины."""
    return max(0, settings.get_int('price.door_to_door', 15000))


def bonus_cap(total, client_id=None):
    """Сколько бонусов разрешено списать в заказ этой суммы.

    Клиент известен — учитываем и его остаток. Неизвестен (предварительный расчёт
    на экране) — только долю заказа: больше неё сервис работал бы в минус.
    """
    total = max(0, _int(total))
    if total <= 0:
        return 0
    if client_id:
        return max(0, _int(bonus.max_spendable(client_id, total)))
    return max(0, _int(bonus.cap_for_total(total)))


def _flag(v):
    """Флажок из JSON: true, 1, «on», «да» — всё это «включено»."""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v > 0
    return str(v or '').strip().lower() in ('1', 'true', 'yes', 'on', 'да')


def _door_from_points(points):
    """Точки, где человек попросил поднять груз к двери."""
    n = 0
    for p in (points or []):
        if isinstance(p, dict) and _flag(p.get('door_to_door', p.get('d2d'))):
            n += 1
    return n


def _door_from_extras(extras):
    """То же самое, но пришедшее строкой допуслуги.

    Экран заказа шлёт выбор именно так, и по дороге через orders.extras он не
    теряется: при закрытии заказа надбавка пересчитается из той же записи.
    """
    n = 0
    for raw in (extras or []):
        if isinstance(raw, dict) and str(raw.get('code') or '').strip() == DOOR_CODE:
            qty = _int(raw.get('qty'), 1)
            n = max(n, 1 if qty <= 0 else qty)
        elif isinstance(raw, str) and raw.strip() == DOOR_CODE:
            n = max(n, 1)
    return n


def _door_count(door_to_door, points, extras, limit):
    """Сколько точек оплачивается по «от двери до двери».

    Источников три — явный аргумент, флажок у точки и строка допуслуги, — потому
    что разные экраны шлют выбор по-разному. Явный аргумент главнее, иначе берём
    наибольшее: расходиться источники не должны, а молча потерять включённый
    человеком подъём хуже, чем посчитать его.
    """
    if door_to_door is None:
        count = max(_door_from_points(points), _door_from_extras(extras))
    elif door_to_door is True:
        count = limit
    elif door_to_door is False:
        count = 0
    elif isinstance(door_to_door, (list, tuple)):
        count = sum(1 for f in door_to_door if _flag(f))
    else:
        count = _int(door_to_door)
    return max(0, min(count, limit))


# ─────────────────────────────────────────────────────────── расчёт

def quote(tariff, points=None, distance_m=0, duration_s=0, loaders=0, extras=None,
          waiting_s=0, hours=None, catalog=None,
          door_to_door=None, bonus_spend=None, bonus_fixed=False, client_id=None):
    """Полный расчёт заказа.

    tariff       — словарь тарифа, id или код
    points       — точки маршрута, нужны только если расстояние ещё не посчитано
    distance_m   — метры, duration_s — секунды в пути
    loaders      — сколько грузчиков просит клиент (включая бесплатных по тарифу)
    extras       — [{code, qty}] или готовые позиции с ценой
    waiting_s    — фактическое ожидание, при предварительном расчёте ноль
    hours        — часы работы бригады, если клиент выбрал их руками
    door_to_door — сколько точек с подъёмом к двери: число, True (все точки),
                   список флажков. Не задано — смотрим флажки в точках и строку
                   допуслуги door_to_door
    bonus_spend  — сколько бонусов списать: число или True («сколько можно»).
                   Сумма зажимается долей из настроек, а с client_id — ещё и остатком
    bonus_fixed  — бонусы уже списаны и пересчёту не подлежат: так чек по закрытому
                   заказу показывает то, что было на самом деле
    client_id    — клиент, если он известен: нужен только для проверки остатка бонусов
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
        code = raw.get('code') if isinstance(raw, dict) else raw
        if str(code or '').strip() == DOOR_CODE:
            continue          # это своя позиция ниже, за точки, а не за единицу услуги
        item = _extra_item(raw, book, work_hours)
        if item:
            items.append(item)
    extras_total = sum(i['sum'] for i in items)

    # ── от двери до двери ────────────────────────────────────────────────────
    # Платится за каждую точку, где курьер поднимается к двери. Больше, чем точек
    # в заказе, посчитать нельзя — даже если в запросе прислали число побольше.
    door_limit = len(pts) if pts else max(2, settings.get_int('order.max_points', 5))
    door_points = _door_count(door_to_door, points, extras, door_limit)
    door_unit = door_price()
    price_door = door_unit * door_points

    # ── ожидание ─────────────────────────────────────────────────────────────
    waiting_min = -(-waiting_s // 60)
    free_wait = _int(_field(t, 'waiting_free_min', None),
                     settings.get_int('order.waiting_free_min', 10))
    paid_wait = max(0, waiting_min - max(0, free_wait))
    price_waiting = max(0, _int(_field(t, 'waiting_per_min'))) * paid_wait

    # ── итог ─────────────────────────────────────────────────────────────────
    subtotal = (base + price_distance + price_time + price_loaders
                + extras_total + price_door + price_waiting)
    floor = max(max(0, _int(_field(t, 'min_price'))), settings.get_int('order.min_price', 0))
    total = max(subtotal, floor)
    surcharge = total - subtotal
    commission = commission_for(total)

    # ── бонусы ───────────────────────────────────────────────────────────────
    # Потолок считаем всегда: экран показывает его человеку, даже когда списывать
    # он пока не собрался.
    bonus_max = bonus_cap(total, client_id)
    if bonus_fixed:
        # заказ уже закрыт этими бонусами — пересчитывать нечего, показываем факт
        used = max(0, _int(bonus_spend))
    elif bonus_spend is True:
        used = bonus_max
    elif bonus_spend:
        used = min(max(0, _int(bonus_spend)), bonus_max)
    else:
        used = 0
    used = max(0, min(used, total))
    to_pay = total - used

    # Бронь считаем от полной цены, но просить вперёд больше, чем человек должен
    # деньгами, нельзя: бонусы уже закрыли свою часть.
    prepay = min(prepay_amount(total, commission), to_pay)

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
        'door_points': door_points,
        'door_price': door_unit,
        'door_to_door': price_door,
        'waiting': price_waiting,
        'min_price_extra': surcharge,
        'subtotal': subtotal,
        'total': total,
        'bonus_max': bonus_max,
        'bonus_spent': used,
        'to_pay': to_pay,
        'prepay': prepay,
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
    if res.get('door_to_door', 0) > 0:
        lines.append(_line(DOOR_CODE, 'От двери до двери', 'Эшиктен эшикке',
                           res['door_points'], res['door_price'], res['door_to_door'],
                           'точка', 'чекит'))
    if res['waiting'] > 0:
        lines.append(_line('waiting', 'Платное ожидание', 'Күтүү убактысы',
                           res['waiting_min'], _field(t, 'waiting_per_min'), res['waiting'],
                           'мин', 'мүн'))
    if res['min_price_extra'] > 0:
        lines.append(_line('min_price', 'Доплата до минимальной стоимости',
                           'Минималдуу баага чейин кошумча',
                           1, res['min_price_extra'], res['min_price_extra']))
    if res.get('bonus_spent', 0) > 0:
        # Последней строкой и со знаком минус: человек сначала видит, за что платит,
        # и только потом — сколько из этого закрыли бонусы.
        lines.append(_line('bonus', 'Списание бонусов', 'Бонус менен төлөндү',
                           1, -res['bonus_spent'], -res['bonus_spent']))
    return lines


# ─────────────────────────────────────────────────────────── связь с заказом

def to_order_fields(q):
    """Расчёт → колонки таблицы orders. Чтобы роутеры не раскладывали руками.

    «От двери до двери» кладём в price_extras: своей колонки под неё нет, а сумма
    частей обязана сходиться с price_total, иначе отчёты перестанут биться.
    Отдельной строкой она всё равно видна — в разбивке чека.

    Бонусы в колонки не попадают: заказ стоит столько, сколько стоит, а списание
    живёт своей строкой в журнале bonus.py. Курьер получает свою выплату целиком.
    """
    return {
        'price_base': _int(q.get('base')),
        'price_distance': _int(q.get('distance')),
        'price_time': _int(q.get('time')),
        'price_loaders': _int(q.get('loaders_price')),
        'price_extras': _int(q.get('extras_total')) + _int(q.get('door_to_door')),
        'price_waiting': _int(q.get('waiting')),
        'price_total': _int(q.get('total')),
        'commission': _int(q.get('commission')),
        'courier_payout': _int(q.get('courier_payout')),
    }


def quote_order(order, waiting_s=None, distance_m=None, duration_s=None, hours=None):
    """Пересчёт по сохранённому заказу: закрытие смены, ожидание по факту,
    уточнённый пробег. Цену всегда считаем заново, а не правим сохранённую.

    Списанные бонусы подставляем фактом из журнала: это уже случившееся движение,
    и пересчитывать его по сегодняшним настройкам нельзя — чек должен сходиться
    с тем, что человек отдал.
    """
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
        bonus_spend=bonus.applied_to_order(order.get('id')),
        bonus_fixed=True,
        client_id=order.get('client_id'),
    )
