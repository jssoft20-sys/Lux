# -*- coding: utf-8 -*-
"""Оплата брони по QR: экран клиента, уведомление банка и настройка в админке.

Клиент платит вперёд только бронь — комиссию сервиса. Остальное он отдаёт
курьеру наличными. Пока бронь не пришла, машину не ищем: иначе курьер поедет
к человеку, которого нет.

Маршруты (полный путь — с префиксом /api/v1):

  POST /pay/{public_id}/qr?t=токен   выпустить код оплаты или вернуть уже выпущенный
  GET  /pay/{public_id}/status?t=    состояние оплаты, для опроса с экрана
  POST /pay/callback                 уведомление банка, Basic Auth
  GET  /admin/pay/settings           что сейчас настроено (без ключей и паролей)
  PUT  /admin/pay/settings           сохранить ключ, ID компании, выбранную точку
  GET  /admin/pay/sale-points        торговые точки и кассы компании
  POST /admin/pay/test               проверка связи с банком

Что возвращает POST /pay/{pid}/qr — это и есть контракт с экраном оплаты:

  {"enabled": true, "provider": "optima", "status": "pending",
   "transaction_id": "123", "qr_base64": "iVBORw0…",   — картинка PNG без «data:»
   "qr_url": "https://…",                              — открыть в приложении банка
   "amount": 15000, "sum": "150.00",                   — бронь в тыйынах и в сомах
   "price_total": 150000, "cash_rest": 135000,         — сколько отдать курьеру
   "expires_at": 1757800000, "poll_every_s": 3,
   "hint": "…", "note": "…"}

Если оплата выключена или выбран оператор, приходит {"enabled": false, "message": …} —
кода не будет, и экран должен сказать про наличные. Если заказ уже оплачен, приходит
то же тело, что у GET /pay/{pid}/status: {"status": "paid", "paid": true, …}.

Два правила этого файла:

1. Чужой заказ не показываем: токен отслеживания сверяем через compare_digest,
   иначе по времени ответа его можно подобрать посимвольно.
2. Ключ банка, логин и пароль обратного уведомления наружу не уходят. Пароль
   показывается ровно один раз — в ответе на запрос, который его создал.
"""
import hmac
import secrets

from .. import auth, db, i18n_server as i18n, payments, settings
from ..core import (LIMIT, ApiError, Router, bad, conflict, forbidden, log,
                    not_found, too_many)

API = '/api/v1'
router = Router()

POLL_EVERY_S = 3            # как часто экран оплаты спрашивает статус
STATUS_MIN_GAP_S = 2        # чаще раза в две секунды на заказ не отвечаем
QR_PER_MIN = 6              # столько раз в минуту можно перевыпустить код заказа
CALLBACK_PER_MIN = 120      # защита от перебора пароля обратного уведомления
TEST_PER_MIN = 10           # столько проверок связи в минуту на одного админа

# Границы настроек: пустой срок жизни кода или бронь в миллион — это не гибкость,
# а сломанный сервис.
TTL_RANGE = (120, 3600)
PREPAY_RANGE = (0, 1000000)         # до 10 000 сом
PERCENT_RANGE = (0, 100)

# Заказы, по которым платить уже нечего.
CLOSED = ('cancelled', 'done', 'expired')


# ─────────────────────────────────────────────────────────────── свои фразы

# Тексты только этого экрана. Общий словарь трогать нельзя, да и незачем:
# здесь их семь. Первый вариант — русский, второй — кыргызский.
SAY = {
    'pay.prepay': ('Сейчас платите только бронь {sum} — остальное отдадите курьеру наличными.',
                   'Азыр {sum} бронь гана төлөйсүз — калганын курьерге накталай бересиз.'),
    'pay.scan': ('Отсканируйте код в приложении своего банка',
                 'Кодду банк тиркемеңизден сканерлеңиз'),
    'pay.off': ('Онлайн-оплата выключена — рассчитаетесь с курьером на месте.',
                'Онлайн төлөм өчүк — курьер менен ордунда эсептешесиз.'),
    'pay.manual': ('Счёт на оплату выставит оператор, заказ уже принят.',
                   'Төлөм эсебин оператор чыгарат, заказ кабыл алынды.'),
    'pay.closed': ('Этот заказ уже закрыт, платить по нему нечего.',
                   'Бул заказ жабылган, ага төлөй турган эч нерсе жок.'),
    'pay.bank_down': ('Банк сейчас не отвечает. Попробуйте ещё раз через минуту '
                      'или заплатите курьеру наличными.',
                      'Банк азыр жооп бербей жатат. Бир мүнөттөн кийин кайра аракет '
                      'кылыңыз же курьерге накталай төлөңүз.'),
    'pay.too_often': ('Слишком часто. Подождите пару секунд.',
                      'Өтө тез-тез. Бир-эки секунд күтө туруңуз.'),
    'pay.wrong_token': ('Ссылка на заказ не подходит. Откройте заказ из приложения.',
                        'Заказдын шилтемеси туура келбейт. Заказды тиркемеден ачыңыз.'),
}


def say(key, lang='ru', **vars):
    """Фраза из своего словарика с подстановкой."""
    ru, ky = SAY[key]
    text = ky if i18n.norm_lang(lang) == 'ky' else ru
    try:
        return text.format(**vars)
    except (KeyError, IndexError, ValueError):
        return text


# ─────────────────────────────────────────────────────────────── доступ к заказу

def _lang(ctx, order=None):
    raw = ctx.q('lang')
    if not raw and ctx.method in ('POST', 'PUT', 'PATCH'):
        try:
            raw = ctx.json.get('lang')
        except ApiError:
            raw = None
    if not raw and order:
        raw = order.get('lang')
    if not raw:
        raw = (ctx.header('Accept-Language') or '')[:2]
    return i18n.norm_lang(raw or 'ru')


def _find(public_id):
    order = db.row('SELECT * FROM orders WHERE public_id=?',
                   (str(public_id or '').strip().upper(),))
    if not order:
        not_found(i18n.error_text('order_not_found'))
    return order


def _token(ctx):
    tok = ctx.q('t') or ctx.q('token') or ctx.header('X-Track-Token')
    if not tok and ctx.method in ('POST', 'PUT', 'PATCH'):
        try:
            body = ctx.json
        except ApiError:
            body = {}
        tok = body.get('t') or body.get('track_token')
    return str(tok or '').strip()


def _check_token(ctx, order):
    """Ключ от заказа — токен отслеживания. Сравниваем байты через compare_digest:
    строка вне ASCII уронила бы сравнение в 500 вместо честного отказа."""
    lang = order.get('lang') or 'ru'
    given = _token(ctx)
    real = str(order.get('track_token') or '')
    if not given or not real:
        forbidden(say('pay.wrong_token', lang))
    if not hmac.compare_digest(given.encode('utf-8'), real.encode('utf-8')):
        forbidden(say('pay.wrong_token', lang))


# ─────────────────────────────────────────────────────────────── экран оплаты

@router.post(API + '/pay/{public_id}/qr')
def make_qr(ctx, public_id):
    """Код оплаты заказа. Живой код возвращаем как есть — второе нажатие кнопки
    не должно стоить второй транзакции в банке."""
    order = _find(public_id)
    _check_token(ctx, order)
    lang = _lang(ctx, order)
    code = payments.provider()

    if order['payment_status'] == 'paid':
        return _state_body(order, lang)
    if order['status'] in CLOSED:
        conflict(say('pay.closed', lang))
    if code == 'manual':
        return {'enabled': False, 'provider': 'manual', 'status': order['payment_status'],
                'message': say('pay.manual', lang)}
    if code != 'optima':
        return {'enabled': False, 'provider': code, 'status': order['payment_status'],
                'message': say('pay.off', lang)}

    refresh = str(ctx.q('refresh') or '').lower() in ('1', 'true', 'yes')
    if not refresh:
        try:
            refresh = bool(ctx.field('refresh', bool, default=False))
        except ApiError:
            refresh = False          # тело без JSON — просто отдадим текущий код
    if not LIMIT.check('payqr:%s' % order['public_id'], QR_PER_MIN, 60):
        too_many(say('pay.too_often', lang))

    try:
        qr = payments.qr_for_order(order, refresh=refresh)
    except ApiError as e:
        # Настоящую причину — в журнал администратору, человеку на экране —
        # понятную фразу и живой выход: заплатить курьеру наличными.
        log('оплата: заказ', order['public_id'], '— код не выпущен:', e.message)
        raise ApiError('pay_bank', say('pay.bank_down', lang), 502)

    order = db.row('SELECT * FROM orders WHERE id=?', (order['id'],)) or order
    amount = qr['amount']
    total = max(0, int(order.get('price_total') or 0))
    return {
        'enabled': True,
        'provider': 'optima',
        'status': order['payment_status'],
        'transaction_id': qr['transaction_id'],
        'qr_base64': qr['qr_base64'],
        'qr_url': qr['qr_url'],
        'amount': amount,
        'sum': qr['sum'],
        'price_total': total,
        'cash_rest': max(0, total - amount),
        'created_at': qr['created_at'],
        'expires_at': qr['expires_at'],
        'poll_every_s': POLL_EVERY_S,
        'hint': say('pay.scan', lang),
        'note': say('pay.prepay', lang, sum=i18n.fmt_money(amount, lang)),
    }


@router.get(API + '/pay/{public_id}/status')
def pay_status(ctx, public_id):
    """Состояние оплаты для опроса с экрана.

    Заодно, не чаще раза в пятнадцать секунд, сами переспрашиваем банк: обратное
    уведомление может и не дойти, а экран клиента из-за этого висеть не должен.
    """
    order = _find(public_id)
    _check_token(ctx, order)
    lang = _lang(ctx, order)
    # Не чаще раза в две секунды на заказ: экран опрашивает статус раз в три,
    # так что в обычной жизни сюда никто не упирается.
    if not LIMIT.check('paystatus:%s' % order['public_id'], 1, STATUS_MIN_GAP_S):
        too_many(say('pay.too_often', lang))

    row = None
    if payments.provider() == 'optima' and order['payment_status'] == 'pending':
        order, row = payments.refresh_status(order)
    return _state_body(order, lang, row)


def _state_body(order, lang, row=None):
    body = payments.payment_view(order, row, lang)
    body['poll_every_s'] = POLL_EVERY_S
    return body


# ─────────────────────────────────────────────────────────────── уведомление банка

@router.post(API + '/pay/callback')
def callback(ctx):
    """Обратное уведомление Оптимы об оплате.

    Отвечаем так, как ждёт банк: 200 и тело с message, transactionId и receivedAt,
    а на беду — 400, 401 или 500. Повторное уведомление по той же транзакции
    получает те же 200 и ничего не меняет.
    """
    if not LIMIT.check('paycb:%s' % ctx.ip, CALLBACK_PER_MIN, 60):
        log('оплата: слишком много уведомлений с адреса', ctx.ip)
        return {'message': 'Слишком много запросов', 'transactionId': '',
                'receivedAt': payments.utc_stamp()}, 429

    raw = getattr(ctx, '_body', b'') or b''
    try:
        res = payments.optima.handle_callback(raw, ctx.header('Authorization'))
    except Exception as e:
        # Банк повторит уведомление, поэтому честно говорим «у нас беда», а не «ок».
        log('оплата: уведомление банка не обработано —', e)
        return {'message': 'Внутренняя ошибка сервиса', 'transactionId': '',
                'receivedAt': payments.utc_stamp()}, 500

    if res['state'] == 'paid':
        order = res.get('order') or {}
        log('оплата: бронь по заказу', order.get('public_id') or '—', 'подтверждена банком')
    return res['body'], res['http']


# ─────────────────────────────────────────────────────────────── админка

def _admin(ctx):
    return auth.require(ctx, 'admin')


def _callback_url(ctx):
    """Адрес, который владелец вписывает в кабинете Оптимы. Собираем из самого
    запроса: сервис может стоять и в корне домена, и в подпапке /go/."""
    base = str(settings.get('service.base_url', '') or '').strip().rstrip('/')
    if not base:
        proto = (ctx.header('X-Forwarded-Proto') or 'https').split(',')[0].strip() or 'https'
        host = (ctx.header('Host') or '').split(',')[0].strip()
        base = '%s://%s' % (proto, host) if host else ''
    prefix = str(getattr(getattr(ctx.h, 'app', None), 'base', '/') or '/').rstrip('/')
    return base + prefix + payments.CALLBACK_PATH


def _selected(points):
    """Что сейчас выбрано, с именами — админке показывать, а не голые коды."""
    cfg = payments.config()
    point = next((p for p in points if p['code'] == cfg['sale_point']), None)
    cash = None
    if point:
        cash = next((c for c in point['cashes'] if c['code'] == cfg['cash']), None)
    return {
        'sale_point': cfg['sale_point'], 'cash': cfg['cash'],
        'sale_point_name': point['name'] if point else '',
        'address': point['address'] if point else '',
        'cash_name': cash['name'] if cash else '',
    }


def _admin_body(ctx, points=None, extra=None):
    body = {
        'ok': True,
        'settings': payments.admin_view(),
        'callback_url': _callback_url(ctx),
        'points': points if points is not None else [],
        'prepay_example': _prepay_example(),
    }
    if points is not None:
        body['selected'] = _selected(points)
    if extra:
        body.update(extra)
    return body


def _prepay_example():
    """Живой пример для формы: сколько заплатит вперёд человек с заказа на 1500 сом."""
    sample = 150000
    amount = payments.prepay_amount({'price_total': sample, 'commission': 0})
    return {'order': sample, 'prepay': amount,
            'text': 'С заказа на %s клиент заплатит вперёд %s, остальное — курьеру наличными'
                    % (i18n.fmt_money(sample), i18n.fmt_money(amount))}


@router.get(API + '/admin/pay/settings')
def admin_settings_get(ctx):
    """Что настроено сейчас. Ключ и пароль не отдаём — только признак «задано»."""
    _admin(ctx)
    return _admin_body(ctx)


@router.get(API + '/admin/pay/sale-points')
def admin_sale_points(ctx):
    """Торговые точки и кассы компании. Руками их никто не вводит."""
    _admin(ctx)
    cfg = payments.config()
    if not (cfg['key'] and cfg['company']):
        return _admin_body(ctx, points=[], extra={
            'ok': False,
            'message': 'Сначала укажите API-ключ Оптимы и ID компании'})
    force = str(ctx.q('refresh') or '').lower() in ('1', 'true', 'yes')
    try:
        points = payments.optima.sale_points(force=force)
    except ApiError as e:
        return _admin_body(ctx, points=[], extra={'ok': False, 'message': e.message,
                                                  'code': e.code})
    payments.optima.autopick(points)
    return _admin_body(ctx, points=points, extra={
        'message': 'Точек: %d' % len(points)})


@router.post(API + '/admin/pay/test')
def admin_test(ctx):
    """Проверка связи с банком: понятный ответ вместо сырой ошибки."""
    user = _admin(ctx)
    if not LIMIT.check('paytest:%s' % user['id'], TEST_PER_MIN, 60):
        too_many('Слишком часто. Подождите минуту.')
    res = payments.test_connection()
    log('админ', user.get('email'), 'проверил связь с Оптимой:',
        'ок' if res['ok'] else res['message'])
    points = res.get('points') or []
    body = _admin_body(ctx, points=points, extra={'ok': res['ok'], 'message': res['message'],
                                                  'code': res.get('code')})
    if res.get('hint'):
        body['hint'] = res['hint']
    return body


@router.put(API + '/admin/pay/settings')
def admin_settings_put(ctx):
    """Сохранить реквизиты оплаты.

    Владелец вводит ровно два поля — ключ и ID компании. Точку и кассу мы тут же
    подтягиваем из банка сами, и если точка одна, выбираем её без вопросов.
    Пустое поле ключа означает «оставить как было»: иначе открытая форма затирала
    бы ключ каждым нажатием «Сохранить».
    """
    user = _admin(ctx)
    body = ctx.json
    save = {}

    key = str(body.get('key') or body.get('optima_key') or '').strip()
    if key:
        save['payment.optima_key'] = key[:200]

    if 'company' in body or 'optima_company' in body:
        company = str(body.get('company') or body.get('optima_company') or '').strip()
        if company and not company.isdigit():
            bad('ID компании — это число из кабинета Оптимы (legalPartyId)', 'bad_company')
        save['payment.optima_company'] = company[:32]

    if 'provider' in body:
        code = str(body.get('provider') or 'none').strip().lower()
        if code not in payments.PROVIDERS:
            bad('Такого способа оплаты нет: %s' % ', '.join(payments.PROVIDERS), 'bad_provider')
        save['payment.provider'] = code
    if 'enabled' in body:
        save['payment.enabled'] = _as_bool(body.get('enabled'))

    for field, key_name in (('sale_point', 'payment.optima_sale_point'),
                            ('cash', 'payment.optima_cash')):
        if field in body:
            save[key_name] = max(0, _as_int(body.get(field), field))

    if 'note' in body:
        save['payment.optima_note'] = str(body.get('note') or '').strip()[:100]
    if 'qr_ttl_s' in body:
        save['payment.qr_ttl_s'] = _clamp(_as_int(body.get('qr_ttl_s'), 'qr_ttl_s'), TTL_RANGE)

    prepay_min = prepay_max = None
    if 'prepay_min' in body:
        prepay_min = _clamp(_as_int(body.get('prepay_min'), 'prepay_min'), PREPAY_RANGE)
        save['payment.prepay_min'] = prepay_min
    if 'prepay_max' in body:
        prepay_max = _clamp(_as_int(body.get('prepay_max'), 'prepay_max'), PREPAY_RANGE)
        save['payment.prepay_max'] = prepay_max
    if 'prepay_percent' in body:
        save['payment.prepay_percent'] = _clamp(
            _as_int(body.get('prepay_percent'), 'prepay_percent'), PERCENT_RANGE)
    # Нижняя граница выше верхней — это опечатка, а не настройка: бронь тогда
    # не посчитается вовсе.
    low = prepay_min if prepay_min is not None else payments.config()['prepay_min']
    high = prepay_max if prepay_max is not None else payments.config()['prepay_max']
    if high > 0 and low > high:
        bad('Нижняя граница брони больше верхней — проверьте суммы', 'bad_prepay')

    fresh = None
    if _as_bool(body.get('generate_callback')):
        fresh = _new_callback_creds()
        save.update(fresh)

    if not save:
        bad('Нечего сохранять', 'empty')
    settings.put_many(save)
    log('админ', user.get('email'), 'сохранил настройки оплаты:',
        ', '.join(sorted(k for k in save if 'password' not in k and 'key' not in k)) or '—')

    points, message, ok = [], 'Сохранено', True
    cfg = payments.config()
    if cfg['key'] and cfg['company']:
        try:
            points = payments.optima.sale_points(force=True)
            point, cash, why = payments.optima.autopick(points)
            if point and cash:
                chosen = next((p for p in points if p['code'] == point), None)
                message = 'Сохранено. Работаем через «%s», касса %s' % (
                    chosen['name'] if chosen else point, cash)
            else:
                ok, message = False, 'Сохранено, но %s' % (why[0].lower() + why[1:] if why else
                                                           'точка продаж не выбрана')
        except ApiError as e:
            ok, message = False, 'Сохранено, но банк ответил: %s' % e.message
        except Exception as e:
            # Реквизиты уже сохранены. Потерять их из-за того, что банк молчит,
            # нельзя: владелец решит, что форма не работает, и введёт всё заново.
            log('оплата: точки продаж не забрались —', e)
            ok, message = False, 'Сохранено, но связаться с банком не вышло — проверьте ключ'

    extra = {'ok': ok, 'message': message, 'saved': sorted(save)}
    if fresh:
        # Пароль показывается ровно один раз — здесь. Дальше он живёт только в базе.
        extra['callback'] = {
            'login': fresh['payment.callback_login'],
            'password': fresh['payment.callback_password'],
            'url': _callback_url(ctx),
            'hint': 'Впишите этот адрес, логин и пароль в кабинете Оптимы — '
                    'банк будет стучаться сюда после каждой оплаты. '
                    'Пароль показывается один раз, сохраните его сейчас.',
        }
    return _admin_body(ctx, points=points, extra=extra)


def _new_callback_creds():
    """Логин и пароль для обратного уведомления. Придумывать их руками владельцу
    незачем — и не стоит: в кабинете банка это поле часто заполняют одним словом."""
    return {
        'payment.callback_login': 'sprintergo-%s' % secrets.token_hex(3),
        'payment.callback_password': secrets.token_urlsafe(18),
    }


# ─────────────────────────────────────────────────────────────── разбор полей

def _as_bool(v):
    return v if isinstance(v, bool) else str(v or '').strip().lower() in ('1', 'true', 'yes', 'on')


def _as_int(v, field):
    try:
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        raise ApiError('bad_field', 'Неверное значение поля «%s»' % field, 400, field=field)


def _clamp(value, bounds):
    return max(bounds[0], min(int(value), bounds[1]))


def register(app):
    """Подключение маршрутов оплаты к приложению."""
    app.router.include(router)
    return router
