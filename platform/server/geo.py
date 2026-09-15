# -*- coding: utf-8 -*-
"""География: расстояния, подсказки адресов, обратный геокодер и маршрут.

Внешние сервисы подключены по принципу «помогают, но не держат». Любая ошибка,
таймаут или выключенный интернет — и мы честно считаем по прямой с поправкой
на дороги. Клиент не должен смотреть на крутилку из-за того, что у кого-то
в Германии лёг OSRM, а Nominatim решил, что мы ходим слишком часто.

Ключевые приёмы: короткий таймаут, кэш в памяти, ограничение частоты запросов
к Nominatim (у них 1 запрос в секунду в правилах) и предохранитель — после сбоя
полминуты даже не стучимся, а сразу отвечаем из своей арифметики.

Время в пути отдаём двумя числами: duration_s — свободная дорога, как её считает
маршрутизатор, и duration_traffic_s — сколько ехать на самом деле. Второе берётся
у Яндекс-маршрутизатора, когда владелец вписал ключ, а без ключа считается
поправкой на бишкекский час пик. Обещать человеку двадцать минут в шесть вечера,
когда на Чуй стоит пробка, — это враньё, за которое отвечает курьер.
"""
import json
import math
import threading
import time
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

from . import settings

TIMEOUT = 3.0                  # секунды на любой внешний вызов
NOMINATIM = 'https://nominatim.openstreetmap.org'
YANDEX = 'https://geocode-maps.yandex.ru/1.x/'
YANDEX_ROUTER = 'https://api.routing.yandex.net/v2/route'
GIS2 = 'https://catalog.api.2gis.com/3.0/items'
EARTH_R = 6371008.8            # средний радиус Земли, метры

SUGGEST_TTL = 600              # подсказки живут 10 минут
REVERSE_TTL = 1800             # адрес по координатам меняется ещё реже
ROUTE_TTL = 600
TRAFFIC_TTL = 180              # пробки меняются быстро, такой ответ держим меньше


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
_router_breaker = _Breaker()
_nominatim_throttle = _Throttle()


# ─────────────────────────────────────────────────────────── время и пробки

# Бишкек круглый год +6 и без перевода часов. Держим этот запасной пояс на случай,
# когда в системе нет базы часовых поясов: на голом Alpine её часто не ставят.
BISHKEK_TZ = timezone(timedelta(hours=6))

# Значения по умолчанию для настроек route.rush_factor и route.night_factor.
# Час пик в Бишкеке — это примерно в полтора раза дольше обычного, а ночью город
# пустой и та же дорога занимает меньше времени.
RUSH_FACTOR = 1.45
NIGHT_FACTOR = 0.85

# Часы пик по местному времени: утром едут на работу, вечером — с работы.
RUSH_HOURS = ((8.0, 10.0), (17.0, 20.0))
NIGHT_FROM, NIGHT_TO = 22.0, 6.0

_tz_cache = (None, None)       # (имя из настроек, разобранный пояс)
_tz_lock = threading.Lock()


def service_tz():
    """Часовой пояс сервиса из настроек service.tz.

    Разбирать имя на каждый расчёт маршрута незачем — оно меняется раз в жизни,
    поэтому держим разобранный пояс рядом с именем, из которого он получен.
    """
    global _tz_cache
    name = str(settings.get('service.tz', 'Asia/Bishkek') or '').strip()
    with _tz_lock:
        cached_name, cached_tz = _tz_cache
    if cached_tz is not None and cached_name == name:
        return cached_tz
    tz = BISHKEK_TZ
    if name:
        try:
            from zoneinfo import ZoneInfo
            tz = ZoneInfo(name)
        except Exception:
            tz = BISHKEK_TZ
    with _tz_lock:
        _tz_cache = (name, tz)
    return tz


def local_time(at=None):
    """Местное время сервиса. Системное время сервера здесь не годится: машина
    может стоять во Франкфурте, а пробки стоят в Бишкеке."""
    unix = int(at if at is not None else time.time())
    return datetime.fromtimestamp(unix, tz=timezone.utc).astimezone(service_tz())


def traffic_factor(at=None):
    """Во сколько раз дорога в этот час дольше свободной.

    Коэффициенты лежат в настройках, чтобы владелец подкрутил их под свой город,
    не трогая код. Границы жёсткие: множитель меньше единицы в час пик или
    трёхкратный ночью — это опечатка в админке, а не тонкая настройка.
    """
    d = local_time(at)
    hour = d.hour + d.minute / 60.0
    if hour >= NIGHT_FROM or hour < NIGHT_TO:
        return min(1.0, max(0.5, settings.get_float('route.night_factor', NIGHT_FACTOR)))
    if d.weekday() < 5 and any(a <= hour < b for a, b in RUSH_HOURS):
        return min(3.0, max(1.0, settings.get_float('route.rush_factor', RUSH_FACTOR)))
    return 1.0


def duration_with_traffic(duration_s, at=None):
    """Время в пути с поправкой на час пик. Минута — нижняя граница: нулевая
    длительность ломает и расчёт цены, и полосу прогресса на экране."""
    return max(60, int(round(float(duration_s or 0) * traffic_factor(at))))


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


def _post_json(url, payload, timeout=TIMEOUT, headers=None):
    """То же, что _fetch_json, но методом POST: маршрутизатор 2ГИС принимает
    точки только телом запроса. Молчит при любой беде — маршрут не та вещь,
    из-за которой человеку стоит видеть ошибку."""
    head = {'User-Agent': _ua(), 'Accept': 'application/json',
            'Content-Type': 'application/json'}
    if headers:
        head.update(headers)
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    try:
        with urlopen(Request(url, data=body, headers=head, method='POST'), timeout=timeout) as resp:
            raw = resp.read(1 << 21)
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
    """Маршрут по точкам: расстояние, два времени и линия для карты.

    duration_s — свободная дорога, duration_traffic_s — сколько ехать сейчас.
    Порядок попыток: Яндекс-маршрутизатор с пробками (если вписан ключ), потом
    OSRM, потом своя арифметика по прямой. Никто не ответил — заказ всё равно
    должен оформиться, поэтому последний вариант не отключается никогда.
    """
    pts = clean_points(points)
    if len(pts) < 2:
        line = [[pts[0][0], pts[0][1]]] if pts else []
        return {'distance_m': 0, 'duration_s': 0, 'duration_traffic_s': 0,
                'route': line, 'provider': 'straight', 'traffic': False}

    key = ('r',) + tuple((round(a, 5), round(b, 5)) for a, b in pts)
    out = _route_cache.get(key)
    if not out:
        provider = str(settings.get('route.provider', 'osrm')).lower()
        if _use_2gis_route(provider):
            out = _route_2gis(pts)
        if not out and _use_yandex(provider):
            out = _route_yandex(pts)
        if not out and provider in ('osrm', 'yandex', '2gis') and _osrm_breaker.ok():
            out = _route_osrm(pts)
        if not out:
            out = _route_straight(pts)
        _route_cache.put(key, out, TRAFFIC_TTL if out['traffic'] else ROUTE_TTL)

    # У маршрутизатора время с пробками своё, честное. У остальных его нет,
    # поэтому считаем его здесь и на каждый ответ заново: тот же маршрут,
    # запрошенный в шесть вечера и в полночь, едется по-разному.
    traffic_s = (out['duration_traffic_s'] if out['traffic']
                 else duration_with_traffic(out['duration_s']))
    return {'distance_m': out['distance_m'], 'duration_s': out['duration_s'],
            'duration_traffic_s': traffic_s,
            'route': [list(p) for p in out['route']], 'provider': out['provider'],
            'traffic': out['traffic'], 'rush': round(traffic_factor(), 2)}


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
    return {'distance_m': dist, 'duration_s': max(60, dur), 'duration_traffic_s': 0,
            'route': line or [[a, b] for a, b in pts], 'provider': 'osrm', 'traffic': False}


def _route_straight(pts):
    dist = road_distance(pts)
    return {'distance_m': dist, 'duration_s': estimate_duration(dist),
            'duration_traffic_s': 0, 'route': [[a, b] for a, b in pts],
            'provider': 'straight', 'traffic': False}


# ── Яндекс-маршрутизатор ─────────────────────────────────────────────────────

# Имена полей в ответе маршрутизатора со временем менялись, поэтому принимаем все,
# что встречались: лишний ключ в этом списке ничего не стоит, а пропущенный
# превращает время с пробками в обычное.
_YA_LEN_KEYS = ('length', 'distance')
_YA_TIME_KEYS = ('duration', 'time')
_YA_JAM_KEYS = ('duration_in_jams', 'durationInJams', 'jams_duration',
                'jamsTime', 'duration_in_traffic')
_YA_BRANCH_KEYS = ('route', 'routes', 'legs', 'steps', 'sections')


def _use_yandex(provider=None):
    """Маршрутизатор Яндекса включаем только тогда, когда он выбран и ключ вписан:
    без ключа сервис отвечает отказом, а человек за это время смотрит на крутилку."""
    if provider is None:
        provider = str(settings.get('route.provider', 'osrm')).lower()
    if provider != 'yandex':
        return False
    if not str(settings.get('route.key', '') or '').strip():
        return False
    return _router_breaker.ok()


GIS2_ROUTER = 'https://routing.api.2gis.com/routing/7.0.0/global'


def _use_2gis_route(provider=None):
    """Маршруты 2ГИС включаем, только если выбран провайдер и есть ключ.
    Для Бишкека это лучший источник: дороги свежее, пробки настоящие."""
    if provider is None:
        provider = str(settings.get('route.provider', 'osrm')).lower()
    if provider != '2gis':
        return False
    if not _gis_route_key():
        return False
    return _router_breaker.ok()


def _gis_route_key():
    """Отдельный ключ для маршрутов, а если его не завели — общий ключ 2ГИС."""
    return (str(settings.get('route.key', '') or '').strip()
            or str(settings.get('geo.key', '') or '').strip())


def _wkt_line(text):
    """LINESTRING(lon lat, lon lat, …) → [[lat, lng], …].

    2ГИС отдаёт геометрию текстом, разбираем сами: тащить в проект разбор
    геоформатов ради одной строки незачем."""
    out = []
    body = str(text or '')
    a, b = body.find('('), body.rfind(')')
    if a < 0 or b <= a:
        return out
    for pair in body[a + 1:b].split(','):
        parts = pair.replace('(', ' ').replace(')', ' ').split()
        if len(parts) < 2:
            continue
        try:
            lng, lat = float(parts[0]), float(parts[1])
        except ValueError:
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            out.append([lat, lng])
    return out


def _route_2gis(pts):
    """Маршрут по дорогам Бишкека с настоящими пробками.

    Время приходит одно — то, за которое доедешь сейчас. Свободную дорогу
    оцениваем по расстоянию и средней скорости: нужно только для того, чтобы
    человек видел, насколько пробки добавляют, поэтому точности хватает.
    """
    payload = {
        'points': [{'type': 'stop', 'lon': round(lng, 6), 'lat': round(lat, 6)}
                   for lat, lng in pts],
        'locale': 'ru', 'transport': 'driving',
        'route_mode': 'fastest', 'traffic_mode': 'jam',
        'output': 'detailed',
    }
    data = _post_json(GIS2_ROUTER + '?key=' + quote(_gis_route_key()), payload)
    if not isinstance(data, dict):
        _router_breaker.fail()
        return None
    items = data.get('result') or []
    if not items or not isinstance(items[0], dict):
        _router_breaker.fail()
        return None
    r = items[0]
    try:
        dist = int(round(float(r.get('total_distance') or 0)))
        jam_s = int(round(float(r.get('total_duration') or 0)))
    except (TypeError, ValueError):
        _router_breaker.fail()
        return None
    if dist <= 0 or jam_s <= 0:
        _router_breaker.fail()
        return None

    line = []
    for man in (r.get('maneuvers') or []):
        path = (man or {}).get('outcoming_path') or {}
        for piece in (path.get('geometry') or []):
            part = _wkt_line((piece or {}).get('selection'))
            # стыки манёвров повторяют точку — убираем, иначе линия дрожит
            if line and part and line[-1] == part[0]:
                part = part[1:]
            line.extend(part)
    if len(line) < 2:
        line = [[a, b] for a, b in pts]

    # Отдельная скорость для «свободной дороги»: средняя по городу занижена
    # (в ней уже сидят пробки), и сравнение получалось бы бессмысленным —
    # даже в затор метка показывала бы свободный проезд.
    speed = settings.get_float('route.free_speed_kmh', 42) or 42
    free_s = max(60, int(round(dist / 1000.0 / speed * 3600)))
    _router_breaker.good()
    return {'distance_m': dist, 'duration_s': min(free_s, jam_s),
            'duration_traffic_s': jam_s, 'route': line,
            'provider': '2gis', 'traffic': True}


def _route_yandex(pts):
    """Маршрут с пробками. Не ответил или ответил невнятно — возвращаем None,
    и route() спокойно уходит на OSRM."""
    params = {
        'apikey': str(settings.get('route.key', '') or '').strip(),
        'waypoints': '|'.join('%.6f,%.6f' % (lat, lng) for lat, lng in pts),
        'mode': 'driving',
        'lang': 'ru_RU',
    }
    data = _fetch_json(YANDEX_ROUTER + '?' + urlencode(params))
    if not isinstance(data, dict):
        _router_breaker.fail()
        return None
    try:
        totals = {'len': 0.0, 'time': 0.0, 'jams': 0.0, 'line': []}
        _yandex_walk(data, totals)
    except Exception:
        totals = None                  # чужой формат не должен ронять оформление заказа
    if not totals or totals['len'] <= 0 or totals['time'] <= 0:
        _router_breaker.fail()
        return None
    _router_breaker.good()
    free = max(60, int(round(totals['time'])))
    jams = max(free, int(round(totals['jams']))) if totals['jams'] > 0 else 0
    return {'distance_m': int(round(totals['len'])), 'duration_s': free,
            'duration_traffic_s': jams or free,
            'route': totals['line'] or [[a, b] for a, b in pts],
            'provider': 'yandex', 'traffic': bool(jams)}


def _yandex_num(v):
    """Число из ответа: приходит то 1234.5, то {'value': 1234.5, 'text': '1,2 км'}."""
    if isinstance(v, dict):
        v = v.get('value', v.get('seconds', v.get('meters')))
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0.0
    return n if n >= 0 else 0.0


def _yandex_first(node, keys):
    for k in keys:
        if k in node:
            n = _yandex_num(node[k])
            if n:
                return n
    return 0.0


def _yandex_walk(node, out, depth=0):
    """Складываем длину и время по самым мелким кускам маршрута.

    Ответ вложенный: маршрут → участки → шаги, и итог написан на каждом уровне.
    Если складывать всё подряд, дорога получится в три раза длиннее, поэтому узел
    с вложенными частями сам в сумму не идёт — считаем только листья.
    """
    if depth > 10:
        return
    if isinstance(node, list):
        for item in node:
            _yandex_walk(item, out, depth + 1)
        return
    if not isinstance(node, dict):
        return
    branches = [node[k] for k in _YA_BRANCH_KEYS if node.get(k)]
    if branches:
        for branch in branches:
            _yandex_walk(branch, out, depth + 1)
        return
    length = _yandex_first(node, _YA_LEN_KEYS)
    seconds = _yandex_first(node, _YA_TIME_KEYS)
    if not length and not seconds:
        return
    out['len'] += length
    out['time'] += seconds
    out['jams'] += _yandex_first(node, _YA_JAM_KEYS) or seconds
    out['line'].extend(_yandex_line(node))


def _yandex_line(node):
    """Линия шага: либо упакованная строка, как у OSRM, либо список координат."""
    poly = node.get('polyline') or node.get('geometry')
    if isinstance(poly, str):
        return decode_polyline(poly)
    if isinstance(poly, dict):
        packed = poly.get('points')
        if isinstance(packed, str) and packed:
            return decode_polyline(packed)
        coords = poly.get('coordinates')
        if isinstance(coords, list):
            out = []
            for c in coords:
                ll = _ll((c[1], c[0])) if isinstance(c, (list, tuple)) and len(c) >= 2 else None
                if ll:
                    out.append([ll[0], ll[1]])
            return out
    return []


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


# Чем меньше число, тем полезнее ответ человеку, который ткнул в карту.
# 2ГИС отдаёт дома, перекрёстки, улицы и районы вперемешку и в своём порядке,
# поэтому брать первый попавшийся нельзя: вместо «улица Токтогула, 12»
# запросто прилетит «Свердловский» — район, по которому машину не подать.
_GIS_REVERSE_RANK = {
    'building': 0, 'house': 0, 'branch': 1, 'poi': 1, 'station': 2,
    'crossroad': 3, 'street': 4, 'road': 4,
    'district': 6, 'adm_div': 6, 'settlement': 7, 'city': 8, 'region': 9,
}
_GIS_TOO_BROAD = 6          # с этого уровня адрес уже бесполезен для подачи


def _reverse_2gis(lat, lng):
    params = {'lat': '%.6f' % lat, 'lon': '%.6f' % lng,
              'key': str(settings.get('geo.key', '') or ''), 'locale': 'ru_KG',
              'fields': 'items.point,items.address,items.full_name,items.address_name'}
    items = _gis_call(GIS2 + '/geocode?' + urlencode(params))
    if not items:
        return _reverse_nominatim(lat, lng)

    def rank(it):
        return _GIS_REVERSE_RANK.get(str((it or {}).get('type') or ''), 5)

    best = min(items, key=rank)
    # Остался только район или город — у соседа спросим точнее: OpenStreetMap
    # такие места часто знает по улице.
    if rank(best) >= _GIS_TOO_BROAD:
        fallback = _reverse_nominatim(lat, lng)
        if fallback and fallback.get('title'):
            return fallback
    return _from_gis(best)
