"""Проверка архива перед отправкой. Ловит ровно то, что положило сайт:
пустой index.html, потерянный <script>, рассинхрон версий."""
import io, os, re, sys

root = sys.argv[1] if len(sys.argv) > 1 else '.'
app = os.path.join(root, 'static', 'app')
bad = []

# 1. Ни одного файла нулевого размера — но только в том, что реально
# едет в архиве. venv (py.typed, tests/__init__.py), storage, uploads,
# данные и бэкапы app.bak.* содержат легитимно пустые файлы — их не трогаем.
SKIP_DIRS = ('__pycache__', '.git', 'venv', 'node_modules', 'storage',
             'uploads', 'data', '.bak')
CHECK_ROOTS = [os.path.join(root, 'static', 'app'), os.path.join(root, 'tools')]
for croot in CHECK_ROOTS:
    for base, _dirs, files in os.walk(croot):
        if any(p in base for p in SKIP_DIRS):
            continue
        for f in files:
            full = os.path.join(base, f)
            if os.path.getsize(full) == 0:
                bad.append(f'ПУСТОЙ ФАЙЛ: {os.path.relpath(full, root)}')
sp = os.path.join(root, 'server.py')
if os.path.exists(sp) and os.path.getsize(sp) == 0:
    bad.append('ПУСТОЙ ФАЙЛ: server.py')

# 2. index.html жив и содержит корень
idx_path = os.path.join(app, 'index.html')
if not os.path.exists(idx_path):
    bad.append('НЕТ index.html')
else:
    idx = io.open(idx_path, encoding='utf-8').read()
    if len(idx) < 400:
        bad.append(f'index.html подозрительно мал: {len(idx)} байт')
    if 'id="root"' not in idx:
        bad.append('index.html: нет <div id="root">')

    # 3. Каждый подключённый скрипт существует и не пуст
    srcs = re.findall(r'src="/static/app/([^"?]+)', idx)
    for name in srcs:
        f = os.path.join(app, name)
        if not os.path.exists(f):
            bad.append(f'index.html ссылается на {name}, а файла нет')
        elif os.path.getsize(f) == 0:
            bad.append(f'{name} пустой')
    for must in ('app.js', 'pages.js', 'social.js', 'social2.js', 'calls.js', 'main.js'):
        if must not in srcs:
            bad.append(f'index.html не подключает {must}')

    # 4. Версии совпадают: index.html, app.js, server.py
    vers = set(re.findall(r'\?v=([0-9.]+)', idx))
    js = io.open(os.path.join(app, 'app.js'), encoding='utf-8').read()
    m = re.search(r"APP_VERSION='([0-9.]+)'", js)
    appv = m.group(1) if m else '?'
    sv = io.open(os.path.join(root, 'server.py'), encoding='utf-8').read()
    # В server.py исторически два присваивания _LUX_WEB_VERSION.
    # При импорте выигрывает последнее — его и сверяем.
    all2 = re.findall(r'_LUX_WEB_VERSION = "([0-9.]+)"', sv)
    srvv = all2[-1] if all2 else '?'
    if len(vers) != 1:
        bad.append(f'в index.html разные версии: {sorted(vers)}')
    elif appv not in vers or srvv not in vers:
        bad.append(f'версии не совпали: index={sorted(vers)} app.js={appv} server={srvv}')

    # 5. CSS не обрезан
    css = os.path.join(app, 'styles.css')
    if os.path.exists(css):
        t = io.open(css, encoding='utf-8').read()
        if t.count('{') != t.count('}'):
            bad.append(f'styles.css: скобки не сходятся ({t.count("{")} / {t.count("}")})')

if bad:
    print('АРХИВ НЕ ГОДЕН:')
    for b in bad:
        print('  ' + b)
    sys.exit(1)
print(f'сборка в порядке — версия {appv}, скриптов {len(srcs)}, пустых файлов нет')
