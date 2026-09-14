# -*- coding: utf-8 -*-
# Перевод адресов и маршрутов Sprinter Go на 2ГИС.
#
# Почему не карту: растровые плитки 2ГИС отдаются вообще без ключа — это их
# собственный сервер для их же карты, а не лицензированный продукт. Подкладывать
# его к себе значит жить на чужой инфраструктуре без договора, поэтому подложка
# остаётся на OpenStreetMap. Ключ идёт на то, для чего он выдан: адреса и маршруты.
import glob, io, json, os, re, shutil, sqlite3, subprocess, sys, time
import urllib.error, urllib.request

DEST = os.environ.get('SG_DEST', '/home/sprintergo-platform')
DB = os.environ.get('SG_DB', os.path.join(DEST, 'data', 'sprintergo.sqlite3'))
DOMAIN = os.environ.get('SG_DOMAIN', 'sprintergo.kg')
SERVICE = os.environ.get('SG_SERVICE', 'sprintergo-platform')
KEY = os.environ.get('SG_2GIS_KEY', '').strip()
PORT = os.environ.get('SG_PORT', '7030')

CATALOG = 'https://catalog.api.2gis.com/3.0/items/geocode'
ROUTER = 'https://routing.api.2gis.com/routing/7.0.0/global'
# Плитки 2ГИС. Движок сам поднимает ts до online_hd на экранах с высокой
# плотностью и сам подписывает источник — подпись обязательна по условиям.
TILES = 'https://tile2.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1&ts=online_sd'
TILE_HOSTS = ['https://*.maps.2gis.com', 'https://tile2.maps.2gis.com']


def run(*cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        class Err:
            returncode, stdout = 1, ''
            stderr = str(e)
        return Err()


print('Подключение 2ГИС\n')
if not KEY:
    sys.exit('Ключ не передан: SG_2GIS_KEY=...')

# ── 1. проверяем ключ живыми запросами ──────────────────────────────────────
print('1. Проверяем ключ')
geo_ok = route_ok = tiles_ok = False
try:
    from urllib.parse import urlencode
    url = CATALOG + '?' + urlencode({'q': 'Бишкек, Чуй 100', 'fields': 'items.point,items.address',
                                     'key': KEY})
    with urllib.request.urlopen(urllib.request.Request(
            url, headers={'User-Agent': 'SprinterGo/1.0'}), timeout=20) as r:
        d = json.loads(r.read().decode('utf-8'))
    n = len((d.get('result') or {}).get('items') or [])
    geo_ok = n > 0
    print(f'   адреса      {"ок" if geo_ok else "нет"} — найдено объектов: {n}')
except Exception as e:
    print('   адреса      нет —', str(e)[:120])

try:
    body = json.dumps({'points': [{'type': 'stop', 'lon': 74.5698, 'lat': 42.8746},
                                  {'type': 'stop', 'lon': 74.6100, 'lat': 42.8380}],
                       'locale': 'ru', 'transport': 'driving',
                       'route_mode': 'fastest', 'traffic_mode': 'jam'}).encode()
    with urllib.request.urlopen(urllib.request.Request(
            ROUTER + '?key=' + KEY, data=body,
            headers={'Content-Type': 'application/json', 'User-Agent': 'SprinterGo/1.0'},
            method='POST'), timeout=25) as r:
        d = json.loads(r.read().decode('utf-8'))
    item = (d.get('result') or [{}])[0]
    dist, dur = item.get('total_distance'), item.get('total_duration')
    route_ok = bool(dist and dur)
    print(f'   маршруты    {"ок" if route_ok else "нет"} — {dist} м, {dur} с, '
          f'{item.get("algorithm", "")}')
except Exception as e:
    print('   маршруты    нет —', str(e)[:120])

try:
    with urllib.request.urlopen(urllib.request.Request(
            TILES.replace('{x}', '5792').replace('{y}', '3014').replace('{z}', '13'),
            headers={'User-Agent': 'SprinterGo/1.0'}), timeout=20) as r:
        tiles_ok = r.headers.get('Content-Type', '').startswith('image/')
    print(f'   карта       {"ок" if tiles_ok else "нет"} — плитки Бишкека приходят')
except Exception as e:
    print('   карта       нет —', str(e)[:120])

if not (geo_ok or route_ok):
    sys.exit('\nКлюч не принят ни одним сервисом. Проверьте, что в кабинете 2ГИС '
             'подключены Каталог и Маршруты.')

# ── 2. разрешаем плитки в политике безопасности ─────────────────────────────
print('\n2. Разрешаем плитки 2ГИС в политике безопасности')
conf = None
for pat in ('/etc/nginx/sites-available/*', '/etc/nginx/sites-enabled/*', '/etc/nginx/conf.d/*.conf'):
    for f in sorted(glob.glob(pat)):
        f = os.path.realpath(f)
        if not os.path.isfile(f) or re.search(r'(\.bak\d*|~)$', f):
            continue
        t = io.open(f, encoding='utf-8', errors='replace').read()
        if 'Content-Security-Policy' in t and re.search(
                r'server_name[^;]*\b' + re.escape(DOMAIN) + r'\b', t):
            conf = f
            break
    if conf:
        break

if not conf:
    print('   ! конфиг с политикой не найден — карта может остаться пустой')
else:
    text = io.open(conf, encoding='utf-8').read()

    def fix_directive(csp, name):
        m = re.search(name + r'\s+([^;]*);', csp)
        if not m:
            return csp
        have = m.group(1)
        add = [h for h in TILE_HOSTS if h not in have]
        if not add:
            return csp
        return csp[:m.start(1)] + have.rstrip() + ' ' + ' '.join(add) + csp[m.end(1):]

    new_text = re.sub(r'(add_header\s+Content-Security-Policy\s+")([^"]*)(")',
                      lambda m: m.group(1) + fix_directive(m.group(2), 'img-src') + m.group(3),
                      text)
    if new_text == text:
        print('   уже разрешены')
    else:
        i, bak = 0, conf + '.bak'
        while os.path.exists(bak):
            i += 1
            bak = f'{conf}.bak{i}'
        shutil.copy2(conf, bak)
        io.open(conf, 'w', encoding='utf-8').write(new_text)
        check = run('nginx', '-t')
        if check.returncode != 0:
            shutil.copy2(bak, conf)
            sys.exit('   nginx отверг конфиг, вернул как было:\n' + (check.stderr or check.stdout))
        run('systemctl', 'reload', 'nginx')
        print('   разрешён *.maps.2gis.com · копия конфига:', bak)

# ── 3. пишем настройки ──────────────────────────────────────────────────────
print('\n3. Записываем настройки')
if not os.path.isfile(DB):
    sys.exit(f'не нашёл базу {DB} — сервис хоть раз запускался?')

values = {}
if geo_ok:
    values.update({'geo.provider': '2gis', 'geo.key': KEY})
if route_ok:
    values.update({'route.provider': '2gis', 'route.key': KEY})
if tiles_ok:
    values.update({'map.provider': '2gis', 'map.tiles_light': TILES,
                   'map.tiles_dark': TILES, 'map.attribution': '© 2ГИС'})

con = sqlite3.connect(DB, timeout=15)
con.execute('PRAGMA journal_mode=WAL')
for k, v in values.items():
    con.execute('INSERT INTO settings(key,value) VALUES(?,?) '
                'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                (k, json.dumps(v, ensure_ascii=False)))
con.commit()
con.close()
for k in sorted(values):
    print(f'   {k} = ' + (values[k][:8] + '…' if k.endswith('key') else values[k]))

run('systemctl', 'restart', SERVICE)
print(f'   служба {SERVICE} перезапущена')

# ── 3. проверяем сервис ─────────────────────────────────────────────────────
print('\n4. Проверяем сервис')
for _ in range(40):
    time.sleep(0.5)
    if run('curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
           f'http://127.0.0.1:{PORT}/api/v1/config').stdout.strip() == '200':
        break
probe = run('curl', '-s', '-m', '25', '-X', 'POST',
            f'https://{DOMAIN}/go/api/v1/geo/route',
            '-H', 'Content-Type: application/json',
            '-d', '{"points":[[42.8746,74.5698],[42.8380,74.6100]]}').stdout
try:
    r = json.loads(probe)
    print(f'   маршрут через сайт: {r.get("provider")} · {r.get("distance_m")} м · '
          f'свободно {r.get("duration_s")} с · сейчас {r.get("duration_traffic_s")} с')
    print('   пробки учитываются:', 'да' if r.get('traffic') else 'нет')
except Exception:
    print('   ответ сайта:', probe[:160])

print(f'''
Готово.

  Адреса    2ГИС — лучшая база по Бишкеку, с номерами домов
  Маршруты  2ГИС — расстояние по дорогам и время с настоящими пробками
  Карта     2ГИС — подложка Бишкека с домами и организациями

Проверьте на сайте: введите адрес — подсказки должны стать точнее,
а рядом со временем появится метка про пробки.
''')
