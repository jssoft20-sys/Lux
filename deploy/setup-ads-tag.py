#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Подключение тега Google Ads к sprintergo.kg.

Вставляет gtag перед </head>, привязывает ярлык конверсии к заявкам (WhatsApp,
звонок, отправка расчёта), разрешает домены Google Ads в CSP и перезагружает nginx.
Запускать можно повторно: старый блок заменяется, дублей не будет.
"""
import glob, io, os, re, subprocess, sys

TAG   = os.environ.get('SG_ADS_TAG',   'AW-18448201336')
LABEL = os.environ.get('SG_ADS_LABEL', 'sD_3CPDWivYcEPjs5NxE')
ROOT  = os.environ.get('SG_ROOT',      '/home/gotaxi')
NGINX = os.environ.get('SG_NGINX_GLOBS',
                       '/etc/nginx/sites-available/*:/etc/nginx/conf.d/*.conf:' + ROOT + '/deploy/*.conf')
RELOAD = os.environ.get('SG_RELOAD', '1') == '1'

BEGIN, END = '<!-- SG:google-ads begin -->', '<!-- SG:google-ads end -->'

BLOCK = f"""{BEGIN}
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id={TAG}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', '{TAG}');
  /* Ярлык конверсии привязан к заявкам, а не к открытию страницы: событие уходит
     при клике по WhatsApp, по номеру телефона и при отправке расчёта из калькулятора. */
  window.SG_TRACK = {{ ads: {{
    whatsapp: '{TAG}/{LABEL}',
    call:     '{TAG}/{LABEL}',
    form:     '{TAG}/{LABEL}'
  }}, ym: 0 }};
</script>
{END}"""

CSP = (
    "default-src 'self'; base-uri 'self'; object-src 'none'; "
    "img-src 'self' data: https://mc.yandex.ru https://www.google-analytics.com "
    "https://www.googletagmanager.com https://googleads.g.doubleclick.net "
    "https://td.doubleclick.net https://stats.g.doubleclick.net https://www.google.com "
    "https://www.google.kg https://www.googleadservices.com; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self' 'unsafe-inline' https://mc.yandex.ru https://www.googletagmanager.com "
    "https://www.google-analytics.com https://www.googleadservices.com "
    "https://googleads.g.doubleclick.net https://td.doubleclick.net; "
    "font-src 'self'; "
    "connect-src 'self' https://mc.yandex.ru https://www.google-analytics.com "
    "https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com "
    "https://googleads.g.doubleclick.net https://td.doubleclick.net https://www.google.com "
    "https://pagead2.googlesyndication.com; "
    "frame-src https://td.doubleclick.net https://bid.g.doubleclick.net https://www.googletagmanager.com; "
    "frame-ancestors 'self'"
)

def stamp(path):
    """Резервная копия рядом с файлом, без затирания предыдущей."""
    i, bak = 0, path + '.bak'
    while os.path.exists(bak):
        i += 1; bak = f'{path}.bak{i}'
    io.open(bak, 'w', encoding='utf-8').write(io.open(path, encoding='utf-8', errors='ignore').read())
    return bak

# ── 1. index.html ────────────────────────────────────────────────────────────
page = os.path.join(ROOT, 'index.html')
if not os.path.isfile(page):
    sys.exit(f'не найден {page} — укажите папку сайта: SG_ROOT=/путь python3 ...')

html = io.open(page, encoding='utf-8').read()
if '</head>' not in html:
    sys.exit('в index.html нет закрывающего </head>')

print('резервная копия:', stamp(page))
had = BEGIN in html
html = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END) + r'\n?', '', html, flags=re.S)
html = html.replace('</head>', BLOCK + '\n</head>', 1)
io.open(page, 'w', encoding='utf-8').write(html)
print(f'index.html: тег {TAG} {"обновлён" if had else "вставлен"} перед </head>')

# ── 2. CSP: без этого браузер молча заблокирует запросы Google Ads ────────────
found = 0
rx = re.compile(r'(add_header\s+Content-Security-Policy\s+")([^"]*)(")')
for pattern in NGINX.split(':'):
    for conf in sorted(glob.glob(pattern)):
        if not os.path.isfile(conf) or re.search(r'(\.bak\d*|\.orig|~)$', conf):
            continue      # не трогаем собственные резервные копии
        text = io.open(conf, encoding='utf-8', errors='ignore').read()
        if 'Content-Security-Policy' not in text:
            continue
        new = rx.sub(lambda m: m.group(1) + CSP + m.group(3), text)
        if new == text:
            print('CSP уже актуален:', conf); found += 1; continue
        stamp(conf)
        io.open(conf, 'w', encoding='utf-8').write(new)
        print('CSP обновлён:', conf); found += 1
if not found:
    print('! CSP в конфигах nginx не найден — если он задан где-то ещё, добавьте домены '
          'googleadservices.com и googleads.g.doubleclick.net вручную')

# ── 3. Перезагрузка ──────────────────────────────────────────────────────────
def run(*cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as e:
        print('  не удалось выполнить', ' '.join(cmd), '—', e); return None

if RELOAD and found:
    t = run('nginx', '-t')
    if t is None:
        pass
    elif t.returncode == 0:
        r = run('systemctl', 'reload', 'nginx')
        print('nginx перезагружен' if r and r.returncode == 0 else 'nginx -t прошёл, перезагрузите вручную')
    else:
        print('! nginx -t не прошёл, конфиг НЕ применён:\n' + (t.stderr or t.stdout))
        print('  верните из .bak и напишите мне вывод выше')

print('\nГотово. Проверка: откройте https://sprintergo.kg/ и посмотрите исходный код —')
print(f'должен быть виден {TAG}. В Google Ads: Цели → Конверсии → «Проверить» появится')
print('через несколько часов после первого реального клика по WhatsApp.')
