# -*- coding: utf-8 -*-
"""Оплата заказа: общий интерфейс и провайдер Оптима Банка.

Клиент платит вперёд не всю поездку, а только бронь — комиссию сервиса. Это
доказательство, что человек настоящий и машина едет не впустую; остальное он
отдаёт курьеру наличными. Размер брони считает prepay_amount(): комиссия из
настроек, зажатая между payment.prepay_min и payment.prepay_max.

Провайдеры:
  none    — онлайн-оплаты нет, рассчитываются с курьером на месте;
  manual  — оплату отмечает оператор руками (счёт, перевод, договор);
  optima  — QR Оптима Банка: сервис выпускает код, человек платит из приложения
            своего банка, банк стучится к нам обратным уведомлением.

Оптима, что где лежит:
  optima.sale_points()     — торговые точки и кассы компании, кэш на час;
  optima.init_payment()    — выпуск QR v2, transactionId сразу ложится в базу;
  optima.check_status()    — ручная проверка, если уведомление не дошло;
  optima.handle_callback() — приём уведомления банка с Basic Auth.

Старый интерфейс модуля сохранён: provider(), enabled(), init_payment(),
handle_callback(), mark_paid(), mark_failed(), mark_manual() работают как раньше,
поэтому routers/public.py и routers/admin.py править не нужно.

Три правила, которые здесь нарушать нельзя:

1. Ключ банка, логин и пароль обратного уведомления наружу не уходят никогда —
   ни клиенту, ни админке: только признак «задано».
2. Оплата засчитывается ровно один раз. Банк повторяет уведомление, пока не
   получит внятный ответ, поэтому идемпотентность проверяется в базе
   (UPDATE ... WHERE status<>'paid'), а не в памяти процесса.
3. Заказ важнее платёжки. Не отвечает банк, нет реквизитов, отказал шлюз —
   человек не остаётся с вещами на улице: заказ уходит на оплату наличными.
"""
import base64
import binascii
import hmac
import json
import socket
import threading
import time
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.parse import quote as urlquote
from urllib.request import Request, urlopen

from . import db, settings
from .core import HUB, ApiError, log, not_found

PROVIDERS = ('none', 'manual', 'optima')

# ─── Оптима: адреса из официального руководства, версия 1.0 от 12.06.2026 ───
OPTIMA_API = 'https://api.optimabusiness.kg'
SALE_POINTS_PATH = '/api/v2/get-sale-point-infos/%s'
QR_PATH = '/api/v2/generate/qr'
QR_INFO_PATH = '/api/v1/get-qr-transaction-info/%s'
ACCOUNTS_PATH = '/api/v1/get-account-infos-by-filter'

# Только этот тип QR умеет присылать обратные уведомления на наш адрес.
QR_GENERATE_TYPE = 'CALLBACK_WEB_PARTNER_BY_SALE_POINT'
QR_SIZE = 300

# Куда банк стучится с уведомлением об оплате. Полный адрес собирает routers/pay.py:
# в кабинете Оптимы указывают его вместе с логином и паролем Basic Auth.
CALLBACK_PATH = '/api/v1/pay/callback'

HTTP_TIMEOUT = 12.0           # секунд на разговор с банком
MAX_BODY = 512 * 1024         # ответ банка больше половины мегабайта — это уже не ответ
SALE_POINTS_TTL = 3600        # точки и кассы меняются раз в год, а спрашивают их часто
STATUS_POLL_EVERY_S = 15      # как часто можно переспрашивать банк по одной транзакции
AMOUNT_TOLERANCE = 1          # расхождение больше тыйына — отказ

# Границы брони на случай, если их убрали из настроек: 50 и 500 сом.
PREPAY_MIN = 5000
PREPAY_MAX = 50000

# Слова банка о судьбе транзакции. Всё, что не узнали, считаем «ещё ждём»:
# лучше лишний раз переспросить, чем закрыть заказ по незнакомому статусу.
PAID_WORDS = ('PROCESSED', 'PAID', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED',
              'CONFIRMED', 'EXECUTED', 'DONE', 'OK')
FAILED_WORDS = ('REJECTED', 'DECLINED', 'CANCELED', 'CANCELLED', 'FAILED',
                'ERROR', 'EXPIRED', 'TIMEOUT', 'REVERSED', 'REFUNDED')
STATUS_KEYS = ('status', 'state', 'transactionStatus', 'qrStatus',
               'paymentStatus', 'transactionState')
SUM_KEYS = ('sum', 'amount', 'paidSum', 'transactionSum', 'paymentSum')

# Чтобы не писать в лог одно и то же на каждый заказ.
_warned = set()

# Метка суммы в теле запроса: подменяется на число ровно с двумя знаками.
_SUM_MARK = '@@sum@@'


class PayError(ApiError):
    """Банк не смог. Сообщение написано так, чтобы его можно было показать админу."""

    def __init__(self, message, code='payment_error', status=502, **extra):
        super().__init__(code, message, status, **extra)


# ─────────────────────────────────────────────────────────────── настройки

def config():
    """Все платёжные настройки одним словарём. Внутри секреты — наружу не отдавать,
    для админки есть admin_view()."""
    code = str(settings.get('payment.provider', 'none') or 'none').strip().lower()
    company = str(settings.get('payment.optima_company', '') or '').strip()
    api = str(settings.get('payment.optima_url', OPTIMA_API) or OPTIMA_API).strip().rstrip('/')
    return {
        'enabled': settings.get_bool('payment.enabled', False),
        'provider': code if code in PROVIDERS else 'none',
        'key': str(settings.get('payment.optima_key', '') or '').strip(),
        'company': company,
        'sale_point': settings.get_int('payment.optima_sale_point', 0),
        'cash': settings.get_int('payment.optima_cash', 0),
        'note': str(settings.get('payment.optima_note', '') or '').strip()
                or 'Бронь заказа Sprinter Go',
        'api': api or OPTIMA_API,
        'ttl': max(120, min(settings.get_int('payment.qr_ttl_s', 600), 3600)),
        'callback_login': str(settings.get('payment.callback_login', '') or '').strip(),
        'callback_password': str(settings.get('payment.callback_password', '') or ''),
        'currency': str(settings.get('service.currency', 'KGS') or 'KGS').strip().upper(),
        'base_url': str(settings.get('service.base_url', '') or '').strip().rstrip('/'),
        'prepay_min': max(0, settings.get_int('payment.prepay_min', PREPAY_MIN)),
        'prepay_max': max(0, settings.get_int('payment.prepay_max', PREPAY_MAX)),
        'prepay_percent': settings.get_float('payment.prepay_percent', 0),
        'prepay_commission': settings.get_bool('payment.prepay_commission', True),
    }


def _warn_once(key, *parts):
    if key not in _warned:
        _warned.add(key)
        log('оплата:', *parts)


def provider():
    """Какой провайдер реально работает прямо сейчас.

    Если оплата выключена или у банка нет реквизитов, провайдер честно называет
    себя 'none': пусть лучше заказ уйдёт на наличные, чем упрётся в пустой ключ.
    """
    cfg = config()
    if not cfg['enabled']:
        return 'none'
    code = cfg['provider']
    if code == 'optima' and not (cfg['key'] and cfg['company']):
        _warn_once('optima_creds',
                   'Оптима включена, но не заполнены payment.optima_key или'
                   ' payment.optima_company — онлайн-оплата отключена,'
                   ' заказы идут на наличные')
        return 'none'
    return code


def enabled():
    return provider() != 'none'


def providers():
    """Список провайдеров для админки: что выбрано и что готово к работе."""
    cfg = config()
    ready = {
        'none': True,
        'manual': True,
        'optima': bool(cfg['key'] and cfg['company']),
    }
    titles = {
        'none': 'Без онлайн-оплаты (наличные курьеру)',
        'manual': 'Вручную: оплату отмечает оператор',
        'optima': 'Оптима Банк, оплата по QR',
    }
    return [{'code': c, 'title': titles[c], 'ready': ready[c], 'active': cfg['provider'] == c}
            for c in PROVIDERS]


def admin_view():
    """Что показываем в разделе «Оплата». Ни ключа, ни пароля — только признаки."""
    cfg = config()
    return {
        'enabled': cfg['enabled'],
        'provider': cfg['provider'],
        'active': provider(),
        'ready': bool(cfg['key'] and cfg['company']),
        'key_set': bool(cfg['key']),
        'company': cfg['company'],
        'sale_point': cfg['sale_point'],
        'cash': cfg['cash'],
        'note': cfg['note'],
        'qr_ttl_s': cfg['ttl'],
        'callback_login': cfg['callback_login'],      # логин не секрет, пароль — секрет
        'callback_password_set': bool(cfg['callback_password']),
        'prepay': {
            'min': cfg['prepay_min'], 'max': cfg['prepay_max'],
            'percent': cfg['prepay_percent'], 'commission': cfg['prepay_commission'],
        },
        'providers': providers(),
    }


# ─────────────────────────────────────────────────────────────── своя табличка

# db.py трогать нельзя — таблицу под выпущенные QR заводим сами при первом
# обращении. CREATE TABLE IF NOT EXISTS ничего не ломает при повторном запуске.
_QR_TABLE = [
    """CREATE TABLE IF NOT EXISTS payment_qr (
         transaction_id TEXT PRIMARY KEY,
         order_id INTEGER NOT NULL,
         public_id TEXT NOT NULL,
         provider TEXT NOT NULL DEFAULT 'optima',
         amount INTEGER NOT NULL,
         status TEXT NOT NULL DEFAULT 'pending',
         qr_url TEXT, qr_base64 TEXT, note TEXT,
         sale_point INTEGER, cash INTEGER,
         created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
         checked_at INTEGER NOT NULL DEFAULT 0,
         paid_at INTEGER, paid_amount INTEGER NOT NULL DEFAULT 0,
         bank_status TEXT, fail_reason TEXT)""",
    "CREATE INDEX IF NOT EXISTS ix_payment_qr_order ON payment_qr(order_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS ix_payment_qr_status ON payment_qr(status, created_at DESC)",
]

_schema_ready = False
_schema_lock = threading.Lock()


def _ensure_schema():
    with _schema_lock:
        global _schema_ready
        if _schema_ready:
            return
        for stmt in _QR_TABLE:
            db.execute(stmt)
        _schema_ready = True


# ─────────────────────────────────────────────────────────────── мелочи

def _order(order_or_id):
    if isinstance(order_or_id, dict):
        if 'id' in order_or_id and 'payment_status' in order_or_id:
            return order_or_id
        key = order_or_id.get('id') or order_or_id.get('public_id')
        return _order(key)
    if order_or_id is None:
        return None
    if isinstance(order_or_id, str) and not order_or_id.isdigit():
        return db.row('SELECT * FROM orders WHERE public_id=?', (order_or_id,))
    return db.row('SELECT * FROM orders WHERE id=?', (int(order_or_id),))


def _event(order_id, kind, data, actor='payment'):
    db.insert('order_events', {'order_id': order_id, 'at': db.now(), 'actor': actor,
                               'type': kind, 'data': db.jdump(data)})


def _publish(order):
    """Клиенту на экран и админке на карту: состояние оплаты поменялось.

    Ради этого события экран оплаты и переключается сам, без нажатий."""
    try:
        from . import dispatch          # ленивый импорт: платежи не тянут диспетчер на старте
        state = dispatch.order_state(order)
    except Exception:
        state = {'public_id': order['public_id'], 'status': order['status'],
                 'payment_status': order.get('payment_status'),
                 'payment_method': order.get('payment_method'),
                 'price_total': order.get('price_total', 0)}
    state['paid_amount'] = order.get('paid_amount', 0)
    HUB.publish('order:%s' % order['public_id'], 'order', state)
    HUB.publish('admin', 'order', dict(state, id=order['id']))


def money_str(tiyin):
    """Тыйыны → строка для банка: 150000 → «1500.00». Только целая арифметика."""
    v = max(0, int(tiyin or 0))
    return '%d.%02d' % (v // 100, v % 100)


def money_tiyin(raw):
    """«1500.50» → 150050 тыйынов. Через Decimal, чтобы не ловить 1499.9999."""
    try:
        return int((Decimal(str(raw).strip().replace(',', '.')) * 100)
                   .quantize(Decimal(1)))
    except (InvalidOperation, ValueError, TypeError, AttributeError):
        return 0


def prepay_amount(order):
    """Размер брони в тыйынах.

    Формула живёт в одном месте — в pricing. Второй такой же расчёт здесь уже
    был, и он тихо разошёлся с тем, что видит человек на экране: показали одно,
    списали другое. Поэтому считаем только там и здесь ничего не повторяем.
    """
    from . import pricing              # ленивый импорт: расчёт цены не нужен при старте
    order = order or {}
    if order.get('id'):
        # У сохранённого заказа вычтется то, что уже закрыто бонусами:
        # просить вперёд больше, чем человек вообще должен, нельзя.
        return max(0, int(pricing.prepay_for_order(order)))
    return max(0, int(pricing.prepay_amount(order.get('price_total'),
                                            order.get('commission'))))


def amount_for(order):
    """Сколько брать онлайн.

    С Оптимой это всегда бронь. Остальным провайдерам оставлено старое поведение:
    вся сумма либо комиссия вперёд, если так настроено.
    """
    if provider() == 'optima' or settings.get_bool('payment.prepay_commission', False):
        return prepay_amount(order)
    return max(0, int((order or {}).get('price_total') or 0))


def awaiting_prepay(order):
    """Заказ ждёт бронь и не должен уходить в поиск машины.

    Пока онлайн-оплата включена, а деньги не пришли, машину не ищем: иначе
    курьер поедет к человеку, которого нет.
    """
    if not enabled():
        return False
    order = order or {}
    return (str(order.get('payment_method') or '') == 'online'
            and str(order.get('payment_status') or 'none') == 'pending')


def _as_dict(data):
    """Уведомление может прийти словарём, сырыми байтами или строкой JSON."""
    if isinstance(data, dict):
        return data
    if isinstance(data, bytes):
        data = data.decode('utf-8', 'replace')
    if isinstance(data, str):
        text = data.strip()
        if text:
            try:
                parsed = json.loads(text)
            except ValueError:
                return {}
            if isinstance(parsed, dict):
                return parsed
    return {}


def _int_or_none(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _dig(obj, keys, depth=3):
    """Ищем значение по одному из имён — в корне ответа или на пару уровней внутри.

    Руководство описывает тело уведомления, но не тело ответа на проверку статуса,
    поэтому читаем осторожно: что нашли — то и разбираем, остальное не выдумываем.
    """
    if depth <= 0:
        return None
    if isinstance(obj, list):
        for item in obj:
            found = _dig(item, keys, depth - 1)
            if found is not None:
                return found
        return None
    if not isinstance(obj, dict):
        return None
    for key in keys:
        if key in obj and obj[key] not in (None, ''):
            return obj[key]
    for value in obj.values():
        if isinstance(value, (dict, list)):
            found = _dig(value, keys, depth - 1)
            if found is not None:
                return found
    return None


def normalize_status(word):
    """Слово банка → наше 'pending' | 'paid' | 'failed'."""
    w = str(word or '').strip().upper()
    if w in PAID_WORDS:
        return 'paid'
    if w in FAILED_WORDS:
        return 'failed'
    return 'pending'


def _clean_base64(raw):
    """Картинка QR. Банк присылает голый base64, но префикс data:image встречается
    в примерах — срезаем его, чтобы фронт не гадал, что ему подсунули."""
    text = str(raw or '').strip()
    if text.startswith('data:'):
        text = text.split(',', 1)[-1]
    return ''.join(text.split())


# ─────────────────────────────────────────────────────────────── запись оплаты

def _set_payment(order, method=None, status=None, payment_id=None, paid=None):
    patch = {}
    if method is not None:
        patch['payment_method'] = method
    if status is not None:
        patch['payment_status'] = status
    if payment_id is not None:
        patch['payment_id'] = str(payment_id)[:64]
    if paid is not None:
        patch['paid_amount'] = max(0, int(paid))
    if not patch:
        return order
    db.update('orders', patch, 'id=?', (order['id'],))
    fresh = dict(order)
    fresh.update(patch)
    return fresh


def mark_paid(order, amount, payment_id=None, method='online', actor='payment'):
    """Пометить заказ оплаченным ровно один раз.

    Возвращает ('paid'|'duplicate'|'missing', заказ). Повторное уведомление
    получает 'duplicate' и ничего не меняет — деньги не зачисляются дважды,
    статистика не удваивается.
    """
    order = _order(order)
    if not order:
        return 'missing', None
    amount = max(0, int(amount or 0))
    with db.tx():
        cur = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
        if not cur:
            return 'missing', None
        if cur['payment_status'] == 'paid':
            return 'duplicate', cur
        db.update('orders', {
            'payment_status': 'paid',
            'payment_method': method,
            'payment_id': str(payment_id or cur['payment_id'] or '')[:64] or None,
            'paid_amount': amount,
        }, 'id=?', (cur['id'],))
        _event(cur['id'], 'payment_paid',
               {'amount': amount, 'payment_id': payment_id, 'method': method}, actor)
    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    log('оплата: заказ', fresh['public_id'], 'оплачен на', money_str(amount),
        fresh.get('payment_method'))
    return 'paid', fresh


def mark_failed(order, reason='', payment_id=None, actor='payment'):
    """Оплата не прошла. Уже оплаченный заказ такое уведомление не трогает."""
    order = _order(order)
    if not order:
        return 'missing', None
    with db.tx():
        cur = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
        if not cur:
            return 'missing', None
        if cur['payment_status'] == 'paid':
            return 'duplicate', cur
        db.update('orders', {'payment_status': 'failed',
                             'payment_id': str(payment_id or cur['payment_id'] or '')[:64] or None},
                  'id=?', (cur['id'],))
        _event(cur['id'], 'payment_failed', {'reason': str(reason)[:200],
                                             'payment_id': payment_id}, actor)
    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    return 'failed', fresh


def mark_manual(order, paid=True, amount=None, actor='admin', note=''):
    """Ручная отметка из админки: «деньги пришли» или «оплата снята»."""
    order = _order(order)
    if not order:
        not_found('Заказ не найден')
    if paid:
        state, fresh = mark_paid(order, amount if amount is not None else amount_for(order),
                                 payment_id=order.get('payment_id') or 'manual',
                                 method='manual', actor=actor)
        if fresh is not None:
            _publish(fresh)
            if state == 'paid':
                _resume(fresh)
        return {'ok': state != 'missing', 'status': 'paid', 'duplicate': state == 'duplicate'}
    with db.tx():
        db.update('orders', {'payment_status': 'pending', 'paid_amount': 0}, 'id=?', (order['id'],))
        _event(order['id'], 'payment_reset', {'note': str(note)[:200]}, actor)
    fresh = db.row('SELECT * FROM orders WHERE id=?', (order['id'],))
    _publish(fresh)
    return {'ok': True, 'status': 'pending', 'duplicate': False}


def _resume(order):
    """После оплаты заказ идёт искать машину. Если он уже в поиске или у него
    есть курьер — не трогаем, диспетчер сам разберётся."""
    if order.get('status') not in ('draft', 'expired'):
        return False
    try:
        from . import dispatch
        dispatch.start_search(order['id'])
        return True
    except ApiError as e:
        log('оплата: заказ', order['public_id'], 'оплачен, но поиск не стартовал —', e.message)
    except Exception as e:
        log('оплата: заказ', order['public_id'], 'оплачен, но поиск не стартовал —', e)
    return False


# ─────────────────────────────────────────────────────────────── Оптима Банк

class Optima:
    """Разговор с Оптима Банком: точки продаж, выпуск QR, статус, уведомления."""

    def __init__(self):
        self._points = {'at': 0.0, 'sign': None, 'items': []}
        self._points_lock = threading.Lock()
        self._order_locks = {}
        self._locks_lock = threading.Lock()

    # ── связь ────────────────────────────────────────────────────────────────
    def _request(self, method, path, payload=None, timeout=HTTP_TIMEOUT):
        """Один разговор с банком. Возвращает разобранный JSON либо бросает PayError
        с причиной на русском: её показывают админу как есть."""
        cfg = config()
        if not cfg['key']:
            raise PayError('Не задан ключ Оптимы (X-API-KEY)', 'no_key', 400)
        # Заголовки уходят в сеть однобайтовой кодировкой, и русская буква в ключе
        # роняет запрос ещё до отправки — с невнятной ошибкой вместо объяснения.
        # А попасть туда она может запросто: ключ копируют из письма или переписки.
        try:
            cfg['key'].encode('ascii')
        except UnicodeEncodeError:
            raise PayError('В ключе есть русские буквы или пробелы — '
                           'скопируйте его из кабинета Оптимы заново', 'bad_key', 400)
        data = None
        if payload is not None:
            data = (payload if isinstance(payload, str)
                    else json.dumps(payload, ensure_ascii=False)).encode('utf-8')
        req = Request(cfg['api'] + path, data=data, method=method, headers={
            'X-API-KEY': cfg['key'],
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'SprinterGo/3.0',
        })
        try:
            with urlopen(req, timeout=timeout) as resp:
                raw = resp.read(MAX_BODY)
        except HTTPError as e:
            raise PayError(_http_reason(e), 'bank_http_%d' % e.code)
        except (URLError, socket.timeout, OSError) as e:
            raise PayError('Банк не отвечает: %s' % _short(e), 'bank_offline')
        except Exception as e:
            # Что бы ни случилось по дороге к банку, наружу должно выйти
            # объяснение на русском, а не пятисотка со стеком.
            raise PayError('Не вышло связаться с банком: %s' % _short(e), 'bank_failed')
        if not raw:
            return {}
        try:
            return json.loads(raw.decode('utf-8', 'replace'))
        except ValueError:
            raise PayError('Банк ответил не по-нашему — это не JSON', 'bank_bad_json')

    # ── торговые точки и кассы ───────────────────────────────────────────────
    def sale_points(self, force=False):
        """Точки продаж и кассы компании. Кэш на час: список меняется раз в год,
        а спрашивают его каждый раз, когда админ открывает раздел оплаты."""
        cfg = config()
        if not cfg['company']:
            raise PayError('Не указан ID компании (legalPartyId)', 'no_company', 400)
        sign = (cfg['key'], cfg['company'], cfg['api'])
        now = time.time()
        with self._points_lock:
            hit = self._points
            if (not force and hit['sign'] == sign and hit['items']
                    and now - hit['at'] < SALE_POINTS_TTL):
                return _copy_points(hit['items'])
        items = _parse_sale_points(self._request(
            'GET', SALE_POINTS_PATH % urlquote(str(cfg['company']), safe='')))
        with self._points_lock:
            self._points = {'at': now, 'sign': sign, 'items': items}
        return _copy_points(items)

    def autopick(self, points=None, force=False):
        """Точка и касса выбираются сами. Одна точка — берём молча, несколько —
        оставляем выбор админу, но кассу внутри выбранной точки берём первую:
        спрашивать про кассу там, где она всё равно одна, — только мешать."""
        cfg = config()
        points = points if points is not None else self.sale_points(force=force)
        if not points:
            return None, None, 'Банк не вернул ни одной торговой точки'
        chosen = None
        if cfg['sale_point']:
            chosen = next((p for p in points if p['code'] == cfg['sale_point']), None)
        if chosen is None and len(points) == 1:
            chosen = points[0]
        if chosen is None:
            return None, None, 'В банке несколько торговых точек — выберите нужную'
        cash = None
        if cfg['cash']:
            cash = next((c['code'] for c in chosen['cashes'] if c['code'] == cfg['cash']), None)
        if cash is None and chosen['cashes']:
            cash = chosen['cashes'][0]['code']
        if cash is None:
            return chosen['code'], None, 'У торговой точки нет ни одной кассы'
        save = {}
        if cfg['sale_point'] != chosen['code']:
            save['payment.optima_sale_point'] = chosen['code']
        if cfg['cash'] != cash:
            save['payment.optima_cash'] = cash
        if save:
            settings.put_many(save)
            log('оплата: Оптима — выбрана точка', chosen['code'], 'касса', cash)
        return chosen['code'], cash, ''

    def requisite(self):
        """Реквизиты для выпуска QR. Не выбраны — подтягиваем из банка и запоминаем."""
        cfg = config()
        if cfg['sale_point'] and cfg['cash']:
            return cfg['sale_point'], cfg['cash']
        point, cash, why = self.autopick()
        if not (point and cash):
            raise PayError(why or 'Не выбрана торговая точка Оптимы', 'no_sale_point', 400)
        return point, cash

    # ── выпуск QR ────────────────────────────────────────────────────────────
    def init_payment(self, order, amount_tiyin):
        """Выпустить QR на сумму брони и запомнить transactionId.

        Возвращает {qr_base64, qr_url, transaction_id, sum, amount, expires_at}.
        """
        _ensure_schema()
        order = _order(order)
        if not order:
            not_found('Заказ не найден')
        amount = max(1, int(amount_tiyin or 0))
        cfg = config()
        sale_point, cash = self.requisite()
        note = _note_for(order, cfg)

        answer = self._request('POST', QR_PATH,
                               _qr_body(cfg, sale_point, cash, amount, note))
        tid = str(answer.get('transactionId') or '').strip()
        if not tid:
            raise PayError('Банк не прислал номер транзакции — код не выпущен',
                           'no_transaction')
        t = db.now()
        row = {
            'transaction_id': tid[:64], 'order_id': order['id'],
            'public_id': order['public_id'], 'provider': 'optima',
            'amount': amount, 'status': 'pending',
            'qr_url': str(answer.get('qrUrl') or '').strip()[:500] or None,
            'qr_base64': _clean_base64(answer.get('qrBase64')) or None,
            'note': note, 'sale_point': sale_point, 'cash': cash,
            'created_at': t, 'expires_at': t + cfg['ttl'], 'checked_at': 0,
            'paid_amount': 0,
        }
        with db.tx():
            # Старые коды не удаляем: человек мог отсканировать предыдущий, и его
            # оплата всё равно должна найти свой заказ. Помечаем их «устаревшими».
            db.execute("UPDATE payment_qr SET status='stale' "
                       "WHERE order_id=? AND status='pending'", (order['id'],))
            db.insert('payment_qr', row)
            db.update('orders', {'payment_method': 'online', 'payment_status': 'pending',
                                 'payment_id': tid[:64]}, 'id=?', (order['id'],))
            _event(order['id'], 'payment_started',
                   {'amount': amount, 'provider': 'optima', 'transaction_id': tid,
                    'sale_point': sale_point, 'cash': cash})
        log('оплата: заказ', order['public_id'], '— выпущен QR на', money_str(amount),
            'сом, транзакция', tid)
        return qr_view(row)

    # ── проверка статуса ─────────────────────────────────────────────────────
    def check_status(self, transaction_id):
        """Спросить банк напрямую — на случай, если уведомление не дошло.

        Возвращает {'status': 'pending'|'paid'|'failed', 'bank_status', 'amount'}.
        """
        tid = str(transaction_id or '').strip()
        if not tid:
            raise PayError('Нет номера транзакции', 'no_transaction', 400)
        data = self._request('GET', QR_INFO_PATH % urlquote(tid, safe=''))
        word = _dig(data, STATUS_KEYS)
        raw_sum = _dig(data, SUM_KEYS)
        return {
            'transaction_id': tid,
            'status': normalize_status(word),
            'bank_status': str(word or '')[:40],
            'amount': money_tiyin(raw_sum) if raw_sum is not None else None,
        }

    # ── обратное уведомление ─────────────────────────────────────────────────
    def check_basic(self, auth_header):
        """Basic Auth из кабинета Оптимы. Логин и пароль не заданы — не пускаем:
        подтверждать деньги по одному номеру транзакции нельзя."""
        cfg = config()
        login, password = cfg['callback_login'], cfg['callback_password']
        if not login or not password:
            _warn_once('callback_creds',
                       'обратное уведомление Оптимы не настроено —'
                       ' задайте payment.callback_login и payment.callback_password')
            return False
        raw = str(auth_header or '').strip()
        if raw[:6].lower() != 'basic ':
            return False
        try:
            decoded = base64.b64decode(raw[6:].strip(), validate=True).decode('utf-8')
        except (binascii.Error, ValueError, UnicodeDecodeError):
            return False
        got_login, _, got_password = decoded.partition(':')
        # Считаем обе проверки до конца: время ответа не должно подсказывать,
        # угадан логин или пароль.
        ok_login = hmac.compare_digest(got_login.encode('utf-8'), login.encode('utf-8'))
        ok_password = hmac.compare_digest(got_password.encode('utf-8'), password.encode('utf-8'))
        return ok_login and ok_password

    def handle_callback(self, data, auth_header):
        """Уведомление банка об оплате.

        Возвращает {'ok', 'http', 'state', 'body', 'order'}: тело и код ответа
        роутер отдаёт банку как есть. Повторное уведомление по тому же
        transactionId ничего не меняет и получает те же 200 OK.
        """
        _ensure_schema()
        received = utc_stamp()
        body = _as_dict(data)
        tid = str(body.get('transactionId') or '').strip()

        if not self.check_basic(auth_header):
            log('оплата: уведомление Оптимы с неверным Basic Auth, транзакция', tid or '—')
            return _callback_answer(False, 401, 'unauthorized', tid, received,
                                    'Неверные логин или пароль')
        if not tid:
            return _callback_answer(False, 400, 'no_transaction', tid, received,
                                    'В уведомлении нет transactionId')

        row = db.row('SELECT * FROM payment_qr WHERE transaction_id=?', (tid,))
        if not row:
            log('оплата: уведомление Оптимы по незнакомой транзакции', tid)
            return _callback_answer(False, 400, 'unknown_transaction', tid, received,
                                    'Транзакция не найдена')

        bank_status = str(body.get('status') or '').strip()
        db.update('payment_qr', {'bank_status': bank_status[:40] or None},
                  'transaction_id=?', (tid,))
        kind = normalize_status(bank_status)

        if kind == 'failed':
            _fail(row, 'банк ответил: %s' % (bank_status or 'отказ'))
            return _callback_answer(True, 200, 'failed', tid, received,
                                    'Отказ принят')
        if kind != 'paid':
            # Ни оплата, ни отказ: приняли к сведению и ждём следующего уведомления.
            return _callback_answer(True, 200, 'pending', tid, received,
                                    'Уведомление принято')

        paid = money_tiyin(body.get('sum')) if body.get('sum') is not None else None
        state, order = confirm(row, paid, source='callback')
        if state == 'mismatch':
            return _callback_answer(False, 400, 'sum_mismatch', tid, received,
                                    'Сумма не совпадает с ожидаемой')
        if state == 'missing':
            return _callback_answer(False, 400, 'unknown_order', tid, received,
                                    'Заказ не найден')
        return {'ok': True, 'http': 200, 'state': state, 'order': order,
                'body': {'message': 'Callback успешно обработан',
                         'transactionId': tid, 'receivedAt': received}}

    # ── остатки по счетам, для отчётов ───────────────────────────────────────
    def accounts(self):
        """Остатки по счетам компании. Нужны отчётам, в клиентские ответы не идут."""
        return self._request('GET', ACCOUNTS_PATH)

    # ── замок на заказ ───────────────────────────────────────────────────────
    def order_lock(self, order_id):
        """Один заказ — один выпуск QR за раз. Два быстрых нажатия на кнопку
        не должны стоить двух транзакций в банке."""
        key = int(order_id)
        with self._locks_lock:
            lock = self._order_locks.get(key)
            if lock is None:
                if len(self._order_locks) > 500:
                    self._order_locks = {k: v for k, v in self._order_locks.items()
                                         if v.locked()}
                lock = self._order_locks[key] = threading.Lock()
            return lock


optima = Optima()


# ─────────────────────────────────────────────────────────────── помощники Оптимы

def _short(err):
    text = str(err)
    return text[:120] if text else err.__class__.__name__


def _http_reason(err):
    """Код ответа банка — человеческой фразой. Админ должен понять, что чинить."""
    try:
        detail = err.read(MAX_BODY).decode('utf-8', 'replace').strip()[:200]
    except Exception:
        detail = ''
    code = getattr(err, 'code', 0)
    if code in (401, 403):
        return 'Банк не принял ключ: проверьте API-ключ Оптимы'
    if code == 404:
        return 'Банк не знает такой компании или транзакции — проверьте ID компании'
    if code == 400:
        return 'Банк отклонил запрос' + (': ' + detail if detail else '')
    if code == 429:
        return 'Слишком много запросов к банку, подождите минуту'
    if code >= 500:
        return 'На стороне банка ошибка (%d), попробуйте позже' % code
    return 'Банк ответил кодом %d%s' % (code, ': ' + detail if detail else '')


def _parse_sale_points(data):
    """Ответ get-sale-point-infos → плоский список точек с кассами."""
    out = []
    for acc in (data if isinstance(data, list) else [data]):
        if not isinstance(acc, dict):
            continue
        account = str(acc.get('account') or '').strip()
        for point in (acc.get('salePointInfoDtoList') or []):
            if not isinstance(point, dict):
                continue
            code = _int_or_none(point.get('code'))
            if code is None:
                continue
            cashes = []
            for cash in (point.get('cashDtoList') or []):
                if not isinstance(cash, dict):
                    continue
                cash_code = _int_or_none(cash.get('code'))
                if cash_code is None:
                    continue
                cashes.append({'code': cash_code,
                               'name': str(cash.get('name') or 'Касса %d' % cash_code)[:80]})
            out.append({
                'account': account,
                'code': code,
                'name': str(point.get('name') or 'Точка %d' % code)[:120],
                'address': str(point.get('address') or '')[:200],
                'cashes': cashes,
            })
    return out


def _copy_points(items):
    return [dict(p, cashes=[dict(c) for c in p['cashes']]) for p in items]


def _note_for(order, cfg):
    """Назначение платежа. Номер заказа внутри — чтобы в выписке банка было видно,
    за что пришли деньги."""
    note = '%s %s' % (cfg['note'], order['public_id'])
    return note.strip()[:120]


def _qr_body(cfg, sale_point, cash, amount, note):
    """Тело запроса на выпуск QR.

    Сумма уходит числом ровно с двумя знаками после точки и в СОМАХ, не в тыйынах:
    json из коробки так не умеет (1500.50 он напишет как 1500.5), поэтому число
    подставляем строкой по метке.
    """
    company = cfg['company']
    payload = {
        'requisite': {
            'salePointCode': sale_point,
            'cashCode': cash,
            'legalPartyId': int(company) if company.isdigit() else company,
        },
        'sum': _SUM_MARK,
        'note': note,
        'qrGenerateType': QR_GENERATE_TYPE,
        'transactionCount': 1,
        'untilDateTime': '',
        'qrType': 'png',
        'qrSize': QR_SIZE,
        'payerClientType': '',
        'extraInfo': {},
    }
    raw = json.dumps(payload, ensure_ascii=False)
    return raw.replace('"%s"' % _SUM_MARK, money_str(amount), 1)


def utc_stamp(at=None):
    """Время в том же виде, в каком его присылает банк: 2025-03-12T14:30:00Z."""
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(at if at else db.now()))


def _callback_answer(ok, http, state, tid, received, message):
    """Ответ банку. Даже отказ отдаём телом с теми же полями — в кабинете Оптимы
    видно, что именно не понравилось."""
    return {'ok': ok, 'http': http, 'state': state, 'order': None,
            'body': {'message': message, 'transactionId': tid, 'receivedAt': received}}


def qr_view(row):
    """Что отдаём на экран оплаты. Ни ключей, ни реквизитов банка."""
    return {
        'transaction_id': row['transaction_id'],
        'qr_base64': row.get('qr_base64') or '',
        'qr_url': row.get('qr_url') or '',
        'amount': int(row['amount']),
        'sum': money_str(row['amount']),
        'status': row.get('status') or 'pending',
        'created_at': int(row.get('created_at') or 0),
        'expires_at': int(row.get('expires_at') or 0),
    }


# ─────────────────────────────────────────────────────────────── зачёт оплаты

def confirm(row, paid_tiyin=None, source='callback'):
    """Засчитать оплату по транзакции ровно один раз.

    Возвращает ('paid'|'duplicate'|'mismatch'|'missing', заказ). Сначала
    переключается транзакция (UPDATE ... WHERE status<>'paid' — кто успел,
    тот и платит), потом заказ: оба шага идемпотентны, поэтому и уведомление
    банка, и наша собственная проверка статуса могут прийти хоть одновременно.
    """
    _ensure_schema()
    expected = int(row['amount'])
    got = expected if paid_tiyin is None else int(paid_tiyin)
    if abs(got - expected) > AMOUNT_TOLERANCE:
        reason = 'пришло %s вместо %s' % (money_str(got), money_str(expected))
        db.update('payment_qr', {'fail_reason': reason[:200], 'checked_at': db.now()},
                  'transaction_id=?', (row['transaction_id'],))
        log('оплата: заказ', row['public_id'], '— сумма не сошлась:', reason,
            '(транзакция %s)' % row['transaction_id'])
        return 'mismatch', None

    t = db.now()
    with db.tx():
        changed = db.execute(
            "UPDATE payment_qr SET status='paid', paid_at=?, paid_amount=?, checked_at=? "
            "WHERE transaction_id=? AND status<>'paid'",
            (t, got, t, row['transaction_id'])).rowcount
    order = _order(row['order_id'])
    if not changed:
        return 'duplicate', order
    if not order:
        return 'missing', None

    state, fresh = mark_paid(order, got, row['transaction_id'], method='online',
                             actor='payment:%s' % source)
    if fresh is None:
        return 'missing', None
    _publish(fresh)
    if state == 'paid':
        _resume(fresh)
        fresh = _order(fresh['id']) or fresh
    return ('paid' if state == 'paid' else state), fresh


def _fail(row, reason):
    """Банк отказал: помечаем транзакцию и заказ, оплаченное не трогаем."""
    if row.get('status') == 'paid':
        return 'duplicate'
    db.update('payment_qr', {'status': 'failed', 'fail_reason': str(reason)[:200],
                             'checked_at': db.now()},
              'transaction_id=? AND status<>?', (row['transaction_id'], 'paid'))
    state, fresh = mark_failed(row['order_id'], reason, row['transaction_id'])
    if fresh is not None:
        _publish(fresh)
    return state


# ─────────────────────────────────────────────────────────────── QR заказа

def last_qr(order):
    """Последний выпущенный код заказа — с ним и работает экран оплаты."""
    _ensure_schema()
    order_id = order['id'] if isinstance(order, dict) else int(order)
    return db.row('SELECT * FROM payment_qr WHERE order_id=? '
                  'ORDER BY created_at DESC, rowid DESC LIMIT 1', (order_id,))


def qr_for_order(order, refresh=False, amount=None):
    """Код оплаты заказа: живой отдаём как есть, протухший или на другую сумму —
    перевыпускаем. Повторное нажатие кнопки не должно плодить транзакции."""
    _ensure_schema()
    order = _order(order)
    if not order:
        not_found('Заказ не найден')
    want = int(amount) if amount is not None else amount_for(order)
    with optima.order_lock(order['id']):
        row = last_qr(order)
        if (row and not refresh and row['status'] == 'paid'):
            return qr_view(row)
        alive = (row and row['status'] == 'pending' and not refresh
                 and int(row['amount']) == want and int(row['expires_at']) > db.now())
        if alive:
            return qr_view(row)
        return optima.init_payment(order, want)


def refresh_status(order):
    """Состояние оплаты заказа, при необходимости — с вопросом банку.

    Уведомление может и не дойти: оборвалась сеть, банк не достучался. Поэтому
    экран, который опрашивает статус, заодно раз в пятнадцать секунд просит банк
    подтвердить транзакцию сам.
    """
    _ensure_schema()
    order = _order(order)
    if not order:
        not_found('Заказ не найден')
    row = last_qr(order)
    if not row or row['status'] != 'pending' or provider() != 'optima':
        return order, row
    t = db.now()
    if t - int(row['checked_at'] or 0) < STATUS_POLL_EVERY_S:
        return order, row
    db.update('payment_qr', {'checked_at': t}, 'transaction_id=?', (row['transaction_id'],))
    try:
        info = optima.check_status(row['transaction_id'])
    except ApiError as e:
        # Банк молчит — экран клиента из-за этого ломаться не должен.
        log('оплата: не получилось спросить банк о транзакции',
            row['transaction_id'], '—', e.message)
        return order, db.row('SELECT * FROM payment_qr WHERE transaction_id=?',
                             (row['transaction_id'],))
    if info['status'] == 'paid':
        state, fresh = confirm(row, info['amount'], source='poll')
        if fresh is not None:
            order = fresh
    elif info['status'] == 'failed':
        _fail(row, 'банк ответил: %s' % (info['bank_status'] or 'отказ'))
        order = _order(order['id']) or order
    db.update('payment_qr', {'bank_status': info['bank_status'] or None},
              'transaction_id=?', (row['transaction_id'],))
    return order, db.row('SELECT * FROM payment_qr WHERE transaction_id=?',
                         (row['transaction_id'],))


def payment_view(order, row=None, lang='ru'):
    """Состояние оплаты для экрана клиента: сколько бронь, сколько наличными."""
    from .i18n_server import t as say
    order = _order(order)
    if not order:
        not_found('Заказ не найден')
    row = row if row is not None else last_qr(order)
    amount = int(row['amount']) if row else amount_for(order)
    paid = order.get('payment_status') == 'paid'
    total = max(0, int(order.get('price_total') or 0))
    data = {
        'public_id': order['public_id'],
        'order_status': order['status'],
        'provider': provider(),
        'enabled': enabled(),
        # status — короткое поле для экрана оплаты: 'none' | 'pending' | 'paid' | 'failed'
        'status': order.get('payment_status') or 'none',
        'payment_status': order.get('payment_status') or 'none',
        'payment_method': order.get('payment_method') or 'cash',
        'paid': paid,
        'paid_amount': int(order.get('paid_amount') or 0),
        'amount': amount,
        'sum': money_str(amount),
        'price_total': total,
        'cash_rest': max(0, total - (int(order.get('paid_amount') or 0) if paid else 0)),
        'message': say('pay.done', lang) if paid else say('pay.wait_hint', lang),
    }
    if row:
        data['transaction_id'] = row['transaction_id']
        data['expires_at'] = int(row['expires_at'] or 0)
        data['qr_status'] = row['status']
    return data


# ─────────────────────────────────────────────────────────────── старый интерфейс

def init_payment(order, amount=None, return_url=None, lang='ru'):
    """Подготовить оплату заказа (старый вызов из routers/public.py).

    Возвращает словарь: {ok, provider, status, method, url, amount, payment_id, message}.
    Для Оптимы туда же кладётся готовый QR, а url — ссылка банка, по которой
    телефон откроет приложение. Пока url не пустой, заказ ждёт оплату и в поиск
    машины не уходит.
    """
    from .i18n_server import t                      # тексты нужны только для ответа человеку
    order = _order(order)
    if not order:
        not_found('Заказ не найден')
    code = provider()
    amount = amount_for(order) if amount is None else max(0, int(amount))

    if code == 'none' or amount <= 0:
        _set_payment(order, method='cash', status='none', paid=0)
        return {'ok': True, 'provider': 'none', 'status': 'none', 'method': 'cash',
                'url': None, 'amount': 0, 'payment_id': None,
                'message': t('pay.cash_hint', lang)}

    if code == 'manual':
        fresh = _set_payment(order, method='manual', status='pending')
        _event(order['id'], 'payment_pending', {'amount': amount, 'provider': 'manual'})
        _publish(fresh)
        return {'ok': True, 'provider': 'manual', 'status': 'pending', 'method': 'manual',
                'url': None, 'amount': amount, 'payment_id': None,
                'message': t('pay.manual_hint', lang)}

    try:
        qr = qr_for_order(order, amount=amount)
    except Exception as e:
        # Банк недоступен или отказал — заказ всё равно должен уйти в работу:
        # человек уже стоит с вещами, терять его из-за платёжки нельзя.
        log('оплата: Оптима не выпустила код по заказу', order['public_id'], '—',
            getattr(e, 'message', e))
        fresh = _set_payment(order, method='cash', status='none', paid=0)
        _event(order['id'], 'payment_offline', {'error': str(getattr(e, 'message', e))[:200]})
        _publish(fresh)
        return {'ok': True, 'provider': 'none', 'status': 'none', 'method': 'cash',
                'url': None, 'amount': 0, 'payment_id': None, 'fallback': True,
                'message': t('pay.offline_hint', lang)}

    fresh = _order(order['id']) or order
    if qr['status'] == 'paid' or fresh.get('payment_status') == 'paid':
        # Деньги уже пришли, пока человек жал кнопку: второй раз платить нечего.
        return {'ok': True, 'provider': 'optima', 'status': 'paid', 'method': 'online',
                'url': None, 'amount': qr['amount'], 'sum': qr['sum'],
                'payment_id': qr['transaction_id'], 'transaction_id': qr['transaction_id'],
                'message': t('pay.done', lang)}
    _publish(fresh)
    return {'ok': True, 'provider': 'optima', 'status': 'pending', 'method': 'online',
            'prepay': True,
            'url': qr['qr_url'] or _track_url(order),
            'amount': qr['amount'], 'sum': qr['sum'],
            'qr_base64': qr['qr_base64'], 'qr_url': qr['qr_url'],
            'transaction_id': qr['transaction_id'], 'expires_at': qr['expires_at'],
            'payment_id': qr['transaction_id'],
            'price_total': int(fresh.get('price_total') or 0),
            'message': t('pay.wait_hint', lang)}


def _track_url(order):
    """Запасная ссылка «куда идти платить», если банк не прислал свою: наш же
    экран отслеживания, на котором показывается QR."""
    return '#/track/%s?t=%s' % (order['public_id'], order.get('track_token') or '')


def handle_callback(provider_code, data, script=None, auth_header=None):
    """Старый путь /api/v1/payments/callback/{provider}.

    Оставлен ради совместимости: настоящий адрес для банка — POST /api/v1/pay/callback
    из routers/pay.py, он умеет отдавать коды 401 и 400, как требует Оптима.
    Без заголовка Basic Auth здесь всегда отказ: подтверждать деньги по одному
    номеру транзакции нельзя.
    """
    code = str(provider_code or '').strip().lower()
    if code != 'optima':
        not_found('Такой платёжный провайдер не подключён')
    res = optima.handle_callback(data, auth_header)
    return {'ok': res['ok'], 'status': res['state'], 'http': res['http'],
            'public_id': (res['order'] or {}).get('public_id'),
            'order_id': (res['order'] or {}).get('id'),
            'message': res['body'].get('message'),
            'body': json.dumps(res['body'], ensure_ascii=False),
            'content_type': 'application/json; charset=utf-8'}


# ─────────────────────────────────────────────────────────────── проверка связи

def test_connection():
    """Проверка связи с банком для админки: понятный ответ вместо сырой ошибки."""
    cfg = config()
    if not cfg['key']:
        return {'ok': False, 'code': 'no_key',
                'message': 'Не задан API-ключ Оптимы — вставьте его и сохраните'}
    if not cfg['company']:
        return {'ok': False, 'code': 'no_company',
                'message': 'Не указан ID компании (legalPartyId) из кабинета Оптимы'}
    try:
        points = optima.sale_points(force=True)
    except ApiError as e:
        return {'ok': False, 'code': e.code, 'message': e.message}
    if not points:
        return {'ok': False, 'code': 'no_points', 'points': [],
                'message': 'Банк ответил, но торговых точек у компании нет — '
                           'проверьте ID компании в кабинете Оптимы'}
    point, cash, why = optima.autopick(points)
    cashes = sum(len(p['cashes']) for p in points)
    msg = 'Связь с Оптимой есть: %s, %s' % (_plural(len(points), 'точка', 'точки', 'точек'),
                                            _plural(cashes, 'касса', 'кассы', 'касс'))
    if point and cash:
        chosen = next((p for p in points if p['code'] == point), None)
        msg += '. Работаем через «%s», касса %s' % (chosen['name'] if chosen else point, cash)
    elif why:
        msg += '. %s' % why
    return {'ok': True, 'code': 'ok', 'message': msg, 'points': points,
            'sale_point': point, 'cash': cash, 'hint': why}


def _plural(n, one, few, many):
    n10, n100 = n % 10, n % 100
    if n10 == 1 and n100 != 11:
        word = one
    elif 2 <= n10 <= 4 and not 12 <= n100 <= 14:
        word = few
    else:
        word = many
    return '%d %s' % (n, word)
