#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sprinter Go — статический HTTP-сервер на стандартной библиотеке Python (3.8+).

Зачем: быстро поднять сайт на любом Linux-сервере без установки nginx/node —
достаточно python3. Подходит и для проверки по IP:7022, и как upstream за nginx.

Запуск:
    python3 server.py                      # порт из $PORT или 7022, папка = папка скрипта
    python3 server.py --port 7022 --host 0.0.0.0 --root /home/gotaxi

Что умеет:
  * многопоточная отдача (ThreadingHTTPServer, keep-alive HTTP/1.1);
  * правильные MIME-типы (html, css, js, mjs, svg, png, jpg, webp, ico, woff2, woff,
    webmanifest, xml, txt, json …);
  * "/" -> index.html; "/index.html" -> 301 на "/"; любой другой URL без расширения -> 404;
  * gzip для текстовых типов (если клиент прислал Accept-Encoding: gzip и файл > 1 КБ);
  * Cache-Control по типам: html — no-cache; шрифты/картинки/css/js — год + immutable (css/js версионируются ?v=хэш);
  * ETag (mtime+size) + If-None-Match и Last-Modified + If-Modified-Since -> 304;
  * security-заголовки (nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP);
  * защита от path traversal (realpath внутри корня), запрет служебных файлов
    (server.py, *.sh, deploy/, README.md, .git, *.log, *.pid, скрытые файлы);
  * красивая 404-страница (берётся /404.html из корня сайта, иначе встроенная);
  * HEAD-запросы, логи в stdout, корректная остановка по SIGTERM/SIGINT.

Зависимостей нет. Лицензия: используйте свободно в рамках проекта Sprinter Go.
"""

import argparse
import email.utils
import gzip
import os
import posixpath
import shutil
import signal
import socket
import sys
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

__version__ = "1.0.0"

DEFAULT_PORT = 7022

# ---------------------------------------------------------------------------
# MIME-типы. Для текстовых форматов явно указываем charset=utf-8.
# ---------------------------------------------------------------------------
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".map": "application/json; charset=utf-8",
}

# Типы, которые имеет смысл сжимать gzip'ом (картинки и woff2 уже сжаты).
COMPRESSIBLE_PREFIXES = ("text/",)
COMPRESSIBLE_TYPES = (
    "image/svg+xml",
    "application/json",
    "application/manifest+json",
    "application/xml",
    "text/javascript",
)
GZIP_MIN_SIZE = 1024  # байт; меньше — не сжимаем, выигрыша нет
GZIP_LEVEL = 6
GZIP_CACHE_LIMIT = 32 * 1024 * 1024  # держим в памяти не больше 32 МБ сжатых копий

# Расширения, которые кэшируются "навсегда" (год + immutable).
IMMUTABLE_EXT = {
    ".css", ".js", ".mjs",
    ".woff2", ".woff", ".ttf", ".otf",
    ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico", ".svg",
    ".mp4", ".webm", ".mp3",
}
DAY_EXT = {".map"}

# Служебные файлы, которые никогда не отдаём наружу.
FORBIDDEN_BASENAMES = {
    "readme.md", "dockerfile", "docker-compose.yml", "docker-compose.yaml",
    "nginx.conf", "makefile",
}
FORBIDDEN_EXT = {".py", ".pyc", ".sh", ".log", ".pid", ".md", ".bak", ".env", ".ini", ".service"}
FORBIDDEN_TOP_DIRS = {"deploy", "__pycache__", "node_modules"}

# ---------------------------------------------------------------------------
# Security-заголовки.
# ВНИМАНИЕ: сайт использует inline <script> (JSON-LD) и inline-стили,
# поэтому 'unsafe-inline' в script-src / style-src обязателен.
# Домены Яндекс.Метрики и Google Analytics/Tag Manager разрешены заранее —
# счётчики можно вставить без правки сервера.
# ---------------------------------------------------------------------------
CSP = (
    "default-src 'self'; base-uri 'self'; object-src 'none'; img-src 'self' data: https://mc.yandex.ru https://www.google-analytics.com https://www.googletagmanager.com https://googleads.g.doubleclick.net https://td.doubleclick.net https://stats.g.doubleclick.net https://www.google.com https://www.google.kg https://www.googleadservices.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://mc.yandex.ru https://www.googletagmanager.com https://www.google-analytics.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://td.doubleclick.net; font-src 'self'; connect-src 'self' https://mc.yandex.ru https://www.google-analytics.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://googleads.g.doubleclick.net https://td.doubleclick.net https://www.google.com https://pagead2.googlesyndication.com; frame-src https://td.doubleclick.net https://bid.g.doubleclick.net https://www.googletagmanager.com; frame-ancestors 'self'"
)

SECURITY_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "SAMEORIGIN"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"),
    ("Content-Security-Policy", CSP),
)

# ---------------------------------------------------------------------------
# Встроенная 404-страница (используется, если в корне сайта нет 404.html).
# ---------------------------------------------------------------------------
INLINE_404 = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Страница не найдена — Sprinter Go</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{min-height:100%}
  body{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
       background:#0B0B0D;color:#fff;display:flex;align-items:center;justify-content:center;
       padding:32px 20px;text-align:center;line-height:1.5}
  .box{max-width:560px;width:100%}
  .code{font-size:clamp(84px,20vw,160px);font-weight:900;line-height:1;color:#FFDF00;letter-spacing:-.04em}
  h1{font-size:clamp(22px,4vw,32px);font-weight:800;margin:12px 0 10px}
  p{color:#B8B8C0;font-size:17px;margin-bottom:28px}
  .btn{display:inline-block;background:#FFDF00;color:#0B0B0D;text-decoration:none;font-weight:800;
       padding:16px 30px;border-radius:999px;font-size:17px;min-height:48px}
  .btn:hover{background:#FFE95A}
  .tel{display:block;margin-top:26px;color:#fff;text-decoration:none;font-weight:700;font-size:20px}
  .tel span{display:block;color:#8A8A93;font-weight:400;font-size:14px;margin-bottom:4px}
</style>
</head>
<body>
  <div class="box">
    <div class="code">404</div>
    <h1>Такой страницы нет</h1>
    <p>Возможно, ссылка устарела или в адресе опечатка. Всё, что нужно, — на главной:
       грузоперевозки, переезды и грузчики в Бишкеке.</p>
    <a class="btn" href="/">На главную</a>
    <a class="tel" href="tel:+996755555357"><span>Заказать по телефону</span>0755 555 357</a>
  </div>
</body>
</html>
"""

INLINE_ERROR = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{code} — Sprinter Go</title>
<style>body{{font-family:system-ui,Arial,sans-serif;background:#0B0B0D;color:#fff;display:flex;align-items:center;
justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}}
b{{display:block;font-size:72px;color:#FFDF00}}a{{color:#FFDF00}}</style></head>
<body><div><b>{code}</b><p>{text}</p><p><a href="/">На главную</a></p></div></body></html>
"""

ERROR_TEXT_RU = {
    400: "Некорректный запрос.",
    403: "Доступ запрещён.",
    404: "Страница не найдена.",
    405: "Метод не поддерживается.",
    414: "Слишком длинный адрес.",
    500: "Внутренняя ошибка сервера.",
    501: "Метод не реализован.",
    505: "Неподдерживаемая версия HTTP.",
}


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------
def content_type_for(path):
    ext = os.path.splitext(path)[1].lower()
    return MIME_TYPES.get(ext, "application/octet-stream")


def is_compressible(ctype):
    base = ctype.split(";", 1)[0].strip()
    return base.startswith(COMPRESSIBLE_PREFIXES) or base in COMPRESSIBLE_TYPES


def cache_control_for(url_path, ctype):
    """Политика кэширования по типу файла."""
    ext = os.path.splitext(url_path)[1].lower()
    if ctype.startswith("text/html"):
        return "no-cache"
    if ext in IMMUTABLE_EXT or url_path.startswith("/assets/fonts/") or url_path.startswith("/assets/img/"):
        return "public, max-age=31536000, immutable"
    if ext in DAY_EXT:
        return "public, max-age=86400"
    # robots.txt, sitemap.xml, manifest и прочее — час
    return "public, max-age=3600"


def is_forbidden(parts):
    """parts — список сегментов пути внутри корня сайта."""
    if not parts:
        return False
    for seg in parts:
        if seg.startswith("."):          # .git, .server.pid, .env, .htaccess …
            return True
    if parts[0].lower() in FORBIDDEN_TOP_DIRS:
        return True
    name = parts[-1]
    ext = os.path.splitext(name)[1].lower()
    if ext in FORBIDDEN_EXT or name.lower() in FORBIDDEN_BASENAMES:
        return True
    return False


def etag_matches(header_value, *etags):
    """Сравнение If-None-Match с нашими ETag (учитывает слабые W/ и '*')."""
    if not header_value:
        return False
    for token in header_value.split(","):
        token = token.strip()
        if token == "*":
            return True
        if token.startswith("W/"):
            token = token[2:]
        if token in etags:
            return True
    return False


class GzipCache:
    """Небольшой in-memory кэш сжатых копий, чтобы не жать один файл на каждый запрос."""

    def __init__(self, limit):
        self.limit = limit
        self.size = 0
        self.items = {}
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            return self.items.get(key)

    def put(self, key, data):
        with self.lock:
            if self.size + len(data) > self.limit:
                self.items.clear()
                self.size = 0
            self.items[key] = data
            self.size += len(data)


# ---------------------------------------------------------------------------
# Обработчик запросов
# ---------------------------------------------------------------------------
class StaticHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "SprinterGo/" + __version__
    sys_version = ""
    timeout = 15  # секунд простоя keep-alive соединения

    # заполняется в main()
    root = os.path.dirname(os.path.abspath(__file__))
    gz_cache = GzipCache(GZIP_CACHE_LIMIT)
    active = 0
    active_lock = threading.Lock()

    # --- служебное -------------------------------------------------------
    def version_string(self):
        return self.server_version

    def client_ip(self):
        xff = self.headers.get("X-Forwarded-For") if self.headers else None
        if xff:
            return xff.split(",")[0].strip()
        return self.client_address[0]

    def log_request(self, code="-", size="-"):
        # Базовый класс логирует на каждый send_response — нам это не нужно,
        # пишем одну строку в конце обработки (см. _log).
        pass

    def log_error(self, fmt, *args):
        msg = fmt % args
        if "timed out" in msg:  # истёк keep-alive — не ошибка
            return
        sys.stderr.write("%s - [%s] ERROR %s\n" % (self.client_ip(), self.log_date_time_string(), msg))
        sys.stderr.flush()

    def log_message(self, fmt, *args):
        sys.stdout.write("%s - [%s] %s\n" % (self.client_ip(), self.log_date_time_string(), fmt % args))
        sys.stdout.flush()

    def log_date_time_string(self):
        return time.strftime("%d/%b/%Y:%H:%M:%S %z")

    def _log(self, code, size):
        elapsed_ms = int((time.monotonic() - getattr(self, "_t0", time.monotonic())) * 1000)
        method = self.command or "-"
        path = self.path or "-"
        self.log_message('"%s %s" %d %s %dms', method, path, int(code), size, elapsed_ms)

    def _send_common_headers(self):
        for name, value in SECURITY_HEADERS:
            self.send_header(name, value)

    def _write(self, data):
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    # --- ошибки -----------------------------------------------------------
    def send_error(self, code, message=None, explain=None):
        """Переопределяем стандартную страницу ошибок (в т.ч. для 400/414/501 от парсера)."""
        head = self.command == "HEAD"
        self._error(int(code), head=head, log=True)

    def _error_body(self, code):
        if code == 404:
            for candidate in ("404.html", os.path.join("deploy", "404.html")):
                p = os.path.join(self.root, candidate)
                try:
                    with open(p, "rb") as f:
                        return f.read()
                except OSError:
                    continue
            return INLINE_404.encode("utf-8")
        text = ERROR_TEXT_RU.get(code, "Ошибка.")
        return INLINE_ERROR.format(code=code, text=text).encode("utf-8")

    def _error(self, code, head=False, log=True):
        body = self._error_body(code)
        try:
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            if code == 405:
                self.send_header("Allow", "GET, HEAD")
            self._send_common_headers()
            if code in (400, 414, 505):
                self.close_connection = True
                self.send_header("Connection", "close")
            self.end_headers()
            if not head and code >= 200 and code not in (204, 304):
                self._write(body)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        if log:
            self._log(code, len(body) if not head else 0)

    # --- методы -----------------------------------------------------------
    def do_GET(self):
        self._serve(head=False)

    def do_HEAD(self):
        self._serve(head=True)

    def _method_not_allowed(self):
        self._t0 = time.monotonic()
        self._error(405)

    do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = _method_not_allowed

    # --- основной обработчик ---------------------------------------------
    def _serve(self, head):
        self._t0 = time.monotonic()
        with self.active_lock:
            StaticHandler.active += 1
        try:
            self._serve_inner(head)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as exc:  # noqa: BLE001 — не роняем поток из-за одного запроса
            self.log_error("unhandled: %r", exc)
            try:
                self._error(500, head=head)
            except Exception:  # noqa: BLE001
                pass
        finally:
            with self.active_lock:
                StaticHandler.active -= 1

    def _serve_inner(self, head):
        raw = self.path or "/"
        # Отрезаем query и fragment
        url_path = raw.split("?", 1)[0].split("#", 1)[0]

        if len(url_path) > 2048:
            return self._error(414, head)
        try:
            url_path = urllib.parse.unquote(url_path, errors="strict")
        except UnicodeDecodeError:
            return self._error(400, head)
        if "\x00" in url_path or not url_path.startswith("/") or url_path.startswith("//"):
            return self._error(400, head)

        segments = url_path.split("/")
        if any(seg in ("..",) for seg in segments):
            # Явная попытка выйти из корня — 400, без попытки "нормализовать".
            return self._error(400, head)

        # /index.html -> / (канонический адрес)
        if url_path == "/index.html":
            return self._redirect("/", head)

        # Корень -> index.html
        if url_path == "/":
            return self._send_file(os.path.join(self.root, "index.html"), "/index.html", head, is_index=True)

        # Каталоги и "чистые" URL без расширения — 404 (одностраничник)
        if url_path.endswith("/"):
            return self._error(404, head)

        norm = posixpath.normpath(url_path)
        parts = [p for p in norm.split("/") if p and p != "."]
        if not parts or is_forbidden(parts):
            return self._error(404, head)

        if not os.path.splitext(parts[-1])[1]:
            return self._error(404, head)

        fs_path = os.path.join(self.root, *parts)
        real = os.path.realpath(fs_path)
        # Защита от traversal и симлинков наружу: файл обязан лежать внутри root
        if real != self.root and not real.startswith(self.root + os.sep):
            return self._error(404, head)
        if not os.path.isfile(real):
            return self._error(404, head)

        return self._send_file(real, "/" + "/".join(parts), head)

    def _redirect(self, location, head):
        self.send_response(HTTPStatus.MOVED_PERMANENTLY)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-cache")
        self._send_common_headers()
        self.end_headers()
        self._log(301, 0)

    def _send_file(self, real, url_path, head, is_index=False):
        try:
            st = os.stat(real)
        except OSError:
            return self._error(404, head)
        if not os.path.isfile(real):
            return self._error(404, head)

        ctype = content_type_for(real)
        size = st.st_size
        mtime = st.st_mtime
        compressible = is_compressible(ctype)

        accept_enc = self.headers.get("Accept-Encoding", "")
        use_gzip = (
            compressible
            and size > GZIP_MIN_SIZE
            and "gzip" in [t.split(";")[0].strip().lower() for t in accept_enc.split(",")]
        )

        etag_plain = '"%x-%x"' % (int(mtime), size)
        etag = etag_plain[:-1] + '-gz"' if use_gzip else etag_plain
        last_modified = email.utils.formatdate(mtime, usegmt=True)
        cache_control = cache_control_for(url_path, ctype)

        # --- условные запросы -> 304 ---
        inm = self.headers.get("If-None-Match")
        not_modified = False
        if inm:
            not_modified = etag_matches(inm, etag, etag_plain)
        else:
            ims = self.headers.get("If-Modified-Since")
            if ims:
                try:
                    ims_ts = email.utils.parsedate_to_datetime(ims).timestamp()
                    not_modified = int(mtime) <= int(ims_ts)
                except (TypeError, ValueError, OverflowError):
                    not_modified = False

        if not_modified:
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache_control)
            if compressible:
                self.send_header("Vary", "Accept-Encoding")
            self._send_common_headers()
            self.end_headers()
            self._log(304, 0)
            return

        # --- тело ---
        body = None
        if use_gzip:
            key = (real, int(mtime), size)
            body = self.gz_cache.get(key)
            if body is None:
                with open(real, "rb") as f:
                    body = gzip.compress(f.read(), compresslevel=GZIP_LEVEL)
                self.gz_cache.put(key, body)
            length = len(body)
        else:
            length = size

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Last-Modified", last_modified)
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache_control)
        if compressible:
            self.send_header("Vary", "Accept-Encoding")
        if use_gzip:
            self.send_header("Content-Encoding", "gzip")
        self._send_common_headers()
        self.end_headers()

        if head:
            self._log(200, 0)
            return

        if body is not None:
            self._write(body)
        else:
            try:
                with open(real, "rb") as f:
                    shutil.copyfileobj(f, self.wfile, 64 * 1024)
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
        self._log(200, length)


# ---------------------------------------------------------------------------
# Запуск
# ---------------------------------------------------------------------------
def detect_lan_ip():
    """IP сервера в локальной сети/на интерфейсе (UDP-сокет ничего не отправляет)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return None


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="Sprinter Go — статический сервер (stdlib, без зависимостей).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    env_port = os.environ.get("PORT", "").strip()
    default_port = int(env_port) if env_port.isdigit() else DEFAULT_PORT
    p.add_argument("--port", type=int, default=default_port, help="порт (или переменная окружения PORT)")
    p.add_argument("--host", default="0.0.0.0", help="адрес прослушивания; 127.0.0.1 — только за nginx")
    p.add_argument("--root", default=os.path.dirname(os.path.abspath(__file__)),
                   help="папка с сайтом (index.html)")
    p.add_argument("--version", action="version", version="SprinterGo server " + __version__)
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    root = os.path.realpath(args.root)
    if not os.path.isdir(root):
        print("Ошибка: папка сайта не найдена: %s" % root, file=sys.stderr)
        return 2
    if not os.path.isfile(os.path.join(root, "index.html")):
        print("Предупреждение: в %s нет index.html — корень сайта будет отдавать 404." % root, file=sys.stderr)

    StaticHandler.root = root

    class Server(ThreadingHTTPServer):
        daemon_threads = True
        allow_reuse_address = True
        request_queue_size = 128

    try:
        httpd = Server((args.host, args.port), StaticHandler)
    except OSError as exc:
        print("Ошибка: не удалось занять %s:%s — %s" % (args.host, args.port, exc.strerror or exc), file=sys.stderr)
        print("Подсказка: порт занят? Проверьте `./status.sh` или `ss -ltnp | grep %s`." % args.port, file=sys.stderr)
        return 1

    stop_event = threading.Event()

    def on_signal(signum, _frame):
        stop_event.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    worker = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.5}, daemon=True)
    worker.start()

    lan_ip = detect_lan_ip()
    shown_host = "127.0.0.1" if args.host in ("0.0.0.0", "", "::") else args.host
    print("Sprinter Go — статический сервер v%s" % __version__)
    print("Папка сайта : %s" % root)
    print("Слушаю      : http://%s:%d/" % (args.host, args.port))
    print("Открыть     : http://%s:%d/" % (shown_host, args.port))
    if lan_ip and args.host in ("0.0.0.0", "", "::"):
        print("В сети      : http://%s:%d/" % (lan_ip, args.port))
    print("Остановка   : Ctrl+C (или ./stop.sh)")
    sys.stdout.flush()

    try:
        while not stop_event.wait(0.5):
            pass
    finally:
        print("Останавливаю сервер…")
        sys.stdout.flush()
        httpd.shutdown()
        httpd.server_close()
        # даём активным запросам до 3 секунд на завершение
        deadline = time.monotonic() + 3
        while StaticHandler.active > 0 and time.monotonic() < deadline:
            time.sleep(0.05)
        print("Сервер остановлен.")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
