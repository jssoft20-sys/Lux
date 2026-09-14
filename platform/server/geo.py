# -*- coding: utf-8 -*-
"""География: расстояния, подсказки адресов, обратный геокодер и маршрут.

Внешние сервисы подключены по принципу «помогают, но не держат». Любая ошибка,
таймаут или выключенный интернет — и мы честно считаем по прямой с поправкой
на дороги. Клиент не должен смотреть на крутилку из-за того, что у кого-то
в Германии лёг OSRM, а Nominatim решил, что мы ходим слишком часто.

Ключевые приёмы: короткий таймаут, кэш в памяти, ограничение частоты запросов
к Nominatim (у них 1 запрос в секунду в правилах) и предохранитель — после сбоя
полминуты даже не стучимся, а сразу отвечаем из своей арифметики.
"""
import json
import math
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from . import settings

TIMEOUT = 3.0                  # секунды на любой внешний вызов
NOMINATIM = 'https://nominatim.openstreetmap.org'
YANDEX = 'https://geocode-maps.yandex.ru/1.x/'
GIS2 = 'https://catalog.api.2gis.com/3.0/items'
EARTH_R = 6371008.8            # средний радиус Земли, метры

SUGGEST_TTL = 600              # подсказки живут 10 минут
REVERSE_TTL = 1800             # адрес по координатам меняется ещё реже
ROUTE_TTL = 600


# ─────────────────────────────────────────────────────────── кэш и предохранитель

class _Cache:
    """Кэш с временем жизни. Памяти на VPS немного, поэтому держим предел записей
    и выкидываем самое старое, когда упираемся."""

    def __init__(self, limit=600):
        self.limit = limit
        self.data = {}
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            hit = self.data.get(key)
            if not hit:
                return None
            until, value = hit
            if until < time.time():
                self.data.pop(key, None)
                return None
            return value

    def put(self, key, value, ttl):
        with self.lock:
            if len(self.data) >= self.limit:
                now = time.time()
                self.data = {k: v for k, v in self.data.items() if v[0] > now}
                if len(self.data) >= self.limit:
                    old = sorted(self.data, key=lambda k: self.data[k][0])[:self.limit // 2]
                    for k in old:
                        self.data.pop(k, None)
            self.data[key] = (time.time() + ttl, value)


class _Breaker:
    """Предохранитель. Сервис только что не ответил — значит, и через секунду
    не ответит: ждать таймаут на каждом запросе ради того же результата хуже всего."""

    def __init__(self, pause=30):
        self.pause = pause
        self.until = 0.0
        self.lock = threading.Lock()

    def ok(self):
        with self.lock:
            return time.monotonic() >= self.until

    def fail(self):
        with self.lock:
            self.until = time.monotonic() + self.pause

    def good(self):
        with self.lock:
            self.until = 0.0


class _Throttle:
    """Не чаще одного запроса в секунду. Если очередь уже выстроилась — честно
    отказываемся: пустая подсказка лучше, чем клиент, который ждёт пять секунд."""

    def __init__(self, gap=1.0):
        self.gap = gap
        self.next_at = 0.0
        self.lock = threading.Lock()

    def acquire(self, max_wait=1.2):
        with self.lock:
            now = time.monotonic()
            start = max(now, self.next_at)
            if start - now > max_wait:
                return False              # очередь длинная, ждать её нет смысла
            self.next_at = start + self.gap
        delay = start - time.monotonic()  # спим уже без замка, иначе очередь встанет
        if delay > 0:
            time.sleep(delay)
        return True


_suggest_cache = _Cache()
_reverse_cache = _Cache()
_route_cache = _Cache(limit=300)
_nominatim_breaker = _Breaker()
_osrm_breaker = _Breaker()
_paid_breaker = _Breaker()
_nominatim_throttle = _Throttle()


# ─────────────────────────────────────────────────────────── сеть

def _ua():
    """Nominatim без внятного User-Agent отвечает 403, поэтому представляемся.
    Заголовки уходят в latin-1, так что кириллицу из названия сервиса убираем."""
    name = ''.join(c for c in str(settings.get('service.name', 'SprinterGo'))
                   if 32 <= ord(c) < 127)
    name = name.replace(' ', '') or 'SprinterGo'
    phone = ''.join(c for c in str(settings.get('service.phone', '')) if c.isdigit())
    contact = '+' + phone if phone else 'sprintergo'
    return '%s/1.0 (%s)' % (name, contact)


def _fetch_json(url, timeout=TIMEOUT, headers=None):
    """Любой внешний вызов заканчивается словарём, списком или None.
    Исключения наружу не выходят — подсказка адреса не стоит упавшего запроса."""
    head = {'User-Agent': _ua(), 'Accept': 'application/json',
            'Accept-Language': 'ru,ky;q=0.8'}
    if headers:
        head.update(headers)
    try:
        with urlopen(Request(url, headers=head), timeout=timeout) as resp:
            raw = resp.read(1 << 20)
        return json.loads(raw.decode('utf-8', 'replace'))
    except (HTTPError, URLError, OSError, ValueError, TypeError):
        return None


# ─────────────────────────────────────────────────────────── координаты

def _ll(p):
    """Точка из чего угодно: [lat, lng], (lat, lng) или словарь с lat/lng."""
    if p is None:
        return None
    if isinstance(p, dict):
        lat = p.get('lat')
        lng = p.get('lng', p.get('lon'))
    elif isinstance(p, (list, tuple)) and len(p) >= 2:
        lat, lng = p[0], p[1]
    else:
        return None
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
        return None
    if lat == 0.0 and lng == 0.0:
        return None                      # нули почти всегда значат «координат нет»
    return (lat, lng)


def clean_points(seq):
    """Список точек, из которого выброшено всё нечитаемое."""
    out = []
    for p in (seq or []):
        ll = _ll(p)
        if ll:
            out.append(ll)
    return out


def haversine(a, b):
    """Расстояние по прямой между двумя точками, метры."""
    pa, pb = _ll(a), _ll(b)
    if not pa or not pb:
        return 0.0
    lat1, lng1 = math.radians(pa[0]), math.radians(pa[1])
    lat2, lng2 = math.radians(pb[0]), math.radians(pb[1])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(h)))


def parse_bbox(raw=None):
    """«мин.долгота,мин.широта,макс.долгота,макс.широта» → кортеж чисел.
    Порядок как у Nominatim, чтобы не переставлять числа в настройках."""
    if raw is None:
        raw = settings.get('geo.bbox', '')
    try:
        if isinstance(raw, (list, tuple)):
            nums = [float(x) for x in raw]
        else:
            nums = [float(x) for x in str(raw).replace(';', ',').split(',') if x.strip()]
    except (TypeError, ValueError):
        return None
    if len(nums) != 4:
        return None
    w, s, e, n = nums
    return (min(w, e), min(s, n), max(w, e), max(s, n))


def bbox_contains(*args, **kw):
    """Точка внутри рабочей зоны? Принимаем и bbox_contains(point),
    и bbox_contains(lat, lng) — так вызывать удобнее из любого места."""
    bbox = kw.get('bbox')
    args = list(args)
    if len(args) >= 2 and isinstance(args[0], (int, float)) and isinstance(args[1], (int, float)):
        point = (args[0], args[1])
        rest = args[2:]
    else:
        point = args[0] if args else None
        rest = args[1:]
    if bbox is None and rest:
        bbox = rest[0]
    box = parse_bbox(bbox)
    ll = _ll(point)
    if not ll:
        return False
    if not box:
        return True                      # зона не задана — работаем везде
    lat, lng = ll
    return box[0] <= lng <= box[2] and box[1] <= lat <= box[3]


def road_distance(points, factor=None):
    """Оценка пробега по дороге: сумма прямых отрезков × route.road_factor.
    Дорога не летает по прямой, а коэффициент подбирается под город в админке."""
    pts = clean_points(points)
    if len(pts) < 2:
        return 0
    straight = sum(haversine(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    k = settings.get_float('route.road_factor', 1.32) if factor is None else float(factor)
    if k <= 0:
        k = 1.0
    return int(round(straight * k))


def estimate_duration(distance_m, speed_kmh=None):
    """Время в пути по средней скорости из настроек. Минута — нижняя граница:
    нулевая длительность ломает и расчёт цены, и полосу прогресса."""
    v = settings.get_float('route.avg_speed_kmh', 28) if speed_kmh is None else float(speed_kmh)
    if v <= 0:
        v = 28.0
    return max(60, int(round(float(distance_m or 0) / (v * 1000.0 / 3600.0))))


# ─────────────────────────────────────────────────────────── polyline

def decode_polyline(s, precision=5):
    """Разбор polyline от OSRM: разница координат сдвинута на 5 знаков и упакована
    по 5 бит на символ. Своя реализация короче любого спора о зависимостях."""
    coords, index, lat, lng = [], 0, 0, 0
    n = len(s or '')
    factor = float(10 ** precision)
    while index < n:
        deltas = []
        for _ in (0, 1):
            result, shift = 0, 0
            while True:
                if index >= n:
                    return coords
                b = ord(s[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else (result >> 1))
        lat += deltas[0]
        lng += deltas[1]
        coords.append([round(lat / factor, 6), round(lng / factor, 6)])
    return coords


# ─────────────────────────────────────────────────────────── маршрут

def route(points):
    """Маршрут по точкам: расстояние, время и линия для карты.
    OSRM не ответил — считаем по прямой, заказ всё равно должен оформиться."""
    pts = clean_points(points)
    if len(pts) < 2:
        line = [[pts[0][0], pts[0][1]]] if pts else []
        return {'distance_m': 0, 'duration_s': 0, 'route': line, 'provider': 'straight'}

    key = ('r',) + tuple((round(a, 5), round(b, 5)) for a, b in pts)
    hit = _route_cache.get(key)
    if hit:
        return {'distance_m': hit['distance_m'], 'duration_s': hit['duration_s'],
                'route': [list(p) for p in hit['route']], 'provider': hit['provider']}

    out = None
    if str(settings.get('route.provider', 'osrm')).lower() == 'osrm' and _osrm_breaker.ok():
        out = _route_osrm(pts)
    if not out:
        out = _route_straight(pts)
    _route_cache.put(key, out, ROUTE_TTL)
    return {'distance_m': out['distance_m'], 'duration_s': out['duration_s'],
            'route': [list(p) for p in out['route']], 'provider': out['provider']}


def _route_osrm(pts):
    base = str(settings.get('route.url', '') or 'https://router.project-osrm.org').rstrip('/')
    path = ';'.join('%.6f,%.6f' % (lng, lat) for lat, lng in pts)   # OSRM ждёт долготу первой
    url = '%s/route/v1/driving/%s?overview=full&geometries=polyline&alternatives=false&steps=false' % (base, path)
    data = _fetch_json(url)
    try:
        if not data or data.get('code') != 'Ok' or not data.get('routes'):
            raise ValueError
        r = data['routes'][0]
        dist = int(round(float(r.get('distance') or 0)))
        dur = int(round(float(r.get('duration') or 0)))
        if dist <= 0:
            raise ValueError
    except (AttributeError, KeyError, IndexError, TypeError, ValueError):
        _osrm_breaker.fail()
        return None
    line = decode_polyline(r.get('geometry') or '')
    _osrm_breaker.good()
    return {'distance_m': dist, 'duration_s': max(60, dur),
            'route': line or [[a, b] for a, b in pts], 'provider': 'osrm'}


def _route_straight(pts):
    dist = road_distance(pts)
    return {'distance_m': dist, 'duration_s': estimate_duration(dist),
            'route': [[a, b] for a, b in pts], 'provider': 'straight'}


# ─────────────────────────────────────────────────────────── подсказки адресов

def _provider():
    """Провайдер из настроек. У платного нет ключа — молча берём Nominatim:
    клиенту нужен адрес, а не рассказ о незаполненной настройке."""
    p = str(settings.get('geo.provider')
            or settings.get('geo.suggest_provider') or 'nominatim').lower()
    if p in ('yandex', '2gis') and not str(settings.get('geo.key', '') or '').strip():
        return 'nominatim'
    return p if p in ('nominatim', 'yandex', '2gis') else 'nominatim'


def _round(v):
    try:
        return round(float(v), 3)
    except (TypeError, ValueError):
        return None


def suggest(q, lat=None, lng=None, limit=8):
    """Подсказки адресов. Результат — [{title, subtitle, lat, lng, kind}].
    Пустой список тоже нормальный ответ: экран показывает «ничего не нашли»."""
    q = str(q or '').strip()
    if len(q) < 2:
        return []
    q = q[:120]
    try:
        limit = max(1, min(int(limit or 8), 10))
    except (TypeError, ValueError):
        limit = 8

    provider = _provider()
    key = ('s', provider, q.lower(), _round(lat), _round(lng), limit)
    hit = _suggest_cache.get(key)
    if hit is not None:
        return [dict(i) for i in hit]

    finder = {'yandex': _suggest_yandex, '2gis': _suggest_2gis}.get(provider, _suggest_nominatim)
    try:
        items = finder(q, lat, lng, limit)
    except Exception:
        items = None                      # чужой формат ответа не должен ронять запрос
    if items is None:
        # спросить не вышло: сервис молчит или мы упёрлись в свой же ограничитель.
        # Такой «пустой» ответ не кэшируем — через секунду попытка будет удачнее.
        return []
    here = _ll((lat, lng))
    if here and items:
        # ближнее к клиенту — вверх списка: обычно человек ищет соседнюю улицу
        items.sort(key=lambda i: haversine(here, (i['lat'], i['lng'])))
    items = items[:limit]
    _suggest_cache.put(key, items, SUGGEST_TTL if items else 60)
    return [dict(i) for i in items]


def _item(title, subtitle, lat, lng, kind='place'):
    ll = _ll((lat, lng))
    title = (title or '').strip()
    if not ll or not title:
        return None
    return {'title': title[:120], 'subtitle': (subtitle or '').strip()[:160],
            'lat': ll[0], 'lng': ll[1], 'kind': kind}


# ── Nominatim ────────────────────────────────────────────────────────────────

_NOM_KINDS = {'building': 'house', 'highway': 'street', 'place': 'place',
              'amenity': 'poi', 'shop': 'poi', 'office': 'poi',
              'tourism': 'poi', 'leisure': 'poi', 'railway': 'poi'}
_COUNTRY_WORDS = ('кыргызстан', 'киргизия', 'kyrgyzstan', 'kirgizistan')


def _nominatim_get(path, params):
    if not _nominatim_breaker.ok() or not _nominatim_throttle.acquire():
        return None
    data = _fetch_json(NOMINATIM + path + '?' + urlencode(params))
    if data is None:
        _nominatim_breaker.fail()
        return None
    _nominatim_breaker.good()
    return data


def _nominatim_common(params):
    params['format'] = 'jsonv2'
    params['addressdetails'] = 1
    params['accept-language'] = 'ru'
    country = str(settings.get('geo.country', 'kg') or '').strip()
    if country:
        params['countrycodes'] = country
    return params


def _suggest_nominatim(q, lat, lng, limit):
    params = _nominatim_common({'q': q, 'limit': limit})
    box = parse_bbox()
    if box:
        # viewbox у них идёт как левый-верхний и правый-нижний угол
        params['viewbox'] = '%.5f,%.5f,%.5f,%.5f' % (box[0], box[3], box[2], box[1])
        params['bounded'] = 1
    data = _nominatim_get('/search', params)
    if data is None:
        return None
    if not isinstance(data, list):
        return []
    out = []
    for raw in data:
        item = _from_nominatim(raw)
        if item:
            out.append(item)
    return out


def _from_nominatim(raw):
    if not isinstance(raw, dict):
        return None
    addr = raw.get('address') or {}
    road = addr.get('road') or addr.get('pedestrian') or addr.get('residential')
    house = addr.get('house_number')
    name = (raw.get('name') or '').strip()
    if name:
        title = name
    elif road and house:
        title = '%s, %s' % (road, house)
    elif road:
        title = road
    else:
        title = (raw.get('display_name') or '').split(',')[0]
    kind = _NOM_KINDS.get(raw.get('category') or raw.get('class'), 'place')
    if house:
        kind = 'house'
    return _item(title, _subtitle(raw.get('display_name'), title, addr),
                 raw.get('lat'), raw.get('lon'), kind)


def _subtitle(display, title, addr=None):
    """Подпись под адресом: район и город без индекса и названия страны —
    в Бишкеке слово «Кыргызстан» в каждой строке никому не помогает."""
    addr = addr or {}
    parts = [p.strip() for p in str(display or '').split(',') if p.strip()]
    out = []
    for p in parts:
        low = p.lower()
        if p == title or p in title:
            continue
        if low in _COUNTRY_WORDS:
            continue
        if p.replace(' ', '').isdigit() and len(p.replace(' ', '')) >= 5:
            continue
        if p not in out:
            out.append(p)
    if not out:
        city = addr.get('city') or addr.get('town') or addr.get('village')
        if city:
            out.append(city)
    return ', '.join(out[:3])


# ── Яндекс ───────────────────────────────────────────────────────────────────

_YA_KINDS = {'house': 'house', 'street': 'street', 'metro': 'poi', 'district': 'place',
             'locality': 'place', 'area': 'place', 'province': 'place', 'entrance': 'house'}


def _yandex_call(params):
    if not _paid_breaker.ok():
        return None
    params['apikey'] = str(settings.get('geo.key', '') or '')
    params['format'] = 'json'
    params['lang'] = 'ru_RU'
    data = _fetch_json(YANDEX + '?' + urlencode(params))
    if data is None:
        _paid_breaker.fail()
        return None
    _paid_breaker.good()
    try:
        return data['response']['GeoObjectCollection']['featureMember']
    except (KeyError, TypeError):
        return None


def _from_yandex(member):
    go = (member or {}).get('GeoObject') or {}
    pos = str((go.get('Point') or {}).get('pos') or '').split()
    if len(pos) != 2:
        return None
    meta = ((go.get('metaDataProperty') or {}).get('GeocoderMetaData') or {})
    kind = _YA_KINDS.get(str(meta.get('kind') or ''), 'place')
    title = go.get('name') or (meta.get('text') or '').split(',')[0]
    subtitle = go.get('description') or ''
    return _item(title, subtitle, pos[1], pos[0], kind)


def _suggest_yandex(q, lat, lng, limit):
    params = {'geocode': q, 'results': limit}
    here = _ll((lat, lng))
    if here:
        params['ll'] = '%.6f,%.6f' % (here[1], here[0])
        params['spn'] = '0.4,0.3'
    members = _yandex_call(params)
    if members is None:
        return _suggest_nominatim(q, lat, lng, limit)   # ключ есть, а сервис молчит
    out = []
    for m in members:
        item = _from_yandex(m)
        if item:
            out.append(item)
    return out


# ── 2ГИС ─────────────────────────────────────────────────────────────────────

_GIS_KINDS = {'building': 'house', 'street': 'street', 'branch': 'poi',
              'adm_div': 'place', 'attraction': 'poi', 'station': 'poi'}


def _gis_call(url):
    if not _paid_breaker.ok():
        return None
    data = _fetch_json(url)
    if data is None:
        _paid_breaker.fail()
        return None
    _paid_breaker.good()
    try:
        return data['result']['items']
    except (KeyError, TypeError):
        return None


def _from_gis(raw):
    if not isinstance(raw, dict):
        return None
    point = raw.get('point') or {}
    title = raw.get('name') or raw.get('full_name') or ''
    subtitle = raw.get('address_name') or raw.get('full_name') or ''
    if subtitle == title:
        subtitle = ''
    kind = _GIS_KINDS.get(str(raw.get('type') or ''), 'place')
    return _item(title, subtitle, point.get('lat'), point.get('lon'), kind)


def _suggest_2gis(q, lat, lng, limit):
    params = {'q': q, 'key': str(settings.get('geo.key', '') or ''), 'page_size': limit,
              'locale': 'ru_KG', 'fields': 'items.point,items.address,items.full_name'}
    here = _ll((lat, lng))
    if here:
        params['location'] = '%.6f,%.6f' % (here[1], here[0])
    items = _gis_call(GIS2 + '?' + urlencode(params))
    if items is None:
        return _suggest_nominatim(q, lat, lng, limit)
    out = []
    for raw in items:
        item = _from_gis(raw)
        if item:
            out.append(item)
    return out


# ─────────────────────────────────────────────────────────── адрес по координатам

def reverse(lat, lng):
    """Адрес точки, которую поставили пальцем на карте.
    Если геокодер недоступен — отдаём координаты: заказ оформить всё равно можно."""
    here = _ll((lat, lng))
    if not here:
        return {'title': '', 'subtitle': '', 'lat': None, 'lng': None}
    provider = _provider()
    key = ('v', provider, round(here[0], 5), round(here[1], 5))
    hit = _reverse_cache.get(key)
    if hit is not None:
        return dict(hit)

    finder = {'yandex': _reverse_yandex, '2gis': _reverse_2gis}.get(provider, _reverse_nominatim)
    try:
        found = finder(here[0], here[1])
    except Exception:
        found = None
    if not found:
        return {'title': 'Точка на карте', 'subtitle': '%.5f, %.5f' % here,
                'lat': here[0], 'lng': here[1]}
    out = {'title': found['title'], 'subtitle': found['subtitle'],
           'lat': here[0], 'lng': here[1]}
    _reverse_cache.put(key, out, REVERSE_TTL)
    return dict(out)


def _reverse_nominatim(lat, lng):
    params = _nominatim_common({'lat': '%.6f' % lat, 'lon': '%.6f' % lng, 'zoom': 18})
    params.pop('countrycodes', None)       # обратный геокодер эту фильтрацию не понимает
    data = _nominatim_get('/reverse', params)
    if not isinstance(data, dict) or data.get('error'):
        return None
    return _from_nominatim(data)


def _reverse_yandex(lat, lng):
    members = _yandex_call({'geocode': '%.6f,%.6f' % (lng, lat), 'results': 1, 'kind': 'house'})
    if not members:
        return _reverse_nominatim(lat, lng)
    return _from_yandex(members[0])


def _reverse_2gis(lat, lng):
    params = {'lat': '%.6f' % lat, 'lon': '%.6f' % lng,
              'key': str(settings.get('geo.key', '') or ''), 'locale': 'ru_KG',
              'fields': 'items.point,items.address,items.full_name'}
    items = _gis_call(GIS2 + '/geocode?' + urlencode(params))
    if not items:
        return _reverse_nominatim(lat, lng)
    return _from_gis(items[0])
