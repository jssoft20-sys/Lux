# -*- coding: utf-8 -*-
"""Оплата заказа: общий интерфейс и провайдеры.

Провайдер выбирается настройкой payment.provider, и заказ никогда не зависит
от того, работает ли этот провайдер. Нет реквизитов, не отвечает шлюз, ошибка
в ответе — оформление продолжается, заказ просто уходит на оплату наличными
курьеру. Терять живой заказ из-за платёжки нельзя: человек уже стоит с вещами.

Провайдеры:
  none        — онлайн-оплаты нет, рассчитываются с курьером на месте;
  manual      — оплату отмечает админ руками (счёт, перевод, договор);
  freedompay  — шлюз FreedomPay (он же PayBox) по документированному протоколу:
                подпись pg_sig = md5(имя скрипта + значения по алфавиту ключей +
                секретное слово), инициализация через init_payment.php,
                результат приходит POST-ом на pg_result_url.

Идемпотентность. Шлюз повторяет колбэк, пока не получит внятный ответ, поэтому
второй и третий вызов по тому же заказу не должны ничего менять: проверка идёт
внутри транзакции по текущему payment_status, а не по памяти процесса.
"""
import hashlib
import hmac
import secrets
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qsl, urlencode, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from . import db, settings
from .core import HUB, ApiError, log, not_found

PROVIDERS = ('none', 'manual', 'freedompay')

FREEDOM_API = 'https://api.freedompay.money'
INIT_SCRIPT = 'init_payment.php'
CALLBACK_PATH = '/api/v1/payments/callback/freedompay'
HTTP_TIMEOUT = 8.0            # секунд на разговор со шлюзом
MAX_BODY = 256 * 1024         # ответ платёжки больше четверти мегабайта — это уже не ответ

# Чтобы не писать в лог одно и то же на каждый заказ.
_warned = set()


# ─────────────────────────────────────────────────────────────── настройки

def config():
    provider_code = str(settings.get('payment.provider', 'none') or 'none').strip().lower()
    api = str(settings.get('payment.api_url', FREEDOM_API) or FREEDOM_API).strip().rstrip('/')
    return {
        'enabled': settings.get_bool('payment.enabled', False),
        'provider': provider_code if provider_code in PROVIDERS else 'none',
        'merchant': str(settings.get('payment.merchant_id', '') or '').strip(),
        'secret': str(settings.get('payment.secret', '') or '').strip(),
        'testing': settings.get_bool('payment.test_mode', True),
        'api': api or FREEDOM_API,
        'currency': str(settings.get('service.currency', 'KGS') or 'KGS').strip().upper(),
        'lifetime': max(300, settings.get_int('payment.lifetime_s', 1800)),
        'prepay_commission': settings.get_bool('payment.prepay_commission', False),
        # имя скрипта для подписи колбэка — это последняя часть пути pg_result_url
        'script': str(settings.get('payment.callback_script', '') or '').strip() or 'freedompay',
        'result_url': str(settings.get('payment.result_url', '') or '').strip(),
        'base_url': str(settings.get('service.base_url', '') or '').strip().rstrip('/'),
    }


def _warn_once(key, *parts):
    if key not in _warned:
        _warned.add(key)
        log('оплата:', *parts)


def provider():
    """Какой провайдер реально работает прямо сейчас.

    Если оплата выключена или у шлюза нет реквизитов, провайдер честно называет
    себя 'none': пусть лучше заказ уйдёт на наличные, чем упрётся в пустой мерчант.
    """
    cfg = config()
    if not cfg['enabled']:
        return 'none'
    code = cfg['provider']
    if code == 'freedompay' and not (cfg['merchant'] and cfg['secret']):
        _warn_once('freedompay_creds',
                   'FreedomPay включён, но не заполнены payment.merchant_id или payment.secret —'
                   ' онлайн-оплата отключена, заказы идут на наличные')
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
        'freedompay': bool(cfg['merchant'] and cfg['secret']),
    }
    titles = {
        'none': 'Без онлайн-оплаты (наличные курьеру)',
        'manual': 'Вручную: оплату отмечает оператор',
        'freedompay': 'FreedomPay / PayBox',
    }
    return [{'code': c, 'title': titles[c], 'ready': ready[c], 'active': cfg['provider'] == c}
            for c in PROVIDERS]


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
    """Клиенту на экран и админке на карту: состояние оплаты поменялось."""
    try:
        from . import dispatch          # ленивый импорт: платежи не тянут диспетчер на старте
        state = dispatch.order_state(order)
    except Exception:
        state = {'public_id': order['public_id'], 'status': order['status'],
                 'payment_status': order.get('payment_status'),
                 'payment_method': order.get('payment_method'),
                 'price_total': order.get('price_total', 0)}
    HUB.publish('order:%s' % order['public_id'], 'order', state)
    HUB.publish('admin', 'order', dict(state, id=order['id']))


def money_str(tiyin):
    """Тыйыны → строка для шлюза: 150000 → «1500.00». Только целая арифметика."""
    v = max(0, int(tiyin or 0))
    return '%d.%02d' % (v // 100, v % 100)


def money_tiyin(raw):
    """«1500.00» → 150000 тыйынов. Через Decimal, чтобы не ловить 1499.9999."""
    try:
        return int((Decimal(str(raw).strip().replace(',', '.')) * 100)
                   .quantize(Decimal(1)))
    except (InvalidOperation, ValueError, TypeError, AttributeError):
        return 0


def amount_for(order):
    """Сколько брать онлайн: всю сумму или только комиссию как бронь."""
    if settings.get_bool('payment.prepay_commission', False):
        return max(0, int(order.get('commission') or 0))
    return max(0, int(order.get('price_total') or 0))


# ─────────────────────────────────────────────────────────────── подпись

def _flat(params, prefix=''):
    """Плоский словарь для подписи. Вложенность у PayBox встречается редко
    (например, в разбивке по товарам), но если пришла — раскладываем по ключам."""
    out = {}
    for key, value in params.items():
        name = '%s%s' % (prefix, key)
        if isinstance(value, dict):
            out.update(_flat(value, name + '_'))
        elif isinstance(value, (list, tuple)):
            for i, item in enumerate(value):
                if isinstance(item, (dict, list, tuple)):
                    out.update(_flat({str(i): item}, name + '_'))
                else:
                    out['%s_%d' % (name, i)] = item
        elif value is not None:
            out[name] = value
    return out


def sign(script, params, secret):
    """Подпись PayBox: md5 от имени скрипта, значений параметров по алфавиту
    ключей и секретного слова, склеенных точкой с запятой."""
    flat = _flat(params)
    flat.pop('pg_sig', None)
    parts = [str(script)] + [str(flat[k]) for k in sorted(flat)] + [str(secret)]
    return hashlib.md5(';'.join(parts).encode('utf-8')).hexdigest()


def _scripts(cfg, script=None):
    """Имена скрипта, которыми шлюз мог подписать колбэк. Обычно это последний
    кусок пути pg_result_url, но настройку могли и переопределить."""
    names = [script, cfg['script'], 'freedompay']
    if cfg['result_url']:
        names.append(urlsplit(cfg['result_url']).path.rsplit('/', 1)[-1])
    out = []
    for n in names:
        n = str(n or '').strip()
        if n and n not in out:
            out.append(n)
    return out


def verify_signature(provider_code, data, script=None):
    """Проверка подписи колбэка. Без секрета и без pg_sig — сразу нет."""
    if str(provider_code or '').lower() != 'freedompay':
        return False
    cfg = config()
    data = _as_dict(data)
    got = str(data.get('pg_sig') or '').strip().lower()
    if not cfg['secret'] or len(got) != 32:
        return False
    # Байты, а не строки: подпись приходит снаружи, и символ вне ASCII в ней
    # уронил бы compare_digest вместо того, чтобы просто не совпасть.
    got_b = got.encode('utf-8')
    for name in _scripts(cfg, script):
        if hmac.compare_digest(got_b, sign(name, data, cfg['secret']).encode('utf-8')):
            return True
    return False


def _as_dict(data):
    """Колбэк может прийти словарём, строкой запроса или сырым телом."""
    if isinstance(data, dict):
        return {str(k): ('' if v is None else v) for k, v in data.items()}
    if isinstance(data, bytes):
        data = data.decode('utf-8', 'replace')
    if isinstance(data, str):
        return dict(parse_qsl(data, keep_blank_values=True))
    return {}


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

    Возвращает ('paid'|'duplicate'|'missing', заказ). Повторный колбэк получает
    'duplicate' и ничего не меняет — деньги не списываются дважды, статистика
    не удваивается.
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
    log('оплата: заказ', fresh['public_id'], 'оплачен на', money_str(amount), fresh.get('payment_method'))
    return 'paid', fresh


def mark_failed(order, reason='', payment_id=None, actor='payment'):
    """Оплата не прошла. Уже оплаченный заказ такой колбэк не трогает."""
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


# ─────────────────────────────────────────────────────────────── инициализация

def init_payment(order, amount=None, return_url=None, lang='ru'):
    """Подготовить оплату заказа.

    Возвращает словарь: {ok, provider, status, method, url, amount, payment_id, message}.
    url не пустой только когда человека действительно нужно отправить на шлюз.
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
        started = _freedompay_init(order, amount, return_url, lang)
    except Exception as e:
        # шлюз недоступен или отказал — заказ всё равно должен уйти в работу
        log('оплата: FreedomPay не принял заказ', order['public_id'], '—', e)
        fresh = _set_payment(order, method='cash', status='none', paid=0)
        _event(order['id'], 'payment_offline', {'error': str(e)[:200]})
        return {'ok': True, 'provider': 'none', 'status': 'none', 'method': 'cash',
                'url': None, 'amount': 0, 'payment_id': None, 'fallback': True,
                'message': t('pay.offline_hint', lang)}

    fresh = _set_payment(order, method='online', status='pending',
                         payment_id=started['payment_id'])
    _event(order['id'], 'payment_started',
           {'amount': amount, 'provider': 'freedompay', 'payment_id': started['payment_id']})
    _publish(fresh)
    return {'ok': True, 'provider': 'freedompay', 'status': 'pending', 'method': 'online',
            'url': started['url'], 'amount': amount, 'payment_id': started['payment_id'],
            'message': t('pay.wait_hint', lang)}


def _result_url(cfg, return_url=None):
    """Куда шлюз пришлёт результат. Берём явную настройку, потом адрес сервиса,
    потом — origin страницы возврата: хоть один из трёх обычно заполнен."""
    if cfg['result_url']:
        return cfg['result_url']
    if cfg['base_url']:
        return cfg['base_url'] + CALLBACK_PATH
    if return_url:
        parts = urlsplit(return_url)
        if parts.scheme and parts.netloc:
            return '%s://%s%s' % (parts.scheme, parts.netloc, CALLBACK_PATH)
    return ''


def _first_phone(order):
    for p in (db.jload(order.get('points'), []) or []):
        if isinstance(p, dict) and p.get('phone'):
            return str(p['phone'])[:20]
    return ''


def _freedompay_init(order, amount, return_url, lang='ru'):
    """Запрос init_payment.php. Возвращает {'url': ..., 'payment_id': ...}
    или бросает исключение — разбираться с ним будет init_payment()."""
    cfg = config()
    service = str(settings.get('service.name', 'Sprinter Go'))
    params = {
        'pg_merchant_id': cfg['merchant'],
        'pg_order_id': order['public_id'],
        'pg_amount': money_str(amount),
        'pg_currency': cfg['currency'],
        'pg_description': '%s: заказ %s' % (service, order['public_id']),
        'pg_salt': secrets.token_hex(8),
        'pg_testing_mode': '1' if cfg['testing'] else '0',
        'pg_request_method': 'POST',
        'pg_lifetime': str(cfg['lifetime']),
        'pg_language': 'kg' if str(lang).lower().startswith('ky') else 'ru',
    }
    result_url = _result_url(cfg, return_url)
    if result_url:
        params['pg_result_url'] = result_url
        params['pg_result_url_method'] = 'POST'
    if return_url:
        params['pg_success_url'] = return_url
        params['pg_failure_url'] = return_url
        params['pg_success_url_method'] = 'GET'
        params['pg_failure_url_method'] = 'GET'
    phone = _first_phone(order)
    if phone:
        params['pg_user_phone'] = phone
    params['pg_sig'] = sign(INIT_SCRIPT, params, cfg['secret'])

    url = '%s/%s' % (cfg['api'], INIT_SCRIPT)
    req = Request(url, data=urlencode(params, encoding='utf-8').encode('utf-8'),
                  headers={'Content-Type': 'application/x-www-form-urlencoded',
                           'User-Agent': 'SprinterGo/1.0'})
    with urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        body = resp.read(MAX_BODY)
    answer = _parse_xml(body)
    if answer.get('pg_status') != 'ok':
        raise RuntimeError('%s %s' % (answer.get('pg_error_code', ''),
                                      answer.get('pg_error_description', 'шлюз ответил отказом')))
    pay_url = answer.get('pg_redirect_url') or answer.get('pg_redirect_url_type')
    if not pay_url:
        raise RuntimeError('шлюз не прислал ссылку на оплату')
    return {'url': pay_url, 'payment_id': answer.get('pg_payment_id', '')}


def _parse_xml(body):
    """Ответ PayBox — плоский XML. Разбираем в словарь верхнего уровня."""
    try:
        root = ElementTree.fromstring(body)
    except ElementTree.ParseError:
        raise RuntimeError('шлюз ответил не XML')
    out = {}
    for child in root:
        out[child.tag] = (child.text or '').strip()
    return out


# ─────────────────────────────────────────────────────────────── колбэк

def _xml(status, description, cfg=None, script=None):
    """Ответ шлюзу. PayBox ждёт подписанный XML и повторяет запрос, пока
    не получит его, — поэтому подписываем даже отказ."""
    cfg = cfg or config()
    params = {'pg_salt': secrets.token_hex(8), 'pg_status': status,
              'pg_description': description}
    params['pg_sig'] = sign(script or cfg['script'], params, cfg['secret'])
    body = ['<?xml version="1.0" encoding="utf-8"?>', '<response>']
    for key in ('pg_salt', 'pg_status', 'pg_description', 'pg_sig'):
        text = str(params[key]).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
        body.append('<%s>%s</%s>' % (key, text, key))
    body.append('</response>')
    return '\n'.join(body)


def handle_callback(provider_code, data, script=None):
    """Вебхук платёжного шлюза.

    Возвращает словарь с готовым ответом для провайдера:
    {ok, status, order_id, public_id, payment_id, amount, message, body, content_type}.
    Роутер отдаёт body с указанным content_type — для FreedomPay это XML,
    другого ответа шлюз не понимает.
    """
    code = str(provider_code or '').strip().lower()
    if code != 'freedompay':
        # у 'none' и 'manual' вебхуков нет — значит, стучится кто-то посторонний
        not_found('Такой платёжный провайдер не подключён')
    cfg = config()
    data = _as_dict(data)
    xml_type = 'application/xml; charset=utf-8'

    if not verify_signature(code, data, script):
        log('оплата: колбэк с неверной подписью, заказ', data.get('pg_order_id'))
        return {'ok': False, 'status': 'bad_signature', 'order_id': None,
                'public_id': data.get('pg_order_id'), 'payment_id': data.get('pg_payment_id'),
                'amount': 0, 'message': 'Подпись не сошлась',
                'body': _xml('error', 'Signature check failed', cfg, script),
                'content_type': xml_type}

    public_id = str(data.get('pg_order_id') or '').strip()
    payment_id = str(data.get('pg_payment_id') or '').strip()
    amount = money_tiyin(data.get('pg_amount'))
    order = db.row('SELECT * FROM orders WHERE public_id=?', (public_id,)) if public_id else None
    if not order:
        log('оплата: колбэк по неизвестному заказу', public_id)
        return {'ok': False, 'status': 'unknown_order', 'order_id': None, 'public_id': public_id,
                'payment_id': payment_id, 'amount': amount, 'message': 'Заказ не найден',
                'body': _xml('error', 'Order not found', cfg, script), 'content_type': xml_type}

    success = str(data.get('pg_result') or '').strip() in ('1', 'ok', 'true')
    if not success:
        state, fresh = mark_failed(order, data.get('pg_failure_description') or
                                   data.get('pg_error_description') or 'отказ шлюза', payment_id)
        if fresh is not None:
            _publish(fresh)
        return {'ok': True, 'status': 'failed', 'order_id': order['id'], 'public_id': public_id,
                'payment_id': payment_id, 'amount': amount, 'message': 'Оплата не прошла',
                'duplicate': state == 'duplicate',
                'body': _xml('ok', 'Payment failure accepted', cfg, script),
                'content_type': xml_type}

    state, fresh = mark_paid(order, amount or amount_for(order), payment_id, method='online')
    if fresh is not None:
        _publish(fresh)
    if state == 'paid':
        _resume(fresh)
    return {'ok': True, 'status': 'paid', 'order_id': order['id'], 'public_id': public_id,
            'payment_id': payment_id, 'amount': amount,
            'duplicate': state == 'duplicate',
            'message': 'Оплата принята' if state == 'paid' else 'Оплата уже была зачтена',
            'body': _xml('ok', 'Payment accepted', cfg, script), 'content_type': xml_type}
