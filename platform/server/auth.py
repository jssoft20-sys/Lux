# -*- coding: utf-8 -*-
"""Пароли, сессии и проверка прав.

Пароль хранится только в виде scrypt-хеша: 16 байт случайной соли на каждого
человека, параметры прямо в строке. Параметры в строке — чтобы завтра их можно
было поднять (машины становятся быстрее), а старые пароли продолжали работать:
проверка читает n, r и p из самой записи.

Сессия — 32 случайных байта. В базе лежит только sha256 от токена: если кто-то
доберётся до файла базы, войти по украденной строке он не сможет. Токен приходит
в заголовке Authorization: Bearer, а для потока событий — в параметре token:
EventSource в браузере заголовки ставить не умеет.
"""
import hashlib
import hmac
import re
import secrets

from . import db, settings
from .core import ApiError, forbidden, unauthorized

# ─────────────────────────────────────────────────────────────── параметры

# 2**14 × 8 × 1 — это примерно 16 МБ памяти и десятки миллисекунд на проверку.
# Человек задержки не заметит, а перебор по словарю становится бессмысленным.
SCRYPT_N = 2 ** 14
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16
KEY_BYTES = 32
SCRYPT_MAXMEM = 96 * 1024 * 1024      # запас над 16 МБ: иначе OpenSSL откажет

TOKEN_BYTES = 32
MIN_PASSWORD = 8
MAX_PASSWORD = 200                    # длиннее считать бессмысленно, а память жрёт
RESET_TTL_S = 3600                    # ссылка на смену пароля живёт час

ROLES = ('admin', 'courier')

EMAIL_RX = re.compile(
    r'^[A-Za-z0-9._%+\-]{1,64}@'
    r'[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?'
    r'(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?)*'
    r'\.[A-Za-z]{2,24}$')


# ─────────────────────────────────────────────────────────────── пароли

def hash_password(password):
    """Пароль → строка вида scrypt$n$r$p$соль$хеш. Больше о пароле нигде ничего нет."""
    raw = _password_bytes(password)
    salt = secrets.token_bytes(SALT_BYTES)
    key = hashlib.scrypt(raw, salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P,
                         maxmem=SCRYPT_MAXMEM, dklen=KEY_BYTES)
    return 'scrypt$%d$%d$%d$%s$%s' % (SCRYPT_N, SCRYPT_R, SCRYPT_P,
                                      salt.hex(), key.hex())


def verify_password(password, stored):
    """Сверка пароля с записью из базы.

    Сравниваем через compare_digest: обычное == выходит из цикла на первом
    несовпавшем байте, и по времени ответа можно подбирать хеш по байту.
    """
    if not password or not stored:
        return False
    try:
        algo, n, r, p, salt_hex, key_hex = str(stored).split('$')
        if algo != 'scrypt':
            return False
        n, r, p = int(n), int(r), int(p)
        salt, expect = bytes.fromhex(salt_hex), bytes.fromhex(key_hex)
    except (ValueError, TypeError):
        return False
    if not salt or not expect or n < 2 or r < 1 or p < 1:
        return False
    try:
        key = hashlib.scrypt(_password_bytes(password), salt=salt, n=n, r=r, p=p,
                             maxmem=SCRYPT_MAXMEM, dklen=len(expect))
    except ValueError:
        return False                    # параметры из базы не по зубам этой сборке
    return hmac.compare_digest(key, expect)


def needs_rehash(stored):
    """Пароль записан старыми параметрами — стоит пересчитать при следующем входе."""
    try:
        algo, n, r, p, _, _ = str(stored or '').split('$')
    except ValueError:
        return True
    return (algo != 'scrypt' or int(n) != SCRYPT_N
            or int(r) != SCRYPT_R or int(p) != SCRYPT_P)


def _password_bytes(password):
    if isinstance(password, bytes):
        return password[:MAX_PASSWORD * 4]
    return str(password or '')[:MAX_PASSWORD].encode('utf-8')


def check_password_rules(password):
    """Требование одно и понятное: восемь символов. Заставлять человека городить
    «Заглавную+цифру+знак» бессмысленно — он допишет «1!» в конец и всё."""
    pw = str(password or '')
    if len(pw.strip()) < MIN_PASSWORD:
        raise ApiError('password_short',
                       'Пароль должен быть не короче %d символов' % MIN_PASSWORD, 400,
                       field='password')
    if len(pw) > MAX_PASSWORD:
        raise ApiError('password_long', 'Пароль слишком длинный', 400, field='password')
    return pw


# ─────────────────────────────────────────────────────────────── почта и телефон

def valid_email(value):
    email = str(value or '').strip()
    return bool(email) and len(email) <= 254 and bool(EMAIL_RX.match(email))


def normalize_email(value):
    """Почту приводим к нижнему регистру: «Talgat@Mail.kg» и «talgat@mail.kg» —
    один и тот же человек, и войти он должен любым написанием."""
    email = str(value or '').strip().lower()
    return email if valid_email(email) else None


def normalize_phone(value):
    """Кыргызский номер к международному виду: 0700112233 → +996700112233.

    Принимаем как привыкли писать люди: с +996, с 996, с восьмёрки-нуля,
    со скобками, пробелами и дефисами. Не разобрали — возвращаем None,
    гадать не надо: телефон единственный способ дозвониться до клиента.
    """
    digits = re.sub(r'\D', '', str(value or ''))
    if not digits:
        return None
    if digits.startswith('00'):
        digits = digits[2:]
    if len(digits) == 12 and digits.startswith('996'):
        national = digits[3:]
    elif len(digits) == 10 and digits.startswith('0'):
        national = digits[1:]
    elif len(digits) == 9:
        national = digits
    else:
        return None
    if national[0] == '0':
        return None
    return '+996' + national


def need_email(value, field='email'):
    email = normalize_email(value)
    if not email:
        raise ApiError('bad_email', 'Проверьте адрес почты', 400, field=field)
    return email


def need_phone(value, field='phone'):
    phone = normalize_phone(value)
    if not phone:
        raise ApiError('bad_phone', 'Телефон не похож на кыргызский номер', 400, field=field)
    return phone


# ─────────────────────────────────────────────────────────────── сессии

def _hash_token(token):
    return hashlib.sha256(str(token or '').encode('utf-8')).hexdigest()


def session_ttl():
    days = settings.get_int('security.session_days', 30)
    return max(1, days) * 86400


def create_session(user_id, ua=None, ip=None):
    """Новая сессия. Наружу уходит {'token', 'expires_at'} — токен человек больше
    нигде не увидит, в базе от него остаётся только отпечаток."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    t = db.now()
    expires = t + session_ttl()
    db.insert('sessions', {
        'token_hash': _hash_token(token), 'user_id': int(user_id),
        'created_at': t, 'expires_at': expires,
        'ua': str(ua or '')[:200], 'ip': str(ip or '')[:64],
    })
    # Чтобы таблица не росла годами: чистим протухшее этого же человека.
    db.execute('DELETE FROM sessions WHERE user_id=? AND expires_at < ?', (int(user_id), t))
    return {'token': token, 'expires_at': expires}


def destroy_session(token):
    """Выход. Возвращает True, если сессия была живой."""
    if not token:
        return False
    return db.execute('DELETE FROM sessions WHERE token_hash=?',
                      (_hash_token(token),)).rowcount > 0


def destroy_user_sessions(user_id, keep_token=None):
    """Разлогинить со всех устройств — после смены пароля это обязательно."""
    if keep_token:
        return db.execute('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',
                          (int(user_id), _hash_token(keep_token))).rowcount
    return db.execute('DELETE FROM sessions WHERE user_id=?', (int(user_id),)).rowcount


def session_by_token(token):
    if not token:
        return None
    return db.row('SELECT * FROM sessions WHERE token_hash=?', (_hash_token(token),))


def token_from(ctx):
    """Токен из заголовка Authorization, а для SSE — из параметра token:
    EventSource заголовки ставить не умеет, и это не обойти."""
    raw = ctx.header('Authorization') or ''
    if raw[:7].lower() == 'bearer ':
        token = raw[7:].strip()
        if token:
            return token
    return (ctx.q('token') or '').strip() or None


def _touch(session, t):
    """Продлеваем сессию, когда прошла половина срока. Писать в базу на каждый
    запрос курьера (а он шлёт геопозицию каждые пять секунд) — лишняя работа."""
    ttl = session_ttl()
    if session['expires_at'] - t > ttl // 2:
        return session['expires_at']
    expires = t + ttl
    db.execute('UPDATE sessions SET expires_at=? WHERE token_hash=?',
               (expires, session['token_hash']))
    return expires


def require(ctx, role=None):
    """Пускаем дальше только своих: живая сессия, активный аккаунт, нужная роль.

    Проставляет ctx.user и ctx.session, возвращает пользователя. Любая заминка —
    исключение с понятным кодом, чтобы приложение показало нужный экран,
    а не общее «что-то пошло не так».
    """
    token = token_from(ctx)
    if not token:
        unauthorized('Нужно войти в приложение')

    session = session_by_token(token)
    if not session:
        raise ApiError('session_expired', 'Сессия закончилась, войдите заново', 401)

    t = db.now()
    if session['expires_at'] <= t:
        db.execute('DELETE FROM sessions WHERE token_hash=?', (session['token_hash'],))
        raise ApiError('session_expired', 'Сессия закончилась, войдите заново', 401)

    user = db.row('SELECT * FROM users WHERE id=?', (session['user_id'],))
    if not user:
        db.execute('DELETE FROM sessions WHERE token_hash=?', (session['token_hash'],))
        raise ApiError('session_expired', 'Аккаунт больше не существует', 401)

    if user['status'] == 'blocked':
        raise ApiError('blocked', 'Аккаунт заблокирован. Напишите в поддержку, разберёмся', 403)
    if user['status'] != 'active':
        raise ApiError('moderation',
                       'Аккаунт ещё на проверке. Мы напишем, как только всё проверим', 403)

    if role:
        allowed = (role,) if isinstance(role, str) else tuple(role)
        if user['role'] not in allowed:
            forbidden('Этот раздел не для вашей роли')

    session['expires_at'] = _touch(session, t)
    ctx.user, ctx.session = user, session
    return user


def optional(ctx, role=None):
    """То же самое, но без токена просто возвращает None — для страниц,
    которые открыты всем, но вошедшему показывают больше."""
    if not token_from(ctx):
        return None
    try:
        return require(ctx, role)
    except ApiError:
        return None


# ─────────────────────────────────────────────────────────────── смена пароля по почте

def create_reset(user_id):
    """Одноразовый код для ссылки из письма. Старые коды человека гасим:
    если он нажал «забыл пароль» дважды, работать должно последнее письмо."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    t = db.now()
    db.execute('DELETE FROM reset_tokens WHERE user_id=? OR expires_at < ?', (int(user_id), t))
    db.insert('reset_tokens', {
        'token_hash': _hash_token(token), 'user_id': int(user_id),
        'created_at': t, 'expires_at': t + RESET_TTL_S, 'used': 0,
    })
    return token


def check_reset(token):
    """Пользователь по коду из письма или None, если код не годится."""
    if not token:
        return None
    row = db.row('SELECT * FROM reset_tokens WHERE token_hash=?', (_hash_token(token),))
    if not row or row['used'] or row['expires_at'] <= db.now():
        return None
    return db.row('SELECT * FROM users WHERE id=?', (row['user_id'],))


def use_reset(token, password):
    """Меняем пароль по коду из письма и гасим все сессии: если пароль сбрасывают,
    значит, доступ мог утечь, и старые входы надо оборвать."""
    check_password_rules(password)
    token_hash = _hash_token(token)
    with db.tx():
        row = db.row('SELECT * FROM reset_tokens WHERE token_hash=?', (token_hash,))
        if not row or row['used'] or row['expires_at'] <= db.now():
            raise ApiError('reset_expired', 'Ссылка устарела, запросите новую', 400)
        db.execute('UPDATE reset_tokens SET used=1 WHERE token_hash=?', (token_hash,))
        db.execute('UPDATE users SET password_hash=? WHERE id=?',
                   (hash_password(password), row['user_id']))
        db.execute('DELETE FROM sessions WHERE user_id=?', (row['user_id'],))
    return db.row('SELECT * FROM users WHERE id=?', (row['user_id'],))


# ─────────────────────────────────────────────────────────────── люди наружу

def rating_of(rating_sum, rating_count):
    """Курьеру без оценок ставим пятёрку: он ещё ничем не провинился."""
    if not rating_count:
        return 5.0
    return round(rating_sum / float(rating_count), 2)


def courier_profile(user_id):
    """Анкета курьера: машина, статистика, где он сейчас."""
    c = db.row('SELECT * FROM couriers WHERE user_id=?', (int(user_id),))
    if not c:
        return None
    sent, taken = c['offers_sent'] or 0, c['offers_taken'] or 0
    return {
        'vehicle_class': c['vehicle_class'],
        'car': {'model': c['car_model'], 'plate': c['car_plate'], 'color': c['car_color'],
                'class': c['vehicle_class']},
        'body': {'w': c['body_w'], 'd': c['body_d'], 'h': c['body_h']},
        'capacity_kg': c['capacity_kg'],
        'rating': rating_of(c['rating_sum'], c['rating_count']),
        'rating_count': c['rating_count'],
        'orders_done': c['orders_done'],
        'orders_cancelled': c['orders_cancelled'],
        'offers_sent': sent, 'offers_taken': taken,
        'acceptance': round(taken / float(sent), 2) if sent else None,
        'online': bool(c['online']), 'busy': bool(c['busy']),
        'priority': c['priority'],
        'at': [c['lat'], c['lng']] if c['lat'] is not None else None,
        'heading': c['heading'], 'speed': c['speed'], 'geo_at': c['geo_at'],
        'balance': c['balance'],
    }


def user_public(user, with_profile=True):
    """Человек в том виде, в каком его можно отдать в браузер. Хеша пароля здесь нет."""
    if not user:
        return None
    out = {
        'id': user['id'], 'role': user['role'], 'email': user['email'],
        'phone': user['phone'], 'name': user['name'], 'avatar': user['avatar'],
        'status': user['status'], 'lang': user['lang'] or 'ru',
        'created_at': user['created_at'], 'last_login_at': user['last_login_at'],
    }
    if with_profile and user['role'] == 'courier':
        out['courier'] = courier_profile(user['id'])
    return out
