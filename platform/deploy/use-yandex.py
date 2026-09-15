# -*- coding: utf-8 -*-
# Перевод карты и адресов Sprinter Go на Яндекс.
import glob, io, json, os, re, shutil, sqlite3, subprocess, sys, time
import urllib.error, urllib.request

DEST = os.environ.get('SG_DEST', '/home/sprintergo-platform')
DB = os.environ.get('SG_DB', os.path.join(DEST, 'data', 'sprintergo.sqlite3'))
DOMAIN = os.environ.get('SG_DOMAIN', 'sprintergo.kg')
SERVICE = os.environ.get('SG_SERVICE', 'sprintergo-platform')
TILES_KEY = os.environ.get('SG_TILES_KEY', '').strip()
GEO_KEY = os.environ.get('SG_GEO_KEY', '').strip()
DRY = os.environ.get('SG_DRY') == '1'

TILE_HOSTS = ['https://tiles.api-maps.yandex.ru', 'https://*.maps.yandex.net',
              'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org',
              'https://basemaps.cartocdn.com', 'https://*.basemaps.cartocdn.com']
TILE_URL = ('https://tiles.api-maps.yandex.ru/v1/tiles'
            '?l=map&x={x}&y={y}&z={z}&lang=ru_RU&apikey=' + TILES_KEY)
GEOCODER = 'https://geocode-maps.yandex.ru/1.x/'
# Логотип обязателен по лицензии Яндекса и должен вести на Яндекс Карты.
YANDEX_ATTR = ('<a href="https://yandex.ru/maps/" target="_blank" rel="noopener">'
               '© Яндекс Карты</a>')


def run(*cmd):
    if DRY and cmd[0] in ('systemctl', 'nginx'):
        class Fake:
            returncode, stdout, stderr = 0, '', ''
        return Fake()
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as e:
        class Err:
            returncode, stdout = 1, ''
            stderr = str(e)
        return Err()


def backup(path):
    i, bak = 0, path + '.bak'
    while os.path.exists(bak):
        i += 1
        bak = f'{path}.bak{i}'
    shutil.copy2(path, bak)
    return bak


def probe_tile(url, timeout=20):
    """Просим одну плитку Бишкека: возвращает (ок, пояснение)."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'SprinterGo/1.0'})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(2048)
            if r.headers.get('Content-Type', '').startswith('image/'):
                return True, f'плитка приходит, {len(body)}+ байт'
            return False, 'вместо картинки: ' + body[:120].decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return False, f'{e.code}: {e.read()[:140].decode("utf-8", "replace")}'
    except Exception as e:
        return False, str(e)[:120]


def probe_geocode(key):
    from urllib.parse import urlencode
    url = GEOCODER + '?' + urlencode({'apikey': key, 'format': 'json', 'lang': 'ru_RU',
                                      'geocode': 'Бишкек, Чуй 100'})
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'SprinterGo/1.0'})
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.loads(r.read().decode('utf-8'))
        n = len(d['response']['GeoObjectCollection']['featureMember'])
        return (n > 0), f'найдено объектов: {n}'
    except urllib.error.HTTPError as e:
        return False, f'{e.code}: {e.read()[:140].decode("utf-8", "replace")}'
    except Exception as e:
        return False, str(e)[:120]


print('Переключение на Яндекс\n')

# ── 1. политика безопасности домена ─────────────────────────────────────────
print('1. Разрешаем плитки в политике безопасности')
conf = None
GLOBS = os.environ.get('SG_NGINX_GLOBS',
                       '/etc/nginx/sites-available/*:/etc/nginx/sites-enabled/*:/etc/nginx/conf.d/*.conf')
for pat in GLOBS.split(':'):
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
    print('   ! конфиг с политикой не найден — пропускаем, но карта может остаться пустой')
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

    def patch_csp(m):
        csp = m.group(2)
        csp = fix_directive(csp, 'img-src')
        csp = fix_directive(csp, 'connect-src')
        return m.group(1) + csp + m.group(3)

    new = re.sub(r'(add_header\s+Content-Security-Policy\s+")([^"]*)(")', patch_csp, text)
    if new == text:
        print('   плитки уже разрешены')
    else:
        bak = backup(conf)
        io.open(conf, 'w', encoding='utf-8').write(new)
        check = run('nginx', '-t')
        if check.returncode != 0:
            shutil.copy2(bak, conf)
            sys.exit('   nginx отверг конфиг, вернул как было:\n' + (check.stderr or check.stdout))
        run('systemctl', 'reload', 'nginx')
        print(f'   разрешены: tiles.api-maps.yandex.ru, tile.openstreetmap.org и остальные')
        print(f'   копия конфига: {bak}')

# ── 2. проверка ключей ──────────────────────────────────────────────────────
print('\n2. Проверяем ключи')
tiles_ok = geo_ok = False
if TILES_KEY:
    tiles_ok, why = probe_tile(TILE_URL.replace('{x}', '5792')
                               .replace('{y}', '3014').replace('{z}', '13'))
    print(f'   Tiles API   {"ок" if tiles_ok else "пока нет"} — {why}')
else:
    print('   Tiles API   ключ не передан')
if GEO_KEY:
    geo_ok, why = probe_geocode(GEO_KEY)
    print(f'   Геокодер    {"ок" if geo_ok else "пока нет"} — {why}')
else:
    print('   Геокодер    ключ не передан')

# ── 3. настройки в базе ─────────────────────────────────────────────────────
print('\n3. Записываем настройки')
if not os.path.isfile(DB):
    sys.exit(f'не нашёл базу {DB} — сервис хоть раз запускался?')

values = {}
if tiles_ok:
    values.update({
        'map.provider': 'yandex',
        'map.key': TILES_KEY,
        'map.tiles_light': TILE_URL,
        'map.tiles_dark': TILE_URL,          # у Tiles API одна подложка
        'map.attribution': YANDEX_ATTR,
    })
if geo_ok:
    values.update({'geo.provider': 'yandex', 'geo.key': GEO_KEY})

if not values:
    print('   ключи ещё не активны — провайдеры не трогаем, карта остаётся прежней')
else:
    con = sqlite3.connect(DB, timeout=15)
    con.execute('PRAGMA journal_mode=WAL')
    for k, v in values.items():
        con.execute('INSERT INTO settings(key,value) VALUES(?,?) '
                    'ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                    (k, json.dumps(v, ensure_ascii=False)))
    con.commit()
    con.close()
    for k in sorted(values):
        shown = values[k]
        if k.endswith('key'):
            shown = shown[:8] + '…'
        print(f'   {k} = {shown if len(str(shown)) < 90 else str(shown)[:88] + "…"}')
    run('systemctl', 'restart', SERVICE)
    print(f'   служба {SERVICE} перезапущена')

# ── 4. проверка снаружи ─────────────────────────────────────────────────────
if values and not DRY:
    print('\n4. Проверяем сервис')
    for _ in range(30):
        time.sleep(0.5)
        r = run('curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
                'http://127.0.0.1:7030/api/v1/config')
        if r.stdout.strip() == '200':
            break
    cfg = run('curl', '-s', '-m', '15', f'https://{DOMAIN}/go/api/v1/config').stdout
    print('   карта в конфиге:', 'Яндекс' if 'api-maps.yandex' in cfg else 'прежняя')
    csp = run('curl', '-sI', '-m', '15', f'https://{DOMAIN}/go/').stdout
    print('   плитки разрешены политикой:',
          'да' if 'tiles.api-maps.yandex.ru' in csp else 'НЕТ, проверьте конфиг')

print('\nГотово.')
if not (tiles_ok and geo_ok):
    print('Ключи Яндекс активирует не мгновенно. Подождите 15–30 минут')
    print('и запустите эту же команду ещё раз — она доделает остальное.')
else:
    print(f'Откройте https://{DOMAIN}/go/ — карта должна быть от Яндекса,')
    print('с русскими подписями улиц Бишкека и логотипом в углу.')
