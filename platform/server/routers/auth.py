# -*- coding: utf-8 -*-
"""Вход, регистрация курьера и восстановление пароля.

Здесь начинается работа человека с сервисом, поэтому каждая ошибка отвечает
по-человечески: что именно не так и что делать дальше. Одно исключение —
неверный пароль: там ответ намеренно общий, «неверная почта или пароль».
Если писать «такой почты нет», по форме входа можно собрать список курьеров.

Частота запросов ограничена: пять попыток входа за пять минут на пару
IP + почта и три регистрации в час с одного адреса. Этого хватает, чтобы
перебор пароля стал бессмысленным, и не мешает живому человеку, который
опечатался пару раз.
"""
from urllib.parse import urlparse

from .. import auth, db, mailer, settings
from ..core import ApiError, LIMIT, Router, bad, log, too_many

router = Router()
API = '/api/v1'

# ── ограничения частоты ──────────────────────────────────────────────────────
LOGIN_TRIES, LOGIN_WINDOW = 5, 300
REG_TRIES, REG_WINDOW = 3, 3600
FORGOT_TRIES, FORGOT_WINDOW = 3, 3600

# Габариты кузова в сантиметрах: больше пяти метров в длину — это уже фура,
# такие заказы сервис не возит, и скорее всего человек ошибся полем.
BODY_LIMITS = {'body_w': 400, 'body_d': 900, 'body_h': 400}
MAX_CAPACITY_KG = 20000


def mount(app):
    """Подключить маршруты к приложению — вызывается из app.py."""
    app.router.include(router)
    return router


# ─────────────────────────────────────────────────────────────── помощники

def _base_url(ctx):
    """Адрес сервиса для ссылок в письмах. Берём из запроса: сервис может стоять
    и на домене, и на IP с нестандартным портом, прописывать это руками негде."""
    origin = (ctx.header('Origin') or '').strip()
    if origin.startswith('http'):
        return origin.rstrip('/')
    ref = (ctx.header('Referer') or '').strip()
    if ref.startswith('http'):
        u = urlparse(ref)
        if u.scheme and u.netloc:
            return '%s://%s' % (u.scheme, u.netloc)
    host = (ctx.header('X-Forwarded-Host') or ctx.header('Host') or '').strip()
    scheme = (ctx.header('X-Forwarded-Proto') or 'http').split(',')[0].strip()
    return ('%s://%s' % (scheme, host)).rstrip('/') if host else ''


def _vehicle_classes():
    """Классы машин, под которые есть тарифы. Курьер с классом «мотоцикл»
    не получит ни одного предложения — такой выбор надо ловить сразу."""
    return {r['vehicle_class'] for r in
            db.rows('SELECT DISTINCT vehicle_class FROM tariffs WHERE active=1')
            if r['vehicle_class']}


def _need_vehicle_class(value):
    known = _vehicle_classes()
    v = str(value or '').strip()
    if not v:
        raise ApiError('field_required', 'Выберите класс машины', 400, field='vehicle_class')
    if known and v not in known:
        raise ApiError('bad_vehicle_class',
                       'Такого класса машины в сервисе нет, выберите из списка', 400,
                       field='vehicle_class', allowed=sorted(known))
    return v


def _plate(value):
    """Госномер: без пробелов и в верхнем регистре. «01 kg 762 atn» и «01KG762ATN» —
    один и тот же номер, и искать его в админке надо одинаково."""
    raw = ''.join(str(value or '').split()).upper().replace('-', '')
    if len(raw) < 5 or len(raw) > 12 or not raw.isalnum():
        raise ApiError('bad_plate', 'Госномер написан неправильно', 400, field='car_plate')
    return raw


def _size(ctx, name, limit):
    v = ctx.field(name, int, default=None)
    if v is None:
        return None
    if v <= 0 or v > limit:
        raise ApiError('bad_field', 'Проверьте размеры кузова, они в сантиметрах',
                       400, field=name)
    return v


def _capacity(ctx, required=False):
    v = ctx.need('capacity_kg', int) if required else ctx.field('capacity_kg', int, default=None)
    if v is None:
        return None
    if v <= 0 or v > MAX_CAPACITY_KG:
        raise ApiError('bad_field', 'Грузоподъёмность указана в килограммах', 400,
                       field='capacity_kg')
    return v


def _lang(ctx, default='ru'):
    v = str(ctx.field('lang', str, 2) or '').lower()
    return v if v in ('ru', 'ky') else default


def _me(user):
    """Ответ про себя. Кладём человека и плоско, и в ключ user — приложению
    удобно любым способом, а лишние полкилобайта тут никому не мешают."""
    data = auth.user_public(user)
    return dict(data, user=data)


def _mail(to, template, vars, lang):
    """Письмо не должно ронять запрос: почтовик может лежать, а курьер —
    зарегистрироваться. Ошибку пишем в лог и живём дальше."""
    try:
        return mailer.send(to, template, vars, lang)
    except Exception as e:
        log('почта: письмо', template, 'для', to, 'не ушло —', e)
        return False


# ─────────────────────────────────────────────────────────────── регистрация

@router.post(API + '/auth/register')
def register(ctx):
    """Анкета курьера: человек, машина, связь. Пароль сразу в хеш, в базе его нет."""
    if not settings.get_bool('security.allow_registration', True):
        raise ApiError('registration_closed', 'Регистрация временно закрыта. '
                                              'Позвоните в поддержку, оформим вручную', 403)
    email = auth.need_email(ctx.need('email'))
    password = auth.check_password_rules(ctx.need('password'))
    name = ctx.need('name', str, 80)
    phone = auth.need_phone(ctx.need('phone'))
    vehicle_class = _need_vehicle_class(ctx.need('vehicle_class'))
    car_model = ctx.need('car_model', str, 60)
    car_plate = _plate(ctx.need('car_plate'))
    car_color = ctx.field('car_color', str, 30, '') or ''
    capacity = _capacity(ctx, required=True)
    body = {k: _size(ctx, k, v) for k, v in BODY_LIMITS.items()}

    # Счётчик тратим только на заполненную анкету: человек, ошибившийся в почте,
    # не должен из-за этого ждать час.
    if not LIMIT.check('reg:%s' % ctx.ip, REG_TRIES, REG_WINDOW):
        too_many('Слишком много анкет с одного устройства. Попробуйте через час')

    if db.row('SELECT id FROM users WHERE email=?', (email,)):
        raise ApiError('email_taken', 'На эту почту уже есть аккаунт. Попробуйте войти', 409)
    busy = db.row('SELECT u.id FROM couriers c JOIN users u ON u.id=c.user_id '
                  'WHERE c.car_plate=?', (car_plate,))
    if busy:
        raise ApiError('plate_taken', 'Машина с таким госномером уже зарегистрирована', 409)

    moderation = settings.get_bool('security.require_moderation', True)
    status = 'pending' if moderation else 'active'
    lang = _lang(ctx)
    t = db.now()

    with db.tx():
        # Повторная проверка под замком: две анкеты могли уйти одновременно.
        if db.row('SELECT id FROM users WHERE email=?', (email,)):
            raise ApiError('email_taken', 'На эту почту уже есть аккаунт. Попробуйте войти', 409)
        user_id = db.insert('users', {
            'role': 'courier', 'email': email, 'phone': phone, 'name': name,
            'password_hash': auth.hash_password(password), 'status': status,
            'lang': lang, 'created_at': t,
        })
        db.insert('couriers', {
            'user_id': user_id, 'vehicle_class': vehicle_class, 'car_model': car_model,
            'car_plate': car_plate, 'car_color': car_color, 'capacity_kg': capacity,
            'body_w': body['body_w'], 'body_d': body['body_d'], 'body_h': body['body_h'],
            'online': 0, 'busy': 0,
        })

    user = db.row('SELECT * FROM users WHERE id=?', (user_id,))
    log('регистрация курьера:', name, email, car_plate,
        '— на проверке' if moderation else '— сразу в работу')

    base = _base_url(ctx)
    if moderation:
        _mail(email, 'courier_welcome',
              {'name': name, 'car': car_model, 'plate': car_plate, 'phone': phone}, lang)
        return {
            'ok': True, 'moderation': True, 'status': status,
            'message': 'Анкета принята. Проверим документы и напишем на почту — '
                       'обычно это пара часов.',
            'user': auth.user_public(user),
        }, 201

    _mail(email, 'courier_approved',
          {'name': name, 'url': base + '/courier' if base else ''}, lang)
    session = auth.create_session(user_id, ctx.header('User-Agent'), ctx.ip)
    db.update('users', {'last_login_at': t}, 'id=?', (user_id,))
    user['last_login_at'] = t
    return {'ok': True, 'moderation': False, 'token': session['token'],
            'expires_at': session['expires_at'], 'user': auth.user_public(user)}, 201


# ─────────────────────────────────────────────────────────────── вход и выход

@router.post(API + '/auth/login')
def login(ctx):
    email = str(ctx.need('email')).strip().lower()
    password = ctx.need('password')

    if not LIMIT.check('login:%s:%s' % (ctx.ip, email), LOGIN_TRIES, LOGIN_WINDOW):
        too_many('Слишком много попыток входа. Подождите пять минут')

    user = db.row('SELECT * FROM users WHERE email=?', (email,))
    if not user or not user['password_hash'] or user['role'] not in auth.ROLES:
        raise ApiError('wrong_login', 'Неверная почта или пароль', 401)
    if not auth.verify_password(password, user['password_hash']):
        log('вход: неверный пароль для', email, 'с', ctx.ip)
        raise ApiError('wrong_login', 'Неверная почта или пароль', 401)

    if user['status'] == 'pending':
        raise ApiError('moderation',
                       'Анкета ещё на проверке. Как только всё подтвердим, напишем на почту '
                       'и доступ откроется', 403)
    if user['status'] != 'active':
        raise ApiError('blocked', 'Аккаунт заблокирован. Напишите в поддержку, разберёмся', 403)

    # Параметры хеширования могли подрасти — тихо пересчитываем, пароль в руках.
    if auth.needs_rehash(user['password_hash']):
        db.update('users', {'password_hash': auth.hash_password(password)},
                  'id=?', (user['id'],))

    t = db.now()
    db.update('users', {'last_login_at': t}, 'id=?', (user['id'],))
    user['last_login_at'] = t
    session = auth.create_session(user['id'], ctx.header('User-Agent'), ctx.ip)
    log('вход:', user['role'], email)
    return {'token': session['token'], 'expires_at': session['expires_at'],
            'user': auth.user_public(user)}


@router.post(API + '/auth/logout')
def logout(ctx):
    """Выход не спорит: даже если токен уже протух, ответ один — «вышли»."""
    auth.destroy_session(auth.token_from(ctx))
    return {'ok': True}


@router.get(API + '/auth/me')
def me(ctx):
    return _me(auth.require(ctx))


@router.patch(API + '/auth/me')
def update_me(ctx):
    """Что человек меняет сам: имя, телефон, язык, данные машины и пароль.
    Почта остаётся: это логин, и менять его должен админ, чтобы не потерять аккаунт."""
    user = auth.require(ctx)
    fields, courier = {}, {}

    if 'name' in ctx.json:
        fields['name'] = ctx.need('name', str, 80)
    if 'phone' in ctx.json:
        fields['phone'] = auth.need_phone(ctx.need('phone'))
    if 'lang' in ctx.json:
        fields['lang'] = _lang(ctx, user['lang'] or 'ru')
    if 'avatar' in ctx.json:
        fields['avatar'] = ctx.field('avatar', str, 300, '') or None

    if user['role'] == 'courier':
        if 'car_model' in ctx.json:
            courier['car_model'] = ctx.need('car_model', str, 60)
        if 'car_plate' in ctx.json:
            plate = _plate(ctx.need('car_plate'))
            taken = db.row('SELECT user_id FROM couriers WHERE car_plate=? AND user_id<>?',
                           (plate, user['id']))
            if taken:
                raise ApiError('plate_taken', 'Эта машина уже за другим курьером', 409)
            courier['car_plate'] = plate
        if 'car_color' in ctx.json:
            courier['car_color'] = ctx.field('car_color', str, 30, '') or ''
        if 'vehicle_class' in ctx.json:
            courier['vehicle_class'] = _need_vehicle_class(ctx.need('vehicle_class'))
        if 'capacity_kg' in ctx.json:
            courier['capacity_kg'] = _capacity(ctx)
        for name, limit in BODY_LIMITS.items():
            if name in ctx.json:
                courier[name] = _size(ctx, name, limit)

    new_password = ctx.field('password', str, auth.MAX_PASSWORD)
    if new_password:
        current = ctx.field('current_password', str, auth.MAX_PASSWORD) or \
            ctx.field('old_password', str, auth.MAX_PASSWORD)
        if not auth.verify_password(current, user['password_hash']):
            raise ApiError('wrong_password', 'Текущий пароль не подошёл', 403,
                           field='current_password')
        auth.check_password_rules(new_password)
        fields['password_hash'] = auth.hash_password(new_password)

    if not fields and not courier:
        bad('Менять нечего: в запросе нет ни одного знакомого поля')

    with db.tx():
        if fields:
            db.update('users', fields, 'id=?', (user['id'],))
        if courier:
            db.update('couriers', courier, 'user_id=?', (user['id'],))

    if 'password_hash' in fields:
        # Пароль сменили — остальные устройства пусть заходят заново.
        auth.destroy_user_sessions(user['id'], keep_token=auth.token_from(ctx))

    return _me(db.row('SELECT * FROM users WHERE id=?', (user['id'],)))


# ─────────────────────────────────────────────────────────────── пароль по почте

@router.post(API + '/auth/password/forgot')
def forgot(ctx):
    """Письмо со ссылкой на смену пароля.

    Ответ всегда одинаковый, есть такая почта в базе или нет: иначе форму
    «забыли пароль» можно превратить в проверку, кто у нас работает.
    """
    email = str(ctx.need('email')).strip().lower()
    if not LIMIT.check('forgot:%s' % ctx.ip, FORGOT_TRIES, FORGOT_WINDOW) or \
       not LIMIT.check('forgot:%s' % email, FORGOT_TRIES, FORGOT_WINDOW):
        too_many('Мы уже отправили письмо. Проверьте почту, в том числе папку «Спам»')

    if not mailer.enabled():
        # Честно говорим, что письмо не уйдёт: иначе человек будет ждать его вечно.
        # Проверяем до поиска в базе — по коду ответа не должно быть видно,
        # есть у нас такая почта или нет.
        raise ApiError('mail_off', 'Почта в сервисе пока не настроена. '
                                   'Позвоните в поддержку, поможем со входом', 503)

    answer = {'ok': True,
              'message': 'Если такая почта у нас есть, письмо со ссылкой уже в пути. '
                         'Ссылка живёт час.'}
    user = db.row('SELECT * FROM users WHERE email=?', (email,))
    if not user or user['status'] == 'blocked' or user['role'] not in auth.ROLES:
        return answer

    token = auth.create_reset(user['id'])
    base = _base_url(ctx)
    page = '/admin' if user['role'] == 'admin' else '/courier'
    url = '%s%s?reset=%s' % (base, page, token) if base else ''
    _mail(email, 'password_reset',
          {'name': user['name'], 'email': email, 'url': url}, user['lang'] or 'ru')
    log('сброс пароля: письмо для', email)
    return answer


@router.post(API + '/auth/password/reset')
def reset(ctx):
    token = ctx.need('token', str, 400)
    password = ctx.need('password', str, auth.MAX_PASSWORD)
    if not LIMIT.check('reset:%s' % ctx.ip, 10, 3600):
        too_many('Слишком много попыток. Запросите новое письмо через час')

    user = auth.use_reset(token, password)
    if not user:
        raise ApiError('reset_expired', 'Ссылка устарела, запросите новую', 400)
    log('сброс пароля: новый пароль у', user['email'])

    if user['status'] != 'active':
        return {'ok': True, 'moderation': user['status'] == 'pending',
                'message': 'Пароль изменён. Войти можно будет, как только аккаунт одобрят.'}

    session = auth.create_session(user['id'], ctx.header('User-Agent'), ctx.ip)
    return {'ok': True, 'token': session['token'], 'expires_at': session['expires_at'],
            'user': auth.user_public(user),
            'message': 'Пароль изменён, вы вошли в приложение.'}


@router.get(API + '/auth/password/check')
def check_reset_link(ctx):
    """Приложение спрашивает, жива ли ссылка из письма, — чтобы показать форму
    смены пароля, а не ловить ошибку уже после ввода нового пароля."""
    user = auth.check_reset((ctx.q('token') or '').strip())
    if not user:
        raise ApiError('reset_expired', 'Ссылка устарела, запросите новую', 400)
    return {'ok': True, 'email': user['email'], 'name': user['name']}


@router.post(API + '/auth/conflict-check')
def conflict_check(ctx):
    """Свободна ли почта. Отвечаем только «да/нет» и только на осмысленный адрес —
    форма регистрации подсвечивает занятую почту, не дожидаясь отправки."""
    if not LIMIT.check('check:%s' % ctx.ip, 30, 600):
        too_many('Слишком часто, подождите немного')
    email = auth.normalize_email(ctx.need('email'))
    if not email:
        raise ApiError('bad_email', 'Проверьте адрес почты', 400, field='email')
    taken = bool(db.row('SELECT id FROM users WHERE email=?', (email,)))
    return {'email': email, 'free': not taken}
