# -*- coding: utf-8 -*-
"""Дополнения второй версии: чат по заказу, профиль клиента, проверка курьера, зоны спроса.

Четыре разных дела собраны в один модуль по одной причине: все они держатся на
том, что уже есть, и ничего не меняют в готовых файлах. Заказ, курьер и клиент
остаются такими же, как были, — здесь только новые разговоры вокруг них.

Как узнаём, кто пришёл:

* клиент по заказу — пара «публичный номер + токен отслеживания», как в public.py;
* клиент по себе — clients.token: 32 случайных байта, которые фронт хранит у себя.
  Регистрации у клиента нет и не будет, телефон — не пароль, поэтому токен
  выдаётся только тому, кто предъявил свой заказ вместе с его токеном;
* курьер и админ — обычная сессия, заголовок Authorization: Bearer.

Отдельно про фото с паспортом. Оно лежит в той же папке, что и аватары, но
видеть его могут только сам курьер и администратор: файл отдаётся через
/api/v1/uploads/{name} с проверкой прав на каждый запрос, а имя проверяется
по шаблону — из папки с загрузками наружу не выйти.
"""
import hashlib
import hmac
import math
import re
import secrets
import sqlite3
import threading

from .. import auth, db, i18n_server as i18n, settings, uploads
from ..core import (HUB, LIMIT, ApiError, Router, bad, conflict, forbidden, log,
                    not_found, too_many, unauthorized)

API = '/api/v1'
router = Router()

# ── чат ──────────────────────────────────────────────────────────────────────
MAX_TEXT = 1000               # длиннее в чате никто не пишет, а место занимает
MSG_PER_MIN = 30              # с одной стороны одного заказа
MSG_PAGE = 100
MSG_PAGE_MAX = 300
CHAT_TAIL_S = 86400           # сутки после закрытия заказа переписка ещё открыта

# ── клиент ───────────────────────────────────────────────────────────────────
CLIENT_TOKEN_BYTES = 32       # 64 знака в шестнадцатеричной записи
CLIENT_TOKEN_RX = re.compile(r'^[0-9a-f]{32,80}$')
ORDERS_PAGE = 20
ORDERS_PAGE_MAX = 50
CLAIM_PER_HOUR = 10

# Заказы, которые ещё в работе: их приложение показывает клиенту сразу при входе.
LIVE_STATUSES = ('draft', 'searching', 'assigned', 'to_pickup',
                 'at_pickup', 'in_transit', 'at_dropoff')

# Статусы, в которых клиент уже видит, кто к нему едет.
WITH_COURIER = ('assigned', 'to_pickup', 'at_pickup', 'in_transit', 'at_dropoff', 'done')

# ── фото ─────────────────────────────────────────────────────────────────────
VERIFY_PREFIX = 'doc'         # фото с паспортом: чужим глазам не отдаём
AVATAR_PREFIX = 'ava'         # аватар курьера: его видит клиент на карте
VERIFY_PER_HOUR = 6
AVATAR_PER_HOUR = 12
VERIFY_STATUSES = ('none', 'pending', 'approved', 'rejected')

# ── зоны спроса ──────────────────────────────────────────────────────────────
ZONE_CELL_M = 700             # сторона ячейки: крупнее квартала, мельче района
ZONE_WINDOW_S = 3 * 3600      # спрос считаем по трём последним часам
ZONE_TTL_S = 60               # чаще раза в минуту пересчитывать нечего
ZONE_MIN_ORDERS = 2           # одинокий заказ — это не зона спроса
ZONE_MIN_TOTAL = 4            # и по трём заказам на город рисовать нечего
ZONE_MAX_CELLS = 40
ZONE_MIN_LEVEL = 0.15

# Черновики не считаем: заказ, за который не заплатили, спроса не показывает.
ZONE_STATUSES = ('searching', 'assigned', 'to_pickup', 'at_pickup', 'in_transit',
                 'at_dropoff', 'done', 'cancelled', 'expired')


# ─────────────────────────────────────────────────────────────── свои фразы

# Тексты только этих экранов. В общий словарь их не тащим: там правки соседних
# модулей, а здесь всё на месте и видно рядом с кодом. Первый вариант русский,
# второй кыргызский.
SAY = {
    'chat.closed': ('Заказ закрылся больше суток назад, переписка уже закрыта. '
                    'Если остался вопрос — позвоните {phone}.',
                    'Заказ жабылганына бир суткадан ашты, жазышуу жабык. '
                    'Суроо калса {phone} номерине чалыңыз.'),
    'chat.empty': ('Пустое сообщение не отправится.',
                   'Бош билдирүү жөнөтүлбөйт.'),
    'chat.too_often': ('Слишком много сообщений подряд. Подождите минуту.',
                       'Удаа көп билдирүү жөнөттүңүз. Бир мүнөт күтө туруңуз.'),
    'chat.waiting': ('Машина ещё ищется. Сообщение сохранится, курьер прочитает его сразу,'
                     ' как возьмёт заказ.',
                     'Унаа изделип жатат. Билдирүү сакталат, курьер заказды алганда дароо окуйт.'),
    'track.wrong': ('Ссылка на заказ не подходит. Откройте заказ по своей ссылке '
                    'или позвоните {phone}.',
                    'Заказдын шилтемеси туура келбейт. Өз шилтемеңиз менен ачыңыз '
                    'же {phone} номерине чалыңыз.'),
    'client.unknown': ('Не узнаём вас. Откройте свой заказ по ссылке из смс — '
                       'и профиль вернётся.',
                       'Сизди тааныбай турабыз. Заказыңызды смстеги шилтеме менен ачыңыз — '
                       'профиль кайра келет.'),
    'client.blocked': ('С этого номера заказы не принимаются. Позвоните {phone}, разберёмся.',
                       'Бул номерден заказ кабыл алынбайт. {phone} номерине чалыңыз, чечебиз.'),
    'client.nothing': ('Менять нечего: ни имени, ни языка в запросе нет.',
                       'Өзгөртүүгө эч нерсе жок: сурамда ат да, тил да жок.'),
    'claim.wrong': ('Номер заказа, телефон и ссылка не сходятся. Проверьте ссылку из смс '
                    'или позвоните {phone}.',
                    'Заказдын номери, телефон жана шилтеме дал келбейт. Смстеги шилтемени '
                    'текшериңиз же {phone} номерине чалыңыз.'),
    'claim.too_often': ('Слишком много попыток. Попробуйте через час.',
                        'Аракет өтө көп болду. Бир сааттан кийин кайра аракет кылыңыз.'),
    'verify.none': ('Отправьте фото с паспортом на проверку — без неё заказы не приходят.',
                    'Паспортуңузду кармап тарткан сүрөттү текшерүүгө жөнөтүңүз — '
                    'болбосо заказ келбейт.'),
    'verify.pending': ('Документы на проверке. Обычно это занимает до суток — как только '
                       'проверим, заказы начнут приходить.',
                       'Документтер текшерүүдө. Адатта бир суткага чейин созулат — '
                       'текшерип бүткөндө заказдар келе баштайт.'),
    'verify.approved': ('Проверка пройдена, заказы приходят.',
                        'Текшерүүдөн өттүңүз, заказдар келе баштайт.'),
    'verify.rejected': ('Проверка не пройдена. Посмотрите замечание и отправьте фото заново.',
                        'Текшерүүдөн өтпөдүңүз. Эскертүүнү окуп, сүрөттү кайра жөнөтүңүз.'),
    'verify.sent': ('Фото отправлено. Проверим и напишем — обычно это занимает до суток.',
                    'Сүрөт жөнөтүлдү. Текшерип, кабар беребиз — адатта бир суткага чейин.'),
    'verify.done': ('Проверка уже пройдена, отправлять фото снова не нужно.',
                    'Текшерүүдөн мурун эле өттүңүз, сүрөттү кайра жөнөтүүнүн кереги жок.'),
    'verify.too_often': ('Фото уже отправлено. Следующее можно прислать через час.',
                         'Сүрөт жөнөтүлдү. Кийинкисин бир сааттан кийин жөнөтсөңүз болот.'),
    'photo.login': ('Чтобы открыть эту фотографию, нужно войти.',
                    'Бул сүрөттү ачуу үчүн кирүү керек.'),
    'photo.hidden': ('Эту фотографию видят только сам курьер и администратор.',
                     'Бул сүрөттү курьердин өзү жана администратор гана көрөт.'),
}


def say(key, lang='ru', **vars):
    """Фраза из своего словарика. Телефон поддержки подставляется сам: он в
    половине текстов и меняется в админке, а не в коде."""
    ru, ky = SAY[key]
    text = ky if i18n.norm_lang(lang) == 'ky' else ru
    data = {'phone': settings.get('service.phone', '')}
    data.update(vars)
    try:
        return text.format(**data)
    except (KeyError, IndexError, ValueError):
        return text


# ─────────────────────────────────────────────────────────────── мелкие помощники

def _lang(ctx, fallback='ru'):
    """Язык ответа: что просили в запросе, иначе язык заказа или браузера."""
    raw = ctx.q('lang')
    if not raw and ctx.method in ('POST', 'PUT', 'PATCH'):
        try:
            raw = ctx.json.get('lang')
        except ApiError:
            raw = None
    if not raw:
        raw = (ctx.header('Accept-Language') or '')[:2]
    return i18n.norm_lang(raw or fallback)


def _base(ctx):
    """Префикс установки: сервис может стоять и в корне, и в подпапке (site.kg/go/).
    Берём его у приложения, а не угадываем, — иначе ссылка на фото уйдёт мимо."""
    try:
        return ctx.h.app.static.base
    except AttributeError:
        return '/'


def _photo_url(ctx, name):
    return uploads.url(name, _base(ctx)) if name else None


def _rating(rating_sum, rating_count):
    """Рейтинг человека. Без оценок — None, а не пятёрка: «нет оценок» и
    «оценили на пять» это разные вещи, и рисуются они по-разному."""
    count = int(rating_count or 0)
    if not count:
        return None
    return round(int(rating_sum or 0) / float(count), 2)


# ─────────────────────────────────────────────────────────────── чат по заказу

# Управляющие знаки, невидимые пробелы и переносы строк из буфера обмена.
# Экранированием занимается фронт, а вот мусор в тексте чистим здесь: он
# ломает и разметку, и поиск по переписке.
JUNK_RX = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f'
                     '\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]')


def clean_text(raw):
    """Текст сообщения: убираем мусор, сводим переносы, режем по длине.

    Не экранируем: в HTML текст превращает фронт, и делать это дважды — верный
    способ показать человеку «&amp;quot;» вместо кавычек.
    """
    text = str(raw or '').replace('\r\n', '\n').replace('\r', '\n').replace('\t', ' ')
    text = JUNK_RX.sub('', text)
    text = '\n'.join(line.strip() for line in text.split('\n'))
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()[:MAX_TEXT].strip()


def _find_order(pid):
    order = db.row('SELECT * FROM orders WHERE public_id=?',
                   (str(pid or '').strip().upper(),))
    if not order:
        not_found(i18n.error_text('order_not_found'))
    return order


def _check_track(ctx, order):
    """Сверка токена отслеживания — та же, что в public.py: сравниваем байтами
    через compare_digest, чтобы время ответа не подсказывало угаданные символы."""
    given = ctx.q('t') or ctx.q('token') or ctx.header('X-Track-Token') or ''
    if not given and ctx.method in ('POST', 'PUT', 'PATCH'):
        try:
            body = ctx.json
        except ApiError:
            body = {}
        given = body.get('t') or body.get('track_token') or ''
    given = str(given or '').strip()
    real = str(order.get('track_token') or '')
    lang = order.get('lang') or 'ru'
    if not given or not real:
        forbidden(say('track.wrong', lang))
    if not hmac.compare_digest(given.encode('utf-8'), real.encode('utf-8')):
        forbidden(say('track.wrong', lang))


def _courier_order(user_id, ref):
    """Заказ курьера по внутреннему id или публичному номеру. Чужой не отдаём."""
    key = str(ref or '').strip()
    if not key:
        bad('Не указан заказ')
    if key.isdigit():
        order = db.row('SELECT * FROM orders WHERE id=?', (int(key),))
    else:
        order = db.row('SELECT * FROM orders WHERE public_id=?', (key.upper(),))
    if not order:
        not_found('Такого заказа нет')
    if order['courier_id'] != user_id:
        forbidden('Это не ваш заказ')
    return order


def _closes_at(order):
    """Когда переписка закроется. Заказ живой — не закроется вовсе."""
    closed = order.get('done_at') or order.get('cancelled_at')
    return int(closed) + CHAT_TAIL_S if closed else None


def _chat_open(order, at=None):
    until = _closes_at(order)
    return until is None or (at or db.now()) < until


def _limit(ctx):
    return max(1, min(ctx.qi('limit', MSG_PAGE) or MSG_PAGE, MSG_PAGE_MAX))


def _messages(order_id, after=0, limit=MSG_PAGE):
    """История. Без after отдаём хвост: человеку нужны последние сообщения,
    а не первые, — с них и открывается экран."""
    if after > 0:
        return db.rows('SELECT * FROM messages WHERE order_id=? AND id>? '
                       'ORDER BY id LIMIT ?', (order_id, after, limit))
    rows = db.rows('SELECT * FROM messages WHERE order_id=? ORDER BY id DESC LIMIT ?',
                   (order_id, limit))
    rows.reverse()
    return rows


def _msg_view(m, side):
    return {
        'id': m['id'], 'sender': m['sender'], 'text': m['text'],
        'at': m['at'], 'read_at': m.get('read_at'),
        'mine': m['sender'] == side,
    }


def _other(side):
    return 'courier' if side == 'client' else 'client'


def _unread(order_id, side):
    """Сколько сообщений от второй стороны ещё не прочитано."""
    return int(db.value('SELECT COUNT(*) FROM messages WHERE order_id=? AND sender=? '
                        'AND read_at IS NULL', (order_id, _other(side)), 0) or 0)


def _peer(order, side):
    """Кто по ту сторону чата — для заголовка экрана."""
    if side == 'client':
        if not order.get('courier_id'):
            return None
        r = db.row('SELECT u.name, u.avatar, c.car_model, c.car_plate '
                   'FROM users u JOIN couriers c ON c.user_id=u.id WHERE u.id=?',
                   (order['courier_id'],))
        if not r:
            return None
        return {'role': 'courier', 'name': r['name'], 'avatar': r['avatar'],
                'car': {'model': r['car_model'], 'plate': r['car_plate']}}
    if not order.get('client_id'):
        return None
    r = db.row('SELECT name FROM clients WHERE id=?', (order['client_id'],))
    return {'role': 'client', 'name': (r or {}).get('name') or 'Клиент'}


def _chat_view(ctx, order, side, after=0):
    """Вся переписка одним ответом: сообщения, непрочитанные, можно ли писать."""
    t = db.now()
    rows = _messages(order['id'], after, _limit(ctx))
    lang = _lang(ctx, order.get('lang') or 'ru')
    open_now = _chat_open(order, t)
    out = {
        'public_id': order['public_id'],
        'status': order['status'],
        'items': [_msg_view(m, side) for m in rows],
        'total': int(db.value('SELECT COUNT(*) FROM messages WHERE order_id=?',
                              (order['id'],), 0) or 0),
        'unread': _unread(order['id'], side),
        'last_id': rows[-1]['id'] if rows else after,
        'can_send': open_now,
        'closed_at': _closes_at(order),
        'peer': _peer(order, side),
        'max_text': MAX_TEXT,
        'now': t,
    }
    if not open_now:
        out['message'] = say('chat.closed', lang)
    elif side == 'client' and not order.get('courier_id'):
        out['message'] = say('chat.waiting', lang)
    if side == 'courier':
        out['order_id'] = order['id']
    return out


def _publish_message(order, row):
    """Сообщение уходит обоим: клиент слушает тему заказа, курьер — свою.

    Полезную часть кладём во вложенный ключ message: поток клиента вырезает из
    событий верхние ключи с внутренними идентификаторами, и id сообщения,
    лежащий сверху, до экрана бы не дошёл.
    """
    payload = {'public_id': order['public_id'], 'message': dict(row)}
    HUB.publish('order:%s' % order['public_id'], 'message', payload)
    if order.get('courier_id'):
        HUB.publish('courier:%s' % order['courier_id'], 'message',
                    dict(payload, order_id=order['id']))


def _send_message(ctx, order, side):
    """Приём сообщения от одной из сторон. Проверки одни и те же для обоих."""
    lang = _lang(ctx, order.get('lang') or 'ru')
    if not _chat_open(order):
        conflict(say('chat.closed', lang))
    text = clean_text(ctx.json.get('text') or ctx.json.get('message'))
    if not text:
        bad(say('chat.empty', lang), 'empty_text')
    if not LIMIT.check('msg:%s:%s' % (side, order['id']), MSG_PER_MIN, 60):
        too_many(say('chat.too_often', lang))

    t = db.now()
    mid = db.insert('messages', {'order_id': order['id'], 'sender': side,
                                 'text': text, 'at': t, 'read_at': None})
    row = {'id': mid, 'sender': side, 'text': text, 'at': t, 'read_at': None}
    _publish_message(order, row)
    return {'ok': True, 'message': _msg_view(row, side),
            'unread': _unread(order['id'], side), 'now': t}, 201


def _mark_read(order, side):
    """Отметка прочтения: гасим всё, что пришло от второй стороны.

    О прочтении сообщаем обоим: галочка «прочитано» должна появиться у того,
    кто писал, без обновления экрана.
    """
    other = _other(side)
    ids = [r['id'] for r in db.rows('SELECT id FROM messages WHERE order_id=? AND sender=? '
                                    'AND read_at IS NULL', (order['id'], other))]
    if not ids:
        return []
    t = db.now()
    db.execute('UPDATE messages SET read_at=? WHERE order_id=? AND sender=? '
               'AND read_at IS NULL', (t, order['id'], other))
    payload = {'public_id': order['public_id'], 'by': side, 'ids': ids, 'at': t}
    HUB.publish('order:%s' % order['public_id'], 'message_read', payload)
    if order.get('courier_id'):
        HUB.publish('courier:%s' % order['courier_id'], 'message_read',
                    dict(payload, order_id=order['id']))
    return ids


# ── клиент ───────────────────────────────────────────────────────────────────

@router.get(API + '/orders/{pid}/messages')
def client_chat(ctx, pid):
    """История переписки по заказу. Открывается по токену отслеживания."""
    order = _find_order(pid)
    _check_track(ctx, order)
    return _chat_view(ctx, order, 'client', max(0, ctx.qi('after', 0)))


@router.post(API + '/orders/{pid}/messages')
def client_chat_send(ctx, pid):
    order = _find_order(pid)
    _check_track(ctx, order)
    return _send_message(ctx, order, 'client')


@router.post(API + '/orders/{pid}/messages/read')
def client_chat_read(ctx, pid):
    order = _find_order(pid)
    _check_track(ctx, order)
    ids = _mark_read(order, 'client')
    return {'ok': True, 'read': len(ids), 'ids': ids, 'unread': 0}


# ── курьер ───────────────────────────────────────────────────────────────────

@router.get(API + '/courier/orders/{id}/messages')
def courier_chat(ctx, id):
    user = auth.require(ctx, 'courier')
    order = _courier_order(user['id'], id)
    return _chat_view(ctx, order, 'courier', max(0, ctx.qi('after', 0)))


@router.post(API + '/courier/orders/{id}/messages')
def courier_chat_send(ctx, id):
    user = auth.require(ctx, 'courier')
    order = _courier_order(user['id'], id)
    return _send_message(ctx, order, 'courier')


@router.post(API + '/courier/orders/{id}/messages/read')
def courier_chat_read(ctx, id):
    user = auth.require(ctx, 'courier')
    order = _courier_order(user['id'], id)
    ids = _mark_read(order, 'courier')
    return {'ok': True, 'read': len(ids), 'ids': ids, 'unread': 0}


# ─────────────────────────────────────────────────────────────── профиль клиента

def issue_client_token(client_id):
    """Постоянный ключ клиента: 32 случайных байта в шестнадцатеричной записи.

    Выдаётся один раз и живёт с клиентом дальше: по нему приложение узнаёт
    человека на новом устройстве и показывает ему его историю. Уже выданный
    токен не меняем — иначе старый телефон потеряет доступ к своим заказам.

    Вызывать можно откуда угодно: при создании заказа, при доказанном владении
    заказом. Вернёт None, только если такого клиента нет.
    """
    row = db.row('SELECT id, token FROM clients WHERE id=?', (int(client_id),))
    if not row:
        return None
    if row.get('token'):
        return row['token']
    for _ in range(5):
        token = secrets.token_hex(CLIENT_TOKEN_BYTES)
        try:
            changed = db.execute('UPDATE clients SET token=? WHERE id=? AND token IS NULL',
                                 (token, int(client_id))).rowcount
        except sqlite3.IntegrityError:
            continue                      # токен уже занят — берём другой
        if changed:
            return token
        # Кто-то выдал токен в соседнем потоке: отдаём тот, что записался.
        existing = db.value('SELECT token FROM clients WHERE id=?', (int(client_id),))
        if existing:
            return existing
    return None


def _client_token(ctx):
    tok = ctx.q('token') or ctx.q('t') or ctx.header('X-Client-Token')
    if not tok and ctx.method in ('POST', 'PUT', 'PATCH'):
        try:
            body = ctx.json
        except ApiError:
            body = {}
        tok = body.get('token') or body.get('client_token')
    return str(tok or '').strip().lower()


def _client(ctx):
    """Клиент по своему токену. Нет токена или он чужой — просим открыть заказ."""
    token = _client_token(ctx)
    if not CLIENT_TOKEN_RX.match(token):
        raise ApiError('client_unknown', say('client.unknown', _lang(ctx)), 401)
    row = db.row('SELECT * FROM clients WHERE token=?', (token,))
    if not row:
        raise ApiError('client_unknown', say('client.unknown', _lang(ctx)), 401)
    if row.get('blocked'):
        forbidden(say('client.blocked', row.get('lang') or _lang(ctx)))
    return row


def _live_orders(client_id, lang):
    """Заказы в работе — приложение вернёт человека прямо на экран отслеживания."""
    rows = db.rows('SELECT public_id, track_token, status, created_at FROM orders '
                   'WHERE client_id=? AND status IN (%s) ORDER BY id DESC LIMIT 5'
                   % ','.join('?' * len(LIVE_STATUSES)),
                   (client_id,) + LIVE_STATUSES)
    return [{'public_id': r['public_id'], 'track_token': r['track_token'],
             'status': r['status'], 'status_name': i18n.status_name(r['status'], lang),
             'created_at': r['created_at']} for r in rows]


def _profile_view(client, lang='ru'):
    """Профиль без регистрации: что человек о себе знает и что мы о нём помним."""
    lang = i18n.norm_lang(lang)
    cid = client['id']
    done = int(db.value("SELECT COUNT(*) FROM orders WHERE client_id=? AND status='done'",
                        (cid,), 0) or 0)
    spent = int(db.value("SELECT COALESCE(SUM(price_total),0) FROM orders "
                         "WHERE client_id=? AND status='done'", (cid,), 0) or 0)
    return {
        'name': client.get('name') or '',
        'phone': client.get('phone'),
        'lang': client.get('lang') or lang,
        'orders_count': int(client.get('orders_count') or 0),
        'orders_done': done,
        'spent': spent,
        'rating': _rating(client.get('rating_sum'), client.get('rating_count')),
        'rating_count': int(client.get('rating_count') or 0),
        'name_asked': bool(client.get('name_asked')),
        'created_at': client.get('created_at'),
        'last_order_at': client.get('last_order_at'),
        'active': _live_orders(cid, lang),
        'support_phone': settings.get('service.phone', ''),
        'support_wa': settings.get('service.support_wa', ''),
    }


@router.get(API + '/client/profile')
def client_profile(ctx):
    client = _client(ctx)
    return _profile_view(client, _lang(ctx, client.get('lang') or 'ru'))


@router.patch(API + '/client/profile')
def client_profile_save(ctx):
    """Имя и язык. Больше клиенту менять нечего: телефон — это его опознание,
    и меняется он только новым заказом."""
    client = _client(ctx)
    patch = {}
    if 'name' in ctx.json:
        name = ctx.field('name', str, 80) or ''
        patch['name'] = name or None
        # Раз имя спросили и получили, второй раз не спрашиваем.
        patch['name_asked'] = 1
    if 'lang' in ctx.json:
        patch['lang'] = i18n.norm_lang(ctx.field('lang', str, 8))
    if not patch:
        bad(say('client.nothing', _lang(ctx, client.get('lang') or 'ru')), 'nothing_to_save')

    db.update('clients', patch, 'id=?', (client['id'],))
    fresh = db.row('SELECT * FROM clients WHERE id=?', (client['id'],))
    return dict(_profile_view(fresh, _lang(ctx, fresh.get('lang') or 'ru')), ok=True)


def _tariff_map():
    """Тарифы одним запросом: в истории они повторяются, а таблица маленькая."""
    return {r['id']: r for r in db.rows(
        'SELECT id, code, name_ru, name_ky, icon, vehicle_class FROM tariffs')}


def _couriers_map(ids):
    """Курьеры по списку заказов — одним запросом вместо запроса на строку.
    Телефона здесь нет: в истории он не нужен, а собирать контакты незачем."""
    ids = [int(i) for i in ids if i]
    if not ids:
        return {}
    rows = db.rows('SELECT u.id, u.name, u.avatar, c.car_model, c.car_plate, c.car_color, '
                   '       c.vehicle_class, c.rating_sum, c.rating_count '
                   'FROM users u JOIN couriers c ON c.user_id=u.id WHERE u.id IN (%s)'
                   % ','.join('?' * len(ids)), tuple(ids))
    return {r['id']: {
        'name': r['name'], 'avatar': r['avatar'],
        'car': {'model': r['car_model'], 'plate': r['car_plate'],
                'color': r['car_color'], 'class': r['vehicle_class']},
        'rating': _rating(r['rating_sum'], r['rating_count']),
    } for r in rows}


def _unread_map(order_ids):
    """Непрочитанные сообщения курьера по каждому заказу — для значка в списке."""
    ids = [int(i) for i in order_ids if i]
    if not ids:
        return {}
    rows = db.rows('SELECT order_id, COUNT(*) AS n FROM messages '
                   "WHERE order_id IN (%s) AND sender='courier' AND read_at IS NULL "
                   'GROUP BY order_id' % ','.join('?' * len(ids)), tuple(ids))
    return {r['order_id']: int(r['n']) for r in rows}


def _history_point(p):
    """Точка заказа для истории. Отдаём всё, что вводил сам клиент: из этого
    складывается кнопка «Повторить заказ»."""
    return {
        'addr': p.get('addr'), 'lat': p.get('lat'), 'lng': p.get('lng'),
        'entrance': p.get('entrance'), 'flat': p.get('flat'), 'floor': p.get('floor'),
        'intercom': p.get('intercom'), 'comment': p.get('comment'),
        'phone': p.get('phone'), 'name': p.get('name'),
    }


def _history_item(order, lang, tariffs, couriers, unread):
    points = [_history_point(p) for p in (db.jload(order.get('points'), []) or [])
              if isinstance(p, dict)]
    tariff = tariffs.get(order.get('tariff_id'))
    courier = couriers.get(order.get('courier_id')) \
        if order.get('status') in WITH_COURIER else None
    return {
        'public_id': order['public_id'],
        'track_token': order['track_token'],
        'status': order['status'],
        'status_name': i18n.status_name(order['status'], lang),
        'created_at': order['created_at'],
        'done_at': order.get('done_at'),
        'cancelled_at': order.get('cancelled_at'),
        'at': order.get('done_at') or order.get('cancelled_at') or order['created_at'],
        'from': points[0]['addr'] if points else None,
        'to': points[-1]['addr'] if len(points) > 1 else None,
        'addresses': [p['addr'] for p in points],
        'points': points,
        'points_count': len(points),
        'distance_m': order.get('distance_m', 0),
        'duration_s': order.get('duration_s', 0),
        'loaders': order.get('loaders', 0),
        'extras': db.jload(order.get('extras'), []) or [],
        'comment': order.get('comment'),
        'price_total': order.get('price_total', 0),
        'payment_method': order.get('payment_method', 'cash'),
        'payment_status': order.get('payment_status', 'none'),
        'paid_amount': order.get('paid_amount', 0),
        'tariff': tariff,
        'tariff_id': order.get('tariff_id'),
        'rating': order.get('client_rating'),
        'rating_comment': order.get('client_comment'),
        'can_rate': order['status'] == 'done' and not order.get('client_rating'),
        'live': order['status'] in LIVE_STATUSES,
        'courier': courier,
        'unread': unread.get(order['id'], 0),
    }


@router.get(API + '/client/orders')
def client_orders(ctx):
    """История заказов, свежие сверху. Постранично: в списке догружается прокруткой."""
    client = _client(ctx)
    lang = _lang(ctx, client.get('lang') or 'ru')
    page = max(1, ctx.qi('page', 1))
    per_page = max(1, min(ctx.qi('per_page', ORDERS_PAGE) or ORDERS_PAGE, ORDERS_PAGE_MAX))

    where, args = 'client_id=?', (client['id'],)
    status = (ctx.q('status') or '').strip()
    if status == 'live':
        where += ' AND status IN (%s)' % ','.join('?' * len(LIVE_STATUSES))
        args += LIVE_STATUSES
    elif status:
        where += ' AND status=?'
        args += (status,)

    total = int(db.value('SELECT COUNT(*) FROM orders WHERE ' + where, args, 0) or 0)
    rows = db.rows('SELECT * FROM orders WHERE %s ORDER BY created_at DESC, id DESC '
                   'LIMIT ? OFFSET ?' % where, args + (per_page, (page - 1) * per_page))

    tariffs = _tariff_map()
    couriers = _couriers_map({r.get('courier_id') for r in rows})
    unread = _unread_map([r['id'] for r in rows])
    pages = (total + per_page - 1) // per_page if total else 1
    return {
        'items': [_history_item(r, lang, tariffs, couriers, unread) for r in rows],
        'total': total, 'page': page, 'per_page': per_page, 'pages': pages,
        'has_more': page * per_page < total,
        'now': db.now(),
    }


@router.post(API + '/client/claim')
def client_claim(ctx):
    """Выдать токен тому, кто доказал, что заказ его.

    Телефона недостаточно: номер знает и таксист, и сосед. Нужен заказ вместе
    со своим токеном отслеживания — тогда человек либо открыл сообщение с
    ссылкой, либо оформлял заказ сам. Любая неувязка — один и тот же ответ,
    чтобы по нему нельзя было перебирать чужие номера.
    """
    lang = _lang(ctx)
    if not LIMIT.check('claim:%s' % ctx.ip, CLAIM_PER_HOUR, 3600):
        too_many(say('claim.too_often', lang))

    phone = auth.need_phone(ctx.need('phone', str, 32))
    ref = ctx.need('order_id', str, 40)
    given = str(ctx.need('track_token', str, 200) or '')
    if not LIMIT.check('claimp:%s' % phone, CLAIM_PER_HOUR, 3600):
        too_many(say('claim.too_often', lang))

    def refuse():
        raise ApiError('claim_failed', say('claim.wrong', lang), 403)

    key = ref.strip()
    if key.isdigit():
        order = db.row('SELECT * FROM orders WHERE id=?', (int(key),))
    else:
        order = db.row('SELECT * FROM orders WHERE public_id=?', (key.upper(),))
    if not order or not order.get('client_id'):
        refuse()
    real = str(order.get('track_token') or '')
    if not real or not hmac.compare_digest(given.encode('utf-8'), real.encode('utf-8')):
        refuse()

    client = db.row('SELECT * FROM clients WHERE id=?', (order['client_id'],))
    if not client:
        refuse()
    if not hmac.compare_digest(str(client.get('phone') or '').encode('utf-8'),
                               phone.encode('utf-8')):
        refuse()
    if client.get('blocked'):
        forbidden(say('client.blocked', client.get('lang') or lang))

    token = issue_client_token(client['id'])
    if not token:
        raise ApiError('claim_failed', say('claim.wrong', lang), 403)
    fresh = db.row('SELECT * FROM clients WHERE id=?', (client['id'],))
    log('клиент', phone, 'опознан по заказу', order['public_id'])
    return {'ok': True, 'token': token,
            'profile': _profile_view(fresh, _lang(ctx, fresh.get('lang') or lang))}


# ─────────────────────────────────────────────────────────────── проверка курьера

def _courier_profile(user_id):
    c = db.row('SELECT * FROM couriers WHERE user_id=?', (int(user_id),))
    if not c:
        raise ApiError('no_profile', 'Анкета машины не заполнена, обратитесь в поддержку', 409)
    return c


def _verify_view(ctx, user, profile):
    """Состояние проверки для экрана курьера: статус, замечание, что делать дальше.

    Ключи те же, что у dispatch.verify_view, — экран читает одно и то же
    и в состоянии смены, и здесь.
    """
    lang = user.get('lang') or 'ru'
    status = str(profile.get('verify_status') or 'none').strip().lower()
    if status not in VERIFY_STATUSES:
        status = 'none'
    note = str(profile.get('verify_note') or '').strip()
    name = profile.get('verify_photo')
    text = say('verify.%s' % status, lang)
    if status == 'rejected' and note:
        text = '%s %s' % (text, note)
    return {
        'status': status,
        'ok': status == 'approved',
        'can_send': status in ('none', 'rejected', 'pending'),
        'text': text,
        'note': note or None,
        'at': profile.get('verified_at'),
        'photo': bool(name),
        'photo_name': name,
        'photo_url': _photo_url(ctx, name),
        'max_mb': uploads.MAX_BYTES // (1024 * 1024),
    }


@router.get(API + '/courier/verify')
def verify_state(ctx):
    """Где сейчас проверка документов и почему, если отказали."""
    user = auth.require(ctx, 'courier')
    return _verify_view(ctx, user, _courier_profile(user['id']))


@router.post(API + '/courier/verify')
def verify_send(ctx):
    """Фото с паспортом на проверку. В базу пишем только имя файла.

    Отправить заново можно и после отказа, и пока заявка ждёт своей очереди:
    человек мог увидеть, что снимок вышел смазанным. Старый файл удаляем —
    хранить паспорт дольше нужного ни к чему.
    """
    user = auth.require(ctx, 'courier')
    profile = _courier_profile(user['id'])
    lang = user.get('lang') or 'ru'
    status = str(profile.get('verify_status') or 'none').strip().lower()
    if status == 'approved':
        conflict(say('verify.done', lang))
    if not LIMIT.check('vfy:%s' % user['id'], VERIFY_PER_HOUR, 3600):
        too_many(say('verify.too_often', lang))

    saved = uploads.save(ctx.json.get('photo') or ctx.json.get('image'), VERIFY_PREFIX)
    old = profile.get('verify_photo')
    t = db.now()
    db.update('couriers', {'verify_status': 'pending', 'verify_photo': saved['name'],
                           'verify_note': None, 'verified_at': None},
              'user_id=?', (user['id'],))
    if old and old != saved['name']:
        uploads.remove(old)

    fresh = _courier_profile(user['id'])
    log('проверка: курьер', user['name'], 'прислал фото', saved['name'],
        '(%d КБ)' % (saved['size'] // 1024))
    # Админка держит открытую очередь на проверку — пусть заявка появится сразу.
    HUB.publish('admin', 'verify', {
        'user_id': user['id'], 'name': user['name'], 'phone': user['phone'],
        'status': 'pending', 'at': t, 'photo': saved['name'],
        'car': {'model': profile.get('car_model'), 'plate': profile.get('car_plate')},
    })
    return dict(_verify_view(ctx, user, fresh), ok=True, message=say('verify.sent', lang)), 201


@router.post(API + '/courier/photo')
def courier_photo(ctx):
    """Аватар курьера. Его видит клиент на карте, поэтому файл открыт всем,
    в отличие от фото с паспортом."""
    user = auth.require(ctx, 'courier')
    _courier_profile(user['id'])
    if not LIMIT.check('ava:%s' % user['id'], AVATAR_PER_HOUR, 3600):
        too_many('Слишком часто меняете фото. Попробуйте через час')

    saved = uploads.save(ctx.json.get('photo') or ctx.json.get('avatar'), AVATAR_PREFIX)
    url = _photo_url(ctx, saved['name'])
    old = db.value('SELECT photo FROM couriers WHERE user_id=?', (user['id'],))
    with db.tx():
        db.update('couriers', {'photo': saved['name']}, 'user_id=?', (user['id'],))
        # users.avatar уходит клиенту готовой ссылкой — так её и храним.
        db.update('users', {'avatar': url}, 'id=?', (user['id'],))
    if old and old != saved['name']:
        uploads.remove(old)
    return {'ok': True, 'photo': saved['name'], 'url': url, 'avatar': url,
            'size': saved['size']}


def _private_owner(name):
    """Чей это закрытый файл. Фото с паспортом видят только сам курьер и админ.

    Опираемся и на префикс имени, и на запись в базе: файл, на который в базе
    уже никто не ссылается, всё равно остаётся паспортом, а не картинкой.
    """
    if not str(name or '').startswith(VERIFY_PREFIX + '_'):
        return None, False
    owner = db.value('SELECT user_id FROM couriers WHERE verify_photo=?', (name,))
    return (int(owner) if owner else None), True


@router.get(API + '/uploads/{name}')
def download(ctx, name):
    """Отдача картинки. Имя проверяет uploads, права — мы.

    Токен здесь можно прислать и параметром token: тег <img> заголовки ставить
    не умеет, а фото с паспортом надо показать и курьеру, и админу.
    """
    clean = str(name or '').strip()
    owner, private = _private_owner(clean)
    if private:
        user = auth.optional(ctx)
        if not user:
            unauthorized(say('photo.login', _lang(ctx)))
        if user['role'] != 'admin' and (owner is None or int(user['id']) != owner):
            forbidden(say('photo.hidden', user.get('lang') or 'ru'))
    raw, mime = uploads.read(clean)
    _send_bytes(ctx, raw, mime, clean, private)


def _send_bytes(ctx, raw, mime, name, private):
    """Файл в ответ: с ETag, чтобы браузер не тянул его повторно, и без общего
    кэша — картинки тут хоть и не секретные, но и не для прокси по дороге."""
    h = ctx.h
    etag = '"%s"' % hashlib.md5(raw).hexdigest()[:20]
    cache = 'private, no-store' if private else 'private, max-age=86400'
    if ctx.header('If-None-Match') == etag:
        h.send_response(304)
        h.send_header('ETag', etag)
        h.send_header('Cache-Control', cache)
        h.end_headers()
        return
    h.send_response(200)
    h.send_header('Content-Type', mime)
    h.send_header('Content-Length', str(len(raw)))
    h.send_header('ETag', etag)
    h.send_header('Cache-Control', cache)
    h.send_header('Content-Disposition', 'inline; filename="%s"' % name)
    h._security_headers()
    h.end_headers()
    if ctx.method != 'HEAD':
        h.wfile.write(raw)


# ─────────────────────────────────────────────────────────────── зоны спроса

_zones_lock = threading.Lock()
_zones = {'at': 0, 'data': None}


def _cell_size(lat):
    """Сторона ячейки в градусах. По долготе градус короче — тем сильнее, чем
    дальше от экватора, поэтому считаем от широты города, а не «на глазок»."""
    dlat = ZONE_CELL_M / 111320.0
    dlng = ZONE_CELL_M / max(1000.0, 111320.0 * math.cos(math.radians(lat)))
    return dlat, dlng


def _compute_zones(t):
    """Плотность заказов за три часа по сетке. Считаем по точке подачи: спрос —
    это место, откуда людям надо уехать, а не куда они везут груз."""
    center_lat = settings.get_float('map.center_lat', 42.8746)
    dlat, dlng = _cell_size(center_lat)
    rows = db.rows('SELECT points FROM orders WHERE created_at >= ? AND status IN (%s)'
                   % ','.join('?' * len(ZONE_STATUSES)),
                   (t - ZONE_WINDOW_S,) + ZONE_STATUSES)

    counts, total = {}, 0
    for r in rows:
        points = db.jload(r.get('points'), []) or []
        if not points or not isinstance(points[0], dict):
            continue
        lat, lng = points[0].get('lat'), points[0].get('lng')
        try:
            lat, lng = float(lat), float(lng)
        except (TypeError, ValueError):
            continue
        key = (int(math.floor(lat / dlat)), int(math.floor(lng / dlng)))
        counts[key] = counts.get(key, 0) + 1
        total += 1

    cells = []
    if total >= ZONE_MIN_TOTAL:
        top = max(counts.values()) if counts else 0
        if top >= ZONE_MIN_ORDERS:
            for (gy, gx), n in counts.items():
                if n < ZONE_MIN_ORDERS:
                    continue
                level = max(ZONE_MIN_LEVEL, min(1.0, n / float(top)))
                cells.append({'lat': round((gy + 0.5) * dlat, 6),
                              'lng': round((gx + 0.5) * dlng, 6),
                              'level': round(level, 2), 'orders': n})
            cells.sort(key=lambda c: (-c['orders'], -c['level']))
            del cells[ZONE_MAX_CELLS:]

    return {
        'cells': cells, 'updated_at': t, 'next_at': t + ZONE_TTL_S,
        'orders': total, 'window_s': ZONE_WINDOW_S, 'cell_m': ZONE_CELL_M,
        'cell_lat': round(dlat, 6), 'cell_lng': round(dlng, 6),
    }


def zones_data():
    """Зоны из памяти. Считаем не чаще раза в минуту: за это время карта спроса
    не меняется, а перебирать заказы на каждое открытие карты незачем."""
    t = db.now()
    with _zones_lock:
        data = _zones['data']
        if data and t - _zones['at'] < ZONE_TTL_S:
            return data
        data = _compute_zones(t)
        _zones['at'], _zones['data'] = t, data
        return data


@router.get(API + '/courier/zones')
def courier_zones(ctx):
    """Зоны повышенного спроса для карты курьера. Пусто — нормальный ответ:
    ночью в городе действительно нет мест, куда стоит подъехать заранее."""
    auth.require(ctx, 'courier')
    return zones_data()


# ─────────────────────────────────────────────────────────────── подключение

def register(app):
    """Подключение маршрутов к приложению — вызывается из app.py."""
    app.router.include(router)
    return router


# У соседних роутеров точка входа называется по-разному; поддерживаем оба имени,
# чтобы сборка в app.py не спотыкалась на том, как именно её здесь назвали.
mount = register
