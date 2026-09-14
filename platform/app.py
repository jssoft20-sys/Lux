#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Точка входа Sprinter Go: собирает сервис и держит его на ногах.

Здесь нет ни одной строчки бизнес-логики — только сборка. Открыть базу,
разложить по местам маршруты и страницы, поднять фоновые потоки, а когда
придёт SIGTERM — погасить всё в правильном порядке. Остальное живёт в server/.

Запуск:
    python3 app.py               обычный запуск, порт 7030
    PORT=8080 python3 app.py     другой порт
    python3 app.py --dev         разработка: статика не кэшируется

Где что лежит:
    SG_DATA   папка с данными и логами (по умолчанию ./data)
    SG_DB     файл базы (по умолчанию <SG_DATA>/sprintergo.sqlite3)
    PORT      порт, HOST — адрес прослушивания
"""
import argparse
import os
import secrets
import signal
import sys
import threading
import time
import traceback

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from server import auth, db, dispatch, mailer, settings          # noqa: E402
from server.core import HUB, App, log, serve                     # noqa: E402
from server.routers import admin as admin_routes                 # noqa: E402
from server.routers import auth as auth_routes                   # noqa: E402
from server.routers import courier as courier_routes             # noqa: E402
from server.routers import public as public_routes               # noqa: E402

DEFAULT_HOST = '0.0.0.0'
DEFAULT_PORT = 7030

# Уборка в базе: протухшие сессии, старый след курьеров, забытые предложения.
CLEANUP_EVERY_S = 3600

# Почта первого администратора. Меняется переменной SG_ADMIN_EMAIL,
# а потом — в самой панели, в разделе людей.
FIRST_ADMIN_EMAIL = 'admin@sprintergo.kg'

# Буквы и цифры, которые не путаются при переписывании с экрана:
# без нуля с буквой «o», без единицы с «l» и без заглавной «I».
PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

# Страницы приложений. Ключ — адрес в браузере, значение — файл в web/.
PAGES = {
    '/': 'index.html',
    '/courier': 'courier.html',
    '/admin': 'admin.html',
}

# Политика безопасности содержимого. Плитки карты админ может поменять на любой
# сервис, поэтому картинки разрешены с любого https; всё остальное — только своё.
# Встроенные <script> в courier.html и admin.html снимают мигание темы до первой
# отрисовки, из-за них в script-src приходится держать 'unsafe-inline'.
CSP = ("default-src 'self'; "
       "base-uri 'self'; "
       "object-src 'none'; "
       "frame-ancestors 'self'; "
       "form-action 'self'; "
       "img-src 'self' data: blob: https:; "
       "font-src 'self'; "
       "style-src 'self' 'unsafe-inline'; "
       "script-src 'self' 'unsafe-inline'; "
       "connect-src 'self'; "
       "worker-src 'self'; "
       "manifest-src 'self'")


# ─────────────────────────────────────────────────────────────── пути

def data_dir():
    return os.path.abspath(os.environ.get('SG_DATA') or os.path.join(ROOT, 'data'))


def db_path():
    return os.path.abspath(os.environ.get('SG_DB')
                           or os.path.join(data_dir(), 'sprintergo.sqlite3'))


def web_dir():
    return os.path.abspath(os.environ.get('SG_WEB') or os.path.join(ROOT, 'web'))


# ─────────────────────────────────────────────────────────────── сборка приложения

def mount_routes(app):
    """Подключаем четыре набора маршрутов.

    Точка входа у модулей называется по-разному, и угадывать её через getattr
    нельзя: в routers/auth.py есть обработчик регистрации курьера с именем
    register, и такая «догадка» подключила бы вместо маршрутов его.
    """
    public_routes.register(app)
    auth_routes.mount(app)
    courier_routes.mount(app)
    admin_routes.register(app)
    return len(app.router.routes)


def build_app(dev=False):
    """Готовое приложение: маршруты API, страницы, статика и заголовки."""
    app = App(web_dir(), dev=dev)
    app.csp = CSP
    routes = mount_routes(app)
    for url, file in PAGES.items():
        full = os.path.join(app.static.root, file)
        app.page(url, full)
        if url != '/':
            app.page(url + '/', full)      # человек допишет слэш — пусть работает
    return app, routes


# ─────────────────────────────────────────────────────────────── первый администратор

def make_password(groups=3, size=4):
    """Пароль, который не стыдно продиктовать по телефону: три группы по четыре
    символа через дефис. 32 символа алфавита × 12 знаков — это больше 10^18
    вариантов, перебирать такое через форму входа бессмысленно."""
    parts = [''.join(secrets.choice(PASSWORD_ALPHABET) for _ in range(size))
             for _ in range(groups)]
    return '-'.join(parts)


def ensure_admin(port):
    """Первый запуск: администраторов нет — заводим одного и печатаем пароль.

    Печатаем крупно и один раз: человек только что запустил сервис и не должен
    искать в интернете, как теперь войти. Второй раз пароль взять неоткуда —
    в базе от него остаётся только scrypt-хеш.
    """
    if db.value("SELECT COUNT(*) FROM users WHERE role='admin'", (), 0):
        return None

    email = (os.environ.get('SG_ADMIN_EMAIL') or FIRST_ADMIN_EMAIL).strip().lower()
    password = os.environ.get('SG_ADMIN_PASSWORD') or make_password()
    db.insert('users', {
        'role': 'admin', 'email': email, 'name': 'Администратор',
        'password_hash': auth.hash_password(password),
        'status': 'active', 'lang': 'ru', 'created_at': db.now(),
    })

    line = '─' * 52
    out = [
        '',
        '  ┌' + line + '┐',
        '  │  Панель управления готова. Вот вход в неё:' + ' ' * 9 + '│',
        '  └' + line + '┘',
        '',
        '        Адрес    http://localhost:%d/admin' % port,
        '        Почта    %s' % email,
        '        Пароль   %s' % password,
        '',
        '  Запишите строку выше сейчас: показывается она один раз.',
        '  Потеряли — новый ставится через scripts/seed.py, как именно — в README.',
        '',
    ]
    sys.stdout.write('\n'.join(out) + '\n')
    sys.stdout.flush()
    return email, password


# ─────────────────────────────────────────────────────────────── фоновые потоки

def cleanup_loop(stop_event):
    """Уборка раз в час. Ошибка в уборке не должна ронять сервис: чистка мусора —
    дело важное, но не настолько, чтобы из-за неё переставали ездить машины."""
    log('уборка базы: раз в', CLEANUP_EVERY_S // 60, 'минут')
    while not stop_event.is_set():
        if stop_event.wait(CLEANUP_EVERY_S):
            break
        try:
            db.cleanup()
            # WAL после суток работы разрастается, и файл базы перестаёт
            # помещаться в резервную копию по расписанию. Подрезаем его здесь.
            db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        except Exception:
            log('уборка базы споткнулась\n' + traceback.format_exc())
    log('уборка базы остановлена')


def start_background():
    """Диспетчер, очередь почты и уборка. Возвращает (событие остановки, потоки)."""
    stop_event = threading.Event()
    threads = []

    dispatch_thread, _ = dispatch.start(stop_event)
    threads.append(dispatch_thread)

    mailer.start()
    if mailer.enabled():
        log('почта: очередь запущена, отправка через', settings.get('smtp.host') or '—')
    else:
        log('почта: выключена в настройках — письма копятся не будут, заказы это не ломает')

    cleaner = threading.Thread(target=cleanup_loop, args=(stop_event,),
                               name='cleanup', daemon=True)
    cleaner.start()
    threads.append(cleaner)
    return stop_event, threads


def close_streams():
    """Гасим все открытые SSE-соединения. Без этого потоки-обработчики висят на
    ожидании события и сервис уходит в перезапуск дольше, чем нужно.

    Отписываем под замком хаба, а будим уже без него: stop() берёт свой замок,
    и держать два одновременно — верный способ однажды встать намертво."""
    with HUB.lock:
        subs = {s for bucket in HUB.subs.values() for s in bucket}
        HUB.subs.clear()
    for s in subs:
        s.stop()
    return len(subs)


# ─────────────────────────────────────────────────────────────── запуск и остановка

def parse_args(argv=None):
    p = argparse.ArgumentParser(
        prog='app.py', description='Сервис грузоперевозок Sprinter Go',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='Обычный запуск: python3 app.py\n'
               'Разработка:     python3 app.py --dev')
    p.add_argument('--host', default=os.environ.get('HOST') or DEFAULT_HOST,
                   help='адрес прослушивания, по умолчанию %s' % DEFAULT_HOST)
    p.add_argument('--port', type=int, default=int(os.environ.get('PORT') or DEFAULT_PORT),
                   help='порт, по умолчанию %d' % DEFAULT_PORT)
    p.add_argument('--dev', action='store_true',
                   help='режим разработки: статика отдаётся без кэша')
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    started = time.monotonic()

    path = db_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    db.init(path)
    settings.seed_catalog()
    try:
        db.cleanup()          # после аварийной остановки в базе остаётся мусор
    except Exception:
        log('первичная уборка базы не удалась\n' + traceback.format_exc())

    app, routes = build_app(dev=args.dev)
    ensure_admin(args.port)

    try:
        srv = serve(app, args.host, args.port)
    except OSError as e:
        sys.stderr.write(
            '\nНе получилось занять порт %d: %s\n'
            'Скорее всего сервис уже запущен. Проверьте: scripts/status.sh\n\n'
            % (args.port, e))
        return 1

    stop_event, threads = start_background()

    shutdown = threading.Event()

    def on_signal(signum, _frame):
        # В обработчике сигнала делаем ровно одно движение — поднимаем флаг.
        # Всё остальное разбирает главный поток: писать в лог и в базу
        # из обработчика опасно, можно поймать блокировку на полуслове.
        shutdown.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    web = srv.socket.getsockname()
    log('Sprinter Go поднялся за %.2f с' % (time.monotonic() - started))
    log('слушаем %s:%s · маршрутов %d · база %s' % (web[0], web[1], routes, path))
    log('клиент http://localhost:%d/ · курьер /courier · панель /admin' % args.port)
    if args.dev:
        log('режим разработки: статика отдаётся без кэша, правки видны сразу')

    loop = threading.Thread(target=srv.serve_forever, kwargs={'poll_interval': 0.5},
                            name='http', daemon=True)
    loop.start()

    try:
        while not shutdown.is_set():
            shutdown.wait(1.0)
    except KeyboardInterrupt:
        pass

    log('останавливаемся, доделываем начатое')
    closed = close_streams()
    if closed:
        log('закрыто живых подключений:', closed)
    srv.shutdown()
    srv.server_close()
    loop.join(timeout=5)

    stop_event.set()
    for th in threads:
        th.join(timeout=5)
    mailer.stop(timeout=5)

    log('Sprinter Go остановлен')
    return 0


if __name__ == '__main__':
    sys.exit(main())
