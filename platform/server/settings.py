# -*- coding: utf-8 -*-
"""Настройки сервиса: значения по умолчанию, кэш и первичное наполнение базы.

Всё, что админ может поменять без программиста, живёт здесь и в таблице settings.
Кэш держим в памяти и сбрасываем на запись — настройки читаются на каждый расчёт цены.
"""
import threading
from . import db

_cache = None
_lock = threading.RLock()

# Деньги — в тыйынах: 150000 = 1 500 сом.
DEFAULTS = {
    'service.name': 'Sprinter Go',
    'service.phone': '+996755555357',
    'service.city': 'Бишкек',
    'service.currency': 'KGS',
    'service.tz': 'Asia/Bishkek',
    'service.support_wa': '996755555357',

    'commission.kind': 'percent',       # percent | fixed
    'commission.value': 15,             # проценты либо тыйыны
    'commission.min': 5000,             # не меньше 50 сом с заказа
    'commission.max': 100000,           # не больше 1 000 сом

    'payment.enabled': False,
    'payment.provider': 'none',         # none | freedompay | manual
    'payment.prepay_commission': False, # клиент платит комиссию вперёд как бронь
    'payment.merchant_id': '',
    'payment.secret': '',
    'payment.test_mode': True,

    'dispatch.mode': 'score',           # nearest | score | broadcast
    'dispatch.radius_m': 12000,
    'dispatch.offer_ttl_s': 20,
    'dispatch.batch': 2,                # скольким курьерам предлагаем одновременно
    'dispatch.max_rounds': 6,
    'dispatch.w_distance': 50,
    'dispatch.w_rating': 25,
    'dispatch.w_priority': 15,
    'dispatch.w_acceptance': 10,
    'dispatch.new_courier_boost': 10,   # фора новичкам, пока нет статистики
    'dispatch.min_rating': 0,

    'map.provider': 'osm',
    'map.tiles_light': 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'map.tiles_dark': 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    'map.attribution': '© OpenStreetMap, © CARTO',
    'map.key': '',
    'map.center_lat': 42.8746,
    'map.center_lng': 74.5698,
    'map.zoom': 13,
    'map.max_zoom': 19,

    'geo.provider': 'nominatim',        # nominatim | yandex | 2gis
    'geo.key': '',
    'geo.bbox': '74.40,42.75,74.78,42.98',   # Бишкек и окрестности
    'geo.country': 'kg',

    'route.provider': 'osrm',           # straight | osrm
    'route.url': 'https://router.project-osrm.org',
    'route.road_factor': 1.32,          # во сколько раз дорога длиннее прямой
    'route.avg_speed_kmh': 28,      # средняя по городу, для запасного расчёта
    'route.free_speed_kmh': 42,     # свободная дорога, для сравнения с пробками
    'route.key': '',                # ключ маршрутизатора; пусто — берём geo.key

    'smtp.host': '', 'smtp.port': 587, 'smtp.secure': 'tls',
    'smtp.user': '', 'smtp.pass': '',
    'smtp.from': '', 'smtp.from_name': 'Sprinter Go',
    'mail.enabled': False,

    'order.search_timeout_s': 300,
    'order.cancel_free_s': 180,
    'order.min_price': 30000,
    'order.max_points': 5,
    'order.allow_scheduled': True,

    'security.allow_registration': True,
    'security.require_moderation': True,
    'security.session_days': 30,
}


def load():
    global _cache
    with _lock:
        if _cache is None:
            _cache = dict(DEFAULTS)
            for r in db.rows('SELECT key, value FROM settings'):
                _cache[r['key']] = db.jload(r['value'], DEFAULTS.get(r['key']))
        return _cache


def get(key, default=None):
    return load().get(key, DEFAULTS.get(key, default))


def get_int(key, default=0):
    try:
        return int(get(key, default))
    except (TypeError, ValueError):
        return default


def get_float(key, default=0.0):
    try:
        return float(get(key, default))
    except (TypeError, ValueError):
        return default


def get_bool(key, default=False):
    v = get(key, default)
    return v if isinstance(v, bool) else str(v).lower() in ('1', 'true', 'yes', 'on')


def put(key, value):
    with _lock:
        db.execute('INSERT INTO settings(key,value) VALUES(?,?) '
                   'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                   (key, db.jdump(value)))
        if _cache is not None:
            _cache[key] = value


def put_many(items):
    with _lock:
        with db.tx():
            for k, v in items.items():
                db.execute('INSERT INTO settings(key,value) VALUES(?,?) '
                           'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                           (k, db.jdump(v)))
        invalidate()


def invalidate():
    global _cache
    with _lock:
        _cache = None


def public():
    """Подмножество, которое безопасно отдать в браузер. Секреты сюда не попадают."""
    s = load()
    return {
        'service': {k.split('.', 1)[1]: s[k] for k in s if k.startswith('service.')},
        'map': {
            'tiles_light': s['map.tiles_light'], 'tiles_dark': s['map.tiles_dark'],
            'attribution': s['map.attribution'], 'center': [s['map.center_lat'], s['map.center_lng']],
            'zoom': s['map.zoom'], 'max_zoom': s['map.max_zoom'], 'provider': s['map.provider'],
        },
        'order': {
            'max_points': s['order.max_points'], 'min_price': s['order.min_price'],
            'cancel_free_s': s['order.cancel_free_s'], 'search_timeout_s': s['order.search_timeout_s'],
        },
        'payment': {
            'enabled': bool(s['payment.enabled']),
            'prepay_commission': bool(s['payment.prepay_commission']),
        },
        'commission': {'kind': s['commission.kind'], 'value': s['commission.value']},
    }


# ─────────────────────────────────────────────────────────────── первичное наполнение

SEED_TARIFFS = [
    dict(code='express', name_ru='Экспресс', name_ky='Экспресс',
         desc_ru='Легковая или пикап, небольшой груз до 300 кг',
         desc_ky='Жеңил унаа же пикап, 300 килограммга чейин',
         vehicle_class='express', icon='car',
         base_price=18300, included_km=3, included_min=15, per_km=3500, per_min=400,
         min_price=18300, waiting_free_min=10, waiting_per_min=500,
         loaders_included=0, loader_hour_price=50000, loader_min_hours=1,
         body_w=120, body_d=150, body_h=90, capacity_kg=300, sort=1),
    dict(code='sprinter', name_ru='Спринтер', name_ky='Спринтер',
         desc_ru='Спринтер или газель до 1,5 т, кузов 300×180×180',
         desc_ky='Спринтер же газель 1,5 тоннага чейин',
         vehicle_class='van', icon='van',
         base_price=150000, included_km=8, included_min=60, per_km=4500, per_min=700,
         min_price=150000, waiting_free_min=15, waiting_per_min=700,
         loaders_included=2, loader_hour_price=50000, loader_min_hours=1,
         body_w=180, body_d=300, body_h=180, capacity_kg=1500, sort=2),
    dict(code='truck3', name_ru='Грузовик 3 т', name_ky='Жүк унаасы 3 т',
         desc_ru='Кузов 380×180×180, до 3 тонн, для квартирного переезда',
         desc_ky='Кузов 380×180×180, 3 тоннага чейин, батир көчүрүү үчүн',
         vehicle_class='truck', icon='truck',
         base_price=350000, included_km=12, included_min=120, per_km=5500, per_min=800,
         min_price=350000, waiting_free_min=20, waiting_per_min=800,
         loaders_included=3, loader_hour_price=50000, loader_min_hours=1,
         body_w=180, body_d=380, body_h=180, capacity_kg=3000, sort=3),
    dict(code='truck5', name_ru='Грузовик 5 т', name_ky='Жүк унаасы 5 т',
         desc_ru='Кузов 450×200×200, до 5 тонн, для офиса и большой квартиры',
         desc_ky='Кузов 450×200×200, 5 тоннага чейин, офис үчүн',
         vehicle_class='truck_big', icon='truck-big',
         base_price=650000, included_km=15, included_min=240, per_km=6500, per_min=900,
         min_price=650000, waiting_free_min=20, waiting_per_min=900,
         loaders_included=4, loader_hour_price=50000, loader_min_hours=1,
         body_w=200, body_d=450, body_h=200, capacity_kg=5000, sort=4),
]

SEED_EXTRAS = [
    dict(code='loader', name_ru='Дополнительный грузчик', name_ky='Кошумча жүкчү',
         kind='hourly', price=50000, unit_ru='час', unit_ky='саат',
         min_qty=1, max_qty=8, step=1, sort=1),
    dict(code='floor', name_ru='Подъём без лифта', name_ky='Лифтсиз көтөрүү',
         kind='per_floor', price=10000, unit_ru='этаж', unit_ky='кабат',
         min_qty=1, max_qty=20, step=1, sort=2),
    dict(code='hour', name_ru='Дополнительный час работы', name_ky='Кошумча иш сааты',
         kind='hourly', price=70000, unit_ru='час', unit_ky='саат',
         min_qty=1, max_qty=8, step=1, sort=3),
    dict(code='assembly', name_ru='Сборка мебели', name_ky='Мебель чогултуу',
         kind='per_unit', price=50000, unit_ru='предмет', unit_ky='нерсе',
         min_qty=1, max_qty=20, step=1, sort=4),
    dict(code='disassembly', name_ru='Разборка мебели', name_ky='Мебель чечүү',
         kind='per_unit', price=30000, unit_ru='предмет', unit_ky='нерсе',
         min_qty=1, max_qty=20, step=1, sort=5),
    dict(code='packing', name_ru='Упаковка коробки', name_ky='Кутуну таңгактоо',
         kind='per_unit', price=5000, unit_ru='коробка', unit_ky='куту',
         min_qty=1, max_qty=50, step=1, sort=6),
    dict(code='fragile', name_ru='Хрупкий груз', name_ky='Сынгыч жүк',
         kind='fixed', price=30000, unit_ru='', unit_ky='', sort=7),
]


def seed_catalog():
    """Тарифы и допуслуги по умолчанию. Повторный запуск ничего не ломает."""
    for t in SEED_TARIFFS:
        if not db.row('SELECT 1 FROM tariffs WHERE code=?', (t['code'],)):
            db.insert('tariffs', t)
    for e in SEED_EXTRAS:
        if not db.row('SELECT 1 FROM extras WHERE code=?', (e['code'],)):
            db.insert('extras', e)
