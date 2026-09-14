# -*- coding: utf-8 -*-
"""Мини-фреймворк на стандартной библиотеке: роутер, JSON, сессии, SSE, статика.

Сервис должен подниматься на голом VPS одной командой, поэтому здесь нет ни одной
внешней зависимости. Всё, что обычно даёт Flask/FastAPI, собрано здесь в объёме,
который реально нужен проекту, — и ни строчкой больше.
"""
import gzip, hashlib, hmac, json, mimetypes, os, re, secrets, socket, sys, threading, time, traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('font/woff2', '.woff2')
mimetypes.add_type('application/manifest+json', '.webmanifest')
mimetypes.add_type('image/svg+xml', '.svg')

LOG_LOCK = threading.Lock()


def normalize_base(base):
    """Приводит путь установки к виду «/» или «/go/»: со слешами с обеих сторон."""
    b = '/' + (base or '').strip().strip('/')
    return b if b == '/' else b + '/'


def log(*parts):
    with LOG_LOCK:
        sys.stdout.write(time.strftime('[%d.%m %H:%M:%S] ') + ' '.join(str(p) for p in parts) + '\n')
        sys.stdout.flush()


# ─────────────────────────────────────────────────────────────── ошибки

class ApiError(Exception):
    """Ошибка, которую не стыдно показать пользователю."""

    def __init__(self, code, message, status=400, **extra):
        super().__init__(message)
        self.code, self.message, self.status, self.extra = code, message, status, extra


def bad(msg, code='bad_request'):      raise ApiError(code, msg, 400)
def unauthorized(msg='Нужно войти'):   raise ApiError('unauthorized', msg, 401)
def forbidden(msg='Нет доступа'):      raise ApiError('forbidden', msg, 403)
def not_found(msg='Не найдено'):       raise ApiError('not_found', msg, 404)
def conflict(msg):                     raise ApiError('conflict', msg, 409)
def too_many(msg='Слишком часто, подождите'): raise ApiError('too_many', msg, 429)


# ─────────────────────────────────────────────────────────────── контекст запроса

class Ctx:
    """Всё, что нужно обработчику: разобранный запрос и способ ответить."""

    def __init__(self, handler, method, path, query, body, ip):
        self.h, self.method, self.path, self.query, self.ip = handler, method, path, query, ip
        self._body = body
        self.user = None            # заполняется в require_auth
        self.session = None
        self._json = None

    @property
    def json(self):
        if self._json is None:
            if not self._body:
                self._json = {}
            else:
                try:
                    self._json = json.loads(self._body.decode('utf-8'))
                except Exception:
                    raise ApiError('bad_json', 'Тело запроса не похоже на JSON', 400)
            if not isinstance(self._json, dict):
                raise ApiError('bad_json', 'Ожидался объект JSON', 400)
        return self._json

    def q(self, name, default=None):
        v = self.query.get(name)
        return v[0] if v else default

    def qi(self, name, default=0):
        try:
            return int(self.q(name) or default)
        except (TypeError, ValueError):
            return default

    def header(self, name, default=None):
        return self.h.headers.get(name, default)

    # ── поля тела с проверкой ────────────────────────────────────────────────
    def need(self, name, kind=str, maxlen=None):
        v = self.json.get(name)
        if v is None or (kind is str and not str(v).strip()):
            raise ApiError('field_required', f'Не заполнено поле «{name}»', 400, field=name)
        return self.field(name, kind, maxlen)

    def field(self, name, kind=str, maxlen=None, default=None):
        v = self.json.get(name, default)
        if v is None:
            return default
        try:
            if kind is str:
                v = str(v).strip()
                if maxlen and len(v) > maxlen:
                    v = v[:maxlen]
            elif kind is int:
                v = int(v)
            elif kind is float:
                v = float(v)
            elif kind is bool:
                v = bool(v) if not isinstance(v, str) else v.lower() in ('1', 'true', 'yes', 'on')
            elif kind in (list, dict):
                if not isinstance(v, kind):
                    raise ValueError
        except (TypeError, ValueError):
            raise ApiError('bad_field', f'Неверное значение поля «{name}»', 400, field=name)
        return v


# ─────────────────────────────────────────────────────────────── роутер

class Router:
    """Маршруты вида /api/v1/orders/{pid}. Параметры приходят в обработчик по имени."""

    def __init__(self):
        self.routes = []        # (method, regex, names, fn)

    def add(self, method, pattern, fn):
        names = re.findall(r'\{(\w+)\}', pattern)
        rx = re.compile('^' + re.sub(r'\{(\w+)\}', r'(?P<\1>[^/]+)', pattern) + '$')
        self.routes.append((method, rx, names, fn))
        return fn

    def get(self, p):    return lambda fn: self.add('GET', p, fn)
    def post(self, p):   return lambda fn: self.add('POST', p, fn)
    def put(self, p):    return lambda fn: self.add('PUT', p, fn)
    def patch(self, p):  return lambda fn: self.add('PATCH', p, fn)
    def delete(self, p): return lambda fn: self.add('DELETE', p, fn)

    def match(self, method, path):
        allowed = False
        for m, rx, names, fn in self.routes:
            hit = rx.match(path)
            if not hit:
                continue
            if m != method:
                allowed = True
                continue
            return fn, {n: unquote(hit.group(n)) for n in names}
        if allowed:
            raise ApiError('method_not_allowed', 'Метод не поддерживается', 405)
        return None, None

    def include(self, other):
        self.routes.extend(other.routes)


# ─────────────────────────────────────────────────────────────── SSE

class Hub:
    """Рассылка событий подписчикам. Тема — строка вида 'order:AB12CD' или 'couriers'.

    Каждое соединение держит свой поток и очередь. Медленный клиент не тормозит
    остальных: если очередь переполнилась, соединение закрывается, браузер
    переподключится сам — это дешевле, чем копить память.
    """

    MAX_QUEUE = 64

    def __init__(self):
        self.subs = {}                       # topic -> set(Subscriber)
        self.lock = threading.Lock()

    class Subscriber:
        def __init__(self, topics):
            self.topics = set(topics)
            self.items = []
            self.cv = threading.Condition()
            self.alive = True

        def push(self, event, data):
            with self.cv:
                if not self.alive:
                    return
                if len(self.items) >= Hub.MAX_QUEUE:
                    self.alive = False        # клиент не успевает — рвём
                else:
                    self.items.append((event, data))
                self.cv.notify()

        def wait(self, timeout):
            with self.cv:
                if not self.items and self.alive:
                    self.cv.wait(timeout)
                out, self.items = self.items, []
                return out, self.alive

        def stop(self):
            with self.cv:
                self.alive = False
                self.cv.notify()

    def subscribe(self, topics):
        s = self.Subscriber(topics)
        with self.lock:
            for t in s.topics:
                self.subs.setdefault(t, set()).add(s)
        return s

    def unsubscribe(self, s):
        with self.lock:
            for t in s.topics:
                bucket = self.subs.get(t)
                if bucket:
                    bucket.discard(s)
                    if not bucket:
                        self.subs.pop(t, None)
        s.stop()

    def publish(self, topic, event, data):
        with self.lock:
            targets = list(self.subs.get(topic, ()))
        for s in targets:
            s.push(event, data)

    def count(self, topic=None):
        with self.lock:
            if topic:
                return len(self.subs.get(topic, ()))
            return sum(len(v) for v in self.subs.values())


HUB = Hub()


# ─────────────────────────────────────────────────────────────── статика

# Ссылки вида href="/assets/…" и src="/…" — но не "//host" и не "https://…"
ABS_URL = re.compile(r'\b(href|src|content)="/(?!/)')


class Static:
    """Отдача файлов: gzip, ETag, разумный кэш. Сжатое держим в памяти — файлов мало.

    Умеет отдавать сервис из подпапки. Если base не «/», все корневые ссылки в HTML
    и в манифесте на лету получают префикс, а в страницу добавляется window.SG_BASE
    для скриптов. Так один и тот же архив работает и на своём домене, и по адресу
    вида site.kg/go/ — без пересборки и без правки исходников.
    """

    GZIP_TYPES = ('text/', 'application/javascript', 'application/json',
                  'image/svg+xml', 'application/manifest+json')
    IMMUTABLE = ('.woff2', '.png', '.jpg', '.webp', '.ico')

    def __init__(self, root, dev=False, base='/'):
        self.root = os.path.abspath(root)
        self.dev = dev
        self.base = normalize_base(base)
        self.cache = {}
        self.lock = threading.Lock()

    def rebase(self, raw, ctype):
        """Подставляет префикс установки в текстовые файлы, которым это нужно."""
        if self.base == '/':
            return raw
        if ctype.startswith('text/html'):
            text = raw.decode('utf-8')
            text = ABS_URL.sub(lambda m: f'{m.group(1)}="{self.base}', text)
            inject = f'<script>window.SG_BASE={json.dumps(self.base)}</script>'
            # ставим первой строкой head, чтобы скрипты страницы уже видели префикс
            if '<head>' in text:
                text = text.replace('<head>', '<head>\n' + inject, 1)
            else:
                text = inject + text
            return text.encode('utf-8')
        if 'manifest' in ctype:
            text = raw.decode('utf-8')
            text = re.sub(r'"/(?!/)', '"' + self.base, text)
            return text.encode('utf-8')
        return raw

    def resolve(self, url_path):
        rel = unquote(url_path.lstrip('/')) or 'index.html'
        full = os.path.abspath(os.path.join(self.root, rel))
        # защита от выхода за корень: сравниваем уже нормализованные пути
        if full != self.root and not full.startswith(self.root + os.sep):
            return None
        if os.path.isdir(full):
            full = os.path.join(full, 'index.html')
        return full if os.path.isfile(full) else None

    def read(self, full):
        st = os.stat(full)
        key = (full, st.st_mtime_ns, st.st_size)
        if not self.dev:
            with self.lock:
                hit = self.cache.get(full)
                if hit and hit[0] == key:
                    return hit[1]
        with open(full, 'rb') as f:
            raw = f.read()
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/javascript', 'application/json'):
            ctype += '; charset=utf-8'
        raw = self.rebase(raw, ctype)
        gz = None
        if any(ctype.startswith(t) for t in self.GZIP_TYPES) and len(raw) > 900:
            gz = gzip.compress(raw, 6)
            if len(gz) >= len(raw):
                gz = None
        etag = '"%s"' % hashlib.md5(raw).hexdigest()[:20]
        ext = os.path.splitext(full)[1].lower()
        if self.dev:
            cache = 'no-store'
        elif ext in self.IMMUTABLE:
            cache = 'public, max-age=31536000, immutable'
        elif ext in ('.css', '.js'):
            cache = 'public, max-age=604800'
        else:
            cache = 'no-cache'
        entry = (raw, gz, ctype, etag, cache)
        if not self.dev:
            with self.lock:
                self.cache[full] = (key, entry)
        return entry


# ─────────────────────────────────────────────────────────────── ограничитель частоты

class RateLimit:
    """Простое окно: N попыток за period секунд на ключ. Для входа и отправки заявок."""

    def __init__(self):
        self.hits = {}
        self.lock = threading.Lock()

    def check(self, key, limit, period):
        now = time.time()
        with self.lock:
            arr = [t for t in self.hits.get(key, ()) if now - t < period]
            if len(arr) >= limit:
                arr.append(now)
                self.hits[key] = arr
                return False
            arr.append(now)
            self.hits[key] = arr
            if len(self.hits) > 4000:          # редкая уборка, чтобы память не росла
                self.hits = {k: v for k, v in self.hits.items() if v and now - v[-1] < 3600}
            return True


LIMIT = RateLimit()


# ─────────────────────────────────────────────────────────────── приложение

class App:
    def __init__(self, static_root, dev=False, base='/'):
        self.router = Router()
        self.base = normalize_base(base)
        self.static = Static(static_root, dev, self.base)
        self.dev = dev
        self.pages = {}          # url -> файл, для SPA-маршрутов
        self.before = []         # функции (ctx) -> None, выполняются до обработчика
        self.csp = None

    def page(self, url, file):
        self.pages[url] = file

    def handle(self, ctx):
        fn, params = self.router.match(ctx.method, ctx.path)
        if fn is None:
            not_found('Такого метода нет')
        for hook in self.before:
            hook(ctx)
        return fn(ctx, **params)


# ─────────────────────────────────────────────────────────────── HTTP-обработчик

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'SprinterGo'
    sys_version = ''
    app = None                    # проставляется в serve()

    MAX_BODY = 8 * 1024 * 1024      # фото верификации приходит внутри JSON

    def log_message(self, *a):    # свой формат, тише стандартного
        pass

    # ── ответы ───────────────────────────────────────────────────────────────
    def _security_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        if self.app.csp:
            self.send_header('Content-Security-Policy', self.app.csp)

    def send_json(self, obj, status=200, headers=None):
        body = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self._security_headers()
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def send_error_json(self, err):
        payload = {'error': {'code': err.code, 'message': err.message}}
        if err.extra:
            payload['error'].update(err.extra)
        self.send_json(payload, err.status)

    # ── SSE ──────────────────────────────────────────────────────────────────
    def start_sse(self):
        """Открывает поток событий. Соединение закрывается по разрыву — так проще
        и надёжнее, чем chunked: EventSource переподключится сам."""
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache, no-transform')
        self.send_header('X-Accel-Buffering', 'no')      # чтобы nginx не буферизовал
        self.send_header('Connection', 'close')
        self._security_headers()
        self.end_headers()
        self.close_connection = True

    def sse_send(self, event, data, retry=None):
        chunk = ''
        if retry:
            chunk += f'retry: {retry}\n'
        if event:
            chunk += f'event: {event}\n'
        payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
        for line in payload.split('\n'):
            chunk += f'data: {line}\n'
        chunk += '\n'
        self.wfile.write(chunk.encode('utf-8'))
        self.wfile.flush()

    def sse_loop(self, topics, on_open=None, ping_s=20, max_s=3600):
        """Держит соединение и льёт события из хаба, пока клиент не отвалится."""
        self.start_sse()
        sub = HUB.subscribe(topics)
        started = time.time()
        try:
            self.sse_send(None, {'ok': True}, retry=3000)
            if on_open:
                for ev, data in (on_open() or ()):
                    self.sse_send(ev, data)
            while time.time() - started < max_s:
                items, alive = sub.wait(ping_s)
                for ev, data in items:
                    self.sse_send(ev, data)
                if not alive:
                    break
                if not items:
                    self.sse_send('ping', {'t': int(time.time())})
        except (BrokenPipeError, ConnectionResetError, socket.timeout, OSError):
            pass                                  # клиент ушёл — это норма
        finally:
            HUB.unsubscribe(sub)

    # ── статика и страницы ───────────────────────────────────────────────────
    def serve_static(self, url_path):
        app = self.app
        file = app.pages.get(url_path) or app.static.resolve(url_path)
        if not file or not os.path.isfile(file):
            if url_path.startswith('/api/'):
                return self.send_error_json(ApiError('not_found', 'Не найдено', 404))
            file = app.static.resolve('/404.html')
            if not file:
                return self.send_error_json(ApiError('not_found', 'Страница не найдена', 404))
            raw, gz, ctype, etag, _ = app.static.read(file)
            return self._send_file(raw, gz, ctype, etag, 'no-cache', status=404)
        raw, gz, ctype, etag, cache = app.static.read(file)
        if self.headers.get('If-None-Match') == etag:
            self.send_response(304)
            self.send_header('ETag', etag)
            self.send_header('Cache-Control', cache)
            self.end_headers()
            return
        self._send_file(raw, gz, ctype, etag, cache)

    def _send_file(self, raw, gz, ctype, etag, cache, status=200):
        use_gz = gz is not None and 'gzip' in (self.headers.get('Accept-Encoding') or '')
        body = gz if use_gz else raw
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('ETag', etag)
        self.send_header('Cache-Control', cache)
        if use_gz:
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Vary', 'Accept-Encoding')
        self._security_headers()
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    # ── точка входа ──────────────────────────────────────────────────────────
    def _client_ip(self):
        fwd = self.headers.get('X-Forwarded-For')
        if fwd:
            return fwd.split(',')[0].strip()
        return self.client_address[0]

    def _dispatch(self, method):
        parsed = urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        try:
            if not path.startswith('/api/'):
                if method in ('GET', 'HEAD'):
                    return self.serve_static(parsed.path)
                raise ApiError('method_not_allowed', 'Метод не поддерживается', 405)

            length = int(self.headers.get('Content-Length') or 0)
            if length > self.MAX_BODY:
                raise ApiError('too_large', 'Запрос слишком большой', 413)
            body = self.rfile.read(length) if length else b''
            ctx = Ctx(self, method, path, parse_qs(parsed.query), body, self._client_ip())
            result = self.app.handle(ctx)
            if result is None:
                return                       # обработчик ответил сам (SSE или файл)
            status = 200
            if isinstance(result, tuple):
                result, status = result
            self.send_json(result, status)
        except ApiError as e:
            try:
                self.send_error_json(e)
            except (BrokenPipeError, ConnectionResetError):
                pass
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            log('ОШИБКА', method, path, '\n' + traceback.format_exc())
            try:
                self.send_error_json(ApiError('server_error', 'Внутренняя ошибка сервиса', 500))
            except (BrokenPipeError, ConnectionResetError):
                pass

    def do_GET(self):    self._dispatch('GET')
    def do_HEAD(self):   self._dispatch('HEAD')
    def do_POST(self):   self._dispatch('POST')
    def do_PUT(self):    self._dispatch('PUT')
    def do_PATCH(self):  self._dispatch('PATCH')
    def do_DELETE(self): self._dispatch('DELETE')


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64


def serve(app, host='0.0.0.0', port=7030):
    handler = type('BoundHandler', (Handler,), {'app': app})
    srv = Server((host, port), handler)
    srv.timeout = 60
    return srv
