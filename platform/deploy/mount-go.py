#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Подключение платформы к sprintergo.kg/go/ — лендинг на корне не трогаем.

Что делает:
  1. распаковывает архив платформы в /home/sprintergo-platform
  2. ставит службу systemd, которая держит сервис на 127.0.0.1:7030 с префиксом /go/
  3. добавляет в конфиг nginx блок location ^~ /go/ с проксированием и настройками SSE
  4. проверяет конфиг, перезагружает nginx и убеждается, что всё отвечает

Запускать можно повторно: блок и служба заменяются, дублей не будет.
Перед правкой рядом с каждым файлом кладётся резервная копия.
"""
import glob, io, os, re, shutil, subprocess, sys, time, zipfile

ZIP = os.environ.get('SG_ZIP', '/home/sprintergo-platform.zip')
DEST = os.environ.get('SG_DEST', '/home/sprintergo-platform')
PORT = os.environ.get('SG_PORT', '7030')
BASE = os.environ.get('SG_BASE', '/go/')
DOMAIN = os.environ.get('SG_DOMAIN', 'sprintergo.kg')
SERVICE = 'sprintergo-platform'
MARK_BEGIN = '    # >>> SG:platform-go begin'
MARK_END = '    # <<< SG:platform-go end'


DRY = os.environ.get('SG_DRY') == '1'


def run(*cmd, check=False):
    if DRY and cmd[0] in ('systemctl', 'nginx'):
        class Fake:
            returncode, stdout, stderr = 0, '', ''
        return Fake()
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if check and r.returncode != 0:
        sys.exit(f'не удалось выполнить {" ".join(cmd)}:\n{r.stderr or r.stdout}')
    return r


def backup(path):
    i, bak = 0, path + '.bak'
    while os.path.exists(bak):
        i += 1
        bak = f'{path}.bak{i}'
    shutil.copy2(path, bak)
    return bak


# ── 1. распаковка ───────────────────────────────────────────────────────────
if not os.path.isdir(os.path.join(DEST, 'server')):
    if not os.path.isfile(ZIP):
        sys.exit(f'не нашёл архив {ZIP}. Загрузите его в /home и запустите снова.')
    tmp = DEST + '.new'
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp, exist_ok=True)
    with zipfile.ZipFile(ZIP) as z:
        z.extractall(tmp)
    inner = os.path.join(tmp, 'sprintergo-platform')
    src = inner if os.path.isdir(inner) else tmp
    if os.path.isdir(DEST):
        shutil.rmtree(DEST + '.old', ignore_errors=True)
        os.rename(DEST, DEST + '.old')
    shutil.move(src, DEST)
    shutil.rmtree(tmp, ignore_errors=True)
    print(f'распаковано в {DEST}')
else:
    print(f'{DEST} уже на месте, распаковку пропускаем')

os.makedirs(os.path.join(DEST, 'data'), exist_ok=True)
for sh in glob.glob(os.path.join(DEST, 'scripts', '*.sh')):
    os.chmod(sh, 0o755)

# ── 2. служба systemd ───────────────────────────────────────────────────────
unit = f"""[Unit]
Description=Sprinter Go — платформа заказов
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={DEST}
Environment=PORT={PORT}
Environment=HOST=127.0.0.1
Environment=SG_BASE={BASE}
Environment=SG_DATA={DEST}/data
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/env python3 {DEST}/app.py
Restart=always
RestartSec=3
StandardOutput=append:{DEST}/data/service.log
StandardError=append:{DEST}/data/service.log
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
"""
unit_path = f'/etc/systemd/system/{SERVICE}.service'
io.open(unit_path, 'w', encoding='utf-8').write(unit)
run('systemctl', 'daemon-reload')
run('systemctl', 'enable', SERVICE)
run('systemctl', 'restart', SERVICE)
print(f'служба {SERVICE} запущена на 127.0.0.1:{PORT}')

# ждём, пока сервис поднимется
up = False
for _ in range(40):
    time.sleep(0.5)
    if run('curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
           f'http://127.0.0.1:{PORT}/api/v1/config').stdout.strip() == '200':
        up = True
        break
if not up:
    log = os.path.join(DEST, 'data', 'service.log')
    tail = ''
    if os.path.isfile(log):
        tail = io.open(log, encoding='utf-8', errors='replace').read()[-1500:]
    sys.exit('сервис не ответил на 127.0.0.1:' + PORT + '\n' + tail)
print('сервис отвечает')

# ── 3. блок в nginx ─────────────────────────────────────────────────────────
BLOCK = f"""{MARK_BEGIN}
    # Платформа заказов на {BASE} — лендинг на корне не затрагивается.
    # Префикс срезается завершающим слешем в proxy_pass, сервис внутри живёт в корне.
    location ^~ {BASE}api/v1/ {{
        proxy_pass http://127.0.0.1:{PORT}/api/v1/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        # Живые обновления заказа идут потоком: буферизацию выключаем,
        # иначе машина курьера на карте замирает до конца поездки.
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }}

    location ^~ {BASE} {{
        proxy_pass http://127.0.0.1:{PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_read_timeout 75s;
    }}

    location = {BASE.rstrip('/')} {{
        return 301 {BASE};
    }}
{MARK_END}"""

GLOBS = os.environ.get('SG_NGINX_GLOBS',
                       '/etc/nginx/sites-available/*:/etc/nginx/sites-enabled/*:/etc/nginx/conf.d/*.conf')
candidates = []
for pat in GLOBS.split(':'):
    for f in glob.glob(pat):
        f = os.path.realpath(f)
        if os.path.isfile(f) and not re.search(r'(\.bak\d*|~)$', f) and f not in candidates:
            candidates.append(f)

target = None
for f in candidates:
    text = io.open(f, encoding='utf-8', errors='replace').read()
    if DOMAIN in text and 'listen' in text:
        # берём файл, где домен объявлен в server_name
        if re.search(r'server_name[^;]*\b' + re.escape(DOMAIN) + r'\b', text):
            target = f
            break
if not target:
    sys.exit('не нашёл конфиг nginx с server_name ' + DOMAIN +
             '\nпросмотренные файлы: ' + ', '.join(candidates))

text = io.open(target, encoding='utf-8').read()
bak = backup(target)
print(f'правим {target} (копия: {bak})')

# убираем прежний блок, если запускаем повторно
text = re.sub(re.escape(MARK_BEGIN) + r'.*?' + re.escape(MARK_END) + r'\n?', '', text, flags=re.S)

# Разбираем файл на server-блоки и выбираем правильный: нужен тот, что слушает
# 443 и обслуживает сам домен. Блок на 80 порту обычно только редиректит на https —
# положить location туда значит не подключить ничего.
lines = text.split('\n')
blocks = []
depth = 0
start_i = None
for i, line in enumerate(lines):
    if depth == 0 and re.match(r'\s*server\s*\{', line):
        start_i = i
    depth += line.count('{') - line.count('}')
    if start_i is not None and depth == 0:
        blocks.append((start_i, i))
        start_i = None

def serves_domain(chunk):
    for m in re.finditer(r'server_name\s+([^;]+);', chunk):
        if DOMAIN in m.group(1).split():
            return True
    return False

target_block = None
for want_ssl in (True, False):
    for a, b in blocks:
        chunk = '\n'.join(lines[a:b + 1])
        if chunk.lstrip().startswith('#') or not serves_domain(chunk):
            continue
        is_ssl = 'listen 443' in chunk or 'ssl_certificate' in chunk
        redirect_only = 'return 301' in chunk and 'location' not in chunk
        if want_ssl and not is_ssl:
            continue
        if not want_ssl and redirect_only:
            continue
        target_block = (a, b)
        break
    if target_block:
        break

if not target_block:
    sys.exit('не нашёл server-блок для ' + DOMAIN + ' — покажите мне конфиг: '
             'grep -n "server_name\\|listen" ' + target)

a, b = target_block
# вставляем сразу после строки server_name внутри выбранного блока
at = a + 1
for i in range(a, b + 1):
    if re.search(r'server_name\s+[^;]*;', lines[i]):
        at = i + 1
        break
kind = 'HTTPS' if ('listen 443' in '\n'.join(lines[a:b + 1])
                   or 'ssl_certificate' in '\n'.join(lines[a:b + 1])) else 'HTTP'
print(f'блок {kind} для {DOMAIN}: строки {a + 1}-{b + 1}, вставляем после {at}')
out = lines[:at] + ['', BLOCK] + lines[at:]

io.open(target, 'w', encoding='utf-8').write('\n'.join(out))

check = run('nginx', '-t')
if check.returncode != 0:
    shutil.copy2(bak, target)
    sys.exit('nginx отверг конфиг, вернул как было:\n' + (check.stderr or check.stdout))
run('systemctl', 'reload', 'nginx', check=True)
print('nginx перезагружен')

# ── 4. проверка ─────────────────────────────────────────────────────────────
print('\nпроверяем снаружи:')
for url, what in ((f'https://{DOMAIN}/', 'лендинг на корне'),
                  (f'https://{DOMAIN}{BASE}', 'платформа'),
                  (f'https://{DOMAIN}{BASE}courier', 'приложение курьера'),
                  (f'https://{DOMAIN}{BASE}admin', 'панель управления'),
                  (f'https://{DOMAIN}{BASE}api/v1/config', 'API')):
    code = run('curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '20', url).stdout.strip()
    mark = 'ок' if code == '200' else 'ВНИМАНИЕ'
    print(f'  {mark:8} {code}  {what}  {url}')

print(f"""
Готово.

  Клиенты   https://{DOMAIN}{BASE}
  Курьеры   https://{DOMAIN}{BASE}courier
  Панель    https://{DOMAIN}{BASE}admin

Пароль администратора напечатан при первом запуске службы:
  grep -i пароль {DEST}/data/service.log
Потеряли — задайте новый:
  cd {DEST} && SG_DATA={DEST}/data python3 scripts/seed.py --email ваш@адрес.kg --password новый-пароль

Служба:  systemctl status {SERVICE} · journalctl -u {SERVICE} -f
Журнал:  {DEST}/data/service.log
""")
