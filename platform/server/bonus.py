# -*- coding: utf-8 -*-
"""Бонусы: кэшбек, приглашения, списание в заказе и сгорание.

Зачем это устроено именно так. Бонусы — не подарок, а причина заказать во второй
раз. Поэтому деньги здесь не раздаются авансом:

* кэшбек начисляется, только когда заказ ЗАКРЫТ, и считается от суммы, которую
  человек реально заплатил деньгами (списанные бонусы в базу кэшбека не входят —
  иначе бонусы рожали бы бонусы);
* бонусами нельзя закрыть больше bonus.max_share процентов заказа: остальное
  приходит живыми деньгами, и сервис не уходит в минус;
* пригласивший получает награду только после ЗАВЕРШЁННОГО заказа друга, один
  телефон — один раз, свой код себе не применить;
* без заказов бонусы сгорают через bonus.expire_days дней, и за неделю до этого
  человеку показывается предупреждение.

Каждое движение — строкой в журнале bonus_log: сумма, остаток после движения,
причина и заказ. По журналу в админке видно, откуда взялся каждый тыйын, и по
нему же считается вся статистика — отдельных счётчиков «выдано/списано» мы не
держим, чтобы им нечего было разойтись с журналом.

Деньги — целые тыйыны. Начисления округляются вниз до целого сома: баланс с
копейками выглядит как ошибка, а не как подарок.

Свои таблицы модуль создаёт сам при первом обращении (db.py не трогаем).

Эндпоинты (подключаются из app.py вызовом bonus.register(app)):

    GET  /api/v1/client/bonus            баланс, код, сгорание, история
    GET  /api/v1/client/bonus/max?total= сколько можно списать в заказ такой суммы
    POST /api/v1/client/bonus/invite     {code} — применить код друга
    GET  /api/v1/admin/bonus             сводка и последние движения
    GET  /api/v1/admin/bonus/clients/{id}   бонусы одного клиента
    PUT  /api/v1/admin/bonus/settings    проценты, сроки, суммы
    POST /api/v1/admin/bonus/adjust      ручное начисление или списание с причиной
    POST /api/v1/admin/bonus/expire      прогнать сгорание руками

Клиент опознаётся тем же постоянным токеном, что и в профиле: заголовок
X-Client-Token или параметр token. Админ — обычной сессией.

Крючки для чужих модулей (вызывать после успешной записи в orders):

    bonus.on_order_done(order)        заказ перешёл в done
    bonus.on_order_rated(order, n)    клиент поставил оценку
    bonus.on_order_cancelled(order)   заказ отменён, списанное вернуть
    bonus.spend(client_id, сумма, order_id=…, order_total=…)   при создании заказа
    bonus.expire_old()                раз в сутки из фонового потока

Если крючок не позвали — бонусы всё равно не потеряются: при открытии экрана
бонусов начисления по закрытым заказам добираются сами (см. catch_up).
"""
import re
import secrets
import sqlite3
import threading

from . import auth, db, i18n_server as i18n, settings
from .core import HUB, LIMIT, ApiError, Router, bad, forbidden, log, too_many

API = '/api/v1'
router = Router()

# Код приглашения: буквы и цифры, которые не путаются на слух и в рукописи —
# без нуля и «O», без единицы, «I» и «L».
CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
CODE_LEN = 6

CLIENT_TOKEN_RX = re.compile(r'^[a-f0-9]{32,128}$')

INVITE_PER_HOUR = 10        # попыток ввести чужой код с одного адреса
HISTORY_PAGE = 50
HISTORY_MAX = 200

SOM = 100                   # тыйынов в соме

# Причины движений. Значение — как показать человеку: русский и кыргызский.
REASONS = {
    'cashback':      ('Кэшбек с заказа', 'Заказдан кэшбек'),
    'invite_friend': ('Подарок за код друга', 'Достун коду үчүн белек'),
    'invite_owner':  ('Друг съездил по вашему коду', 'Досуңуз кодуңуз менен жүрдү'),
    'review':        ('Спасибо за оценку', 'Баа бергениңиз үчүн рахмат'),
    'signup':        ('Приветственные бонусы', 'Тааныштык белеги'),
    'spend':         ('Списано в заказе', 'Заказда пайдаланылды'),
    'refund':        ('Возврат после отмены', 'Жокко чыгаруудан кийин кайтты'),
    'expire':        ('Сгорели без заказов', 'Заказсыз күйүп кетти'),
    'admin':         ('Начисление от поддержки', 'Колдоо кызматынан'),
}

# Фразы этого модуля. Общий словарь трогать нельзя, да и нужны они только здесь.
SAY = {
    'off': ('Бонусы сейчас отключены.', 'Бонустар азыр өчүрүлгөн.'),
    'code.none': ('Такого кода нет. Проверьте, не перепутались ли буквы.',
                  'Мындай код жок. Тамгаларды текшериңиз.'),
    'code.self': ('Свой код себе не работает — позовите друга, он и вам принесёт бонусы.',
                  'Өз кодуңуз өзүңүзгө иштебейт — досуңузду чакырыңыз, ал экөөңүзгө тең бонус алып келет.'),
    'code.used': ('Код уже применён, второй раз нельзя.',
                  'Код мурун колдонулган, экинчи жолу болбойт.'),
    'code.late': ('Код действует только до первого заказа. Ваши бонусы теперь копятся кэшбеком.',
                  'Код биринчи заказга чейин гана жарайт. Эми бонус кэшбек менен топтолот.'),
    'code.ring': ('Вы уже пригласили этого человека — по кругу бонусы не начисляются.',
                  'Сиз бул кишини мурун чакыргансыз — тегеректеп бонус берилбейт.'),
    'code.blocked': ('Код принадлежит заблокированному клиенту.',
                     'Код бөгөттөлгөн кардарга таандык.'),
    'code.busy': ('Не получилось выдать код, попробуйте ещё раз.',
                  'Кодду берүү мүмкүн болбоду, кайра аракет кылыңыз.'),
    'code.often': ('Слишком много попыток. Подождите немного.',
                   'Аракет өтө көп болду. Бир аз күтө туруңуз.'),
    'client.unknown': ('Не узнаём вас. Откройте свой заказ по ссылке из приложения.',
                       'Сизди тааныбай турабыз. Заказыңызды тиркемедеги шилтеме менен ачыңыз.'),
    'client.blocked': ('С этого номера заказы не принимаются.',
                       'Бул номерден заказ кабыл алынбайт.'),
}


def say(key, lang='ru', **vars):
    ru, ky = SAY[key]
    text = ky if i18n.norm_lang(lang) == 'ky' else ru
    try:
        return text.format(**vars)
    except (KeyError, IndexError, ValueError):
        return text


# ─────────────────────────────────────────────────────────────── мелкая арифметика

def _int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _clamp(v, low, high):
    return max(low, min(high, v))


def _pct(base, share):
    """Процент от суммы в тыйынах. Проценты держим в сотых долях: 3,5 % → 350,
    дальше только целые — во float деньги не считаем."""
    try:
        hundredths = int(round(float(share) * 100))
    except (TypeError, ValueError):
        return 0
    base = _int(base)
    if base <= 0 or hundredths <= 0:
        return 0
    return (base * hundredths + 5000) // 10000


def _som(v):
    """Вниз до целого сома. Начисления и списания с копейками выглядят как ошибка."""
    v = _int(v)
    return (v // SOM) * SOM if v > 0 else 0


# ─────────────────────────────────────────────────────────────── настройки

def enabled():
    return settings.get_bool('bonus.enabled', True)


def percent():
    """Кэшбек с выполненного заказа, процентов. Больше половины — это уже не кэшбек."""
    return _clamp(settings.get_float('bonus.percent', 3), 0.0, 50.0)


def max_share():
    """Какую долю заказа разрешено закрыть бонусами."""
    return _clamp(settings.get_float('bonus.max_share', 30), 0.0, 100.0)


def expire_days():
    return _clamp(settings.get_int('bonus.expire_days', 180), 1, 3650)


def warn_days():
    return _clamp(settings.get_int('bonus.warn_days', 7), 0, expire_days())


def invite_friend_sum():
    return max(0, settings.get_int('bonus.invite_friend', 20000))


def invite_owner_sum():
    return max(0, settings.get_int('bonus.invite_owner', 30000))


def review_sum():
    return max(0, settings.get_int('bonus.review', 2000))


def signup_sum():
    return max(0, settings.get_int('bonus.signup', 0))


# ─────────────────────────────────────────────────────────────── таблицы

SCHEMA = """
CREATE TABLE IF NOT EXISTS bonus_accounts (
  client_id INTEGER PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  code TEXT,                          -- личный код приглашения
  invited_by INTEGER,                 -- кто пригласил, client_id
  invited_at INTEGER,                 -- когда код применён
  invite_paid_at INTEGER,             -- когда пригласившему заплатили за этого друга
  last_move_at INTEGER,               -- последнее движение, от него считаем сгорание
  warned_at INTEGER,                  -- когда предупредили о сгорании
  created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_bonus_inviter ON bonus_accounts(invited_by);
CREATE INDEX IF NOT EXISTS ix_bonus_live ON bonus_accounts(balance, last_move_at);

CREATE TABLE IF NOT EXISTS bonus_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  amount INTEGER NOT NULL,            -- плюс начисление, минус списание
  balance INTEGER NOT NULL,           -- остаток после движения
  reason TEXT NOT NULL,
  order_id INTEGER,
  ref_client INTEGER,                 -- второй участник: друг или пригласивший
  note TEXT);
CREATE INDEX IF NOT EXISTS ix_bonus_log_client ON bonus_log(client_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_bonus_log_at ON bonus_log(at DESC);
"""

# Один заказ — одна причина. Индекс частичный: у ручных начислений заказа нет,
# и ограничивать их нечем и незачем.
UNIQUE_MOVE = ('CREATE UNIQUE INDEX IF NOT EXISTS ix_bonus_log_once '
               'ON bonus_log(client_id, reason, order_id) WHERE order_id IS NOT NULL')
UNIQUE_CODE = ('CREATE UNIQUE INDEX IF NOT EXISTS ix_bonus_code '
               'ON bonus_accounts(code) WHERE code IS NOT NULL')

_schema_ready = False
_schema_lock = threading.Lock()


def ensure_schema():
    """Свои таблицы заводим сами при первом обращении: db.py — чужой файл,
    а CREATE TABLE IF NOT EXISTS ничего не ломает при повторном запуске."""
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        conn = db.connect()
        conn.executescript(SCHEMA)
        conn.execute(UNIQUE_MOVE)
        conn.execute(UNIQUE_CODE)
        _schema_ready = True


class _atomic:
    """Транзакция, которая не мешает чужой.

    Списание бонусов часто идёт внутри транзакции заказа, а второй BEGIN sqlite
    не разрешает. Если запись уже идёт — работаем в ней, свою не открываем.
    """

    def __enter__(self):
        self.own = not db.connect().in_transaction
        self.tx = None
        if self.own:
            self.tx = db.tx()
            self.tx.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.tx is not None:
            return self.tx.__exit__(exc_type, exc, tb)
        return False


# ─────────────────────────────────────────────────────────────── счёт клиента

def _touch(client_id):
    """Счёт клиента, заводим при первом движении. Без приветственных бонусов:
    их раздаёт account(), чтобы фоновые пересчёты никому ничего не дарили."""
    ensure_schema()
    cid = _int(client_id)
    if cid <= 0:
        raise ApiError('bonus_client', 'Не понятно, чей это бонусный счёт', 400)
    row = db.row('SELECT * FROM bonus_accounts WHERE client_id=?', (cid,))
    if row:
        return row
    t = db.now()
    try:
        db.execute('INSERT INTO bonus_accounts(client_id, balance, last_move_at, created_at) '
                   'VALUES(?,0,?,?)', (cid, t, t))
    except sqlite3.IntegrityError:
        pass                                   # завели в соседнем потоке — не беда
    return db.row('SELECT * FROM bonus_accounts WHERE client_id=?', (cid,))


def account(client_id):
    """Счёт клиента для живого обращения: заодно выдаём приветственные бонусы,
    если они включены. Вызывается там, где человек пришёл сам."""
    row = _touch(client_id)
    welcome = signup_sum()
    if welcome and enabled():
        given = db.value('SELECT COUNT(*) FROM bonus_log WHERE client_id=? AND reason=?',
                         (row['client_id'], 'signup'), 0)
        if not _int(given):
            accrue(row['client_id'], welcome, 'signup')
            row = db.row('SELECT * FROM bonus_accounts WHERE client_id=?', (row['client_id'],))
    return row


def balance(client_id):
    """Сколько бонусов у человека сейчас."""
    ensure_schema()
    return max(0, _int(db.value('SELECT balance FROM bonus_accounts WHERE client_id=?',
                                (_int(client_id),), 0)))


def expires_at(client_id):
    """Когда сгорят бонусы, если человек не закажет. Ноль бонусов — сгорать нечему."""
    ensure_schema()
    row = db.row('SELECT balance, last_move_at, created_at FROM bonus_accounts WHERE client_id=?',
                 (_int(client_id),))
    if not row or _int(row.get('balance')) <= 0:
        return None
    last = _int(row.get('last_move_at')) or _int(row.get('created_at'))
    return last + expire_days() * 86400


# ─────────────────────────────────────────────────────────────── движения

def _publish(client_id, amount, reason, note=None):
    """Живая лента админки: движения бонусов видно сразу, без обновления страницы."""
    HUB.publish('admin', 'bonus', {
        'client_id': _int(client_id), 'amount': _int(amount),
        'reason': reason, 'note': note or '', 'at': db.now(),
    })


def _move(client_id, amount, reason, order_id=None, ref_client=None, note=None, once=True):
    """Одно движение бонусов: журнал и остаток одной транзакцией.

    Остаток считается от прочитанного внутри транзакции значения, а не от
    переданного снаружи: два начисления в одну секунду не должны затирать друг друга.
    """
    ensure_schema()
    cid = _int(client_id)
    amount = _int(amount)
    oid = _int(order_id) or None
    if amount == 0:
        return {'ok': True, 'amount': 0, 'balance': balance(cid), 'reason': reason,
                'skipped': 'zero'}

    with _atomic():
        acc = _touch(cid)
        if once and oid:
            was = db.row('SELECT id, amount FROM bonus_log '
                         'WHERE client_id=? AND reason=? AND order_id=?', (cid, reason, oid))
            if was:
                # Повтор: заказ закрыли дважды, колбэк пришёл дважды — неважно.
                # Бонусы за одно и то же событие начисляются один раз.
                return {'ok': True, 'amount': 0, 'balance': _int(acc.get('balance')),
                        'reason': reason, 'skipped': 'already', 'id': was['id']}
        left = max(0, _int(acc.get('balance')) + amount)
        t = db.now()
        try:
            row_id = db.insert('bonus_log', {
                'client_id': cid, 'at': t, 'amount': amount, 'balance': left,
                'reason': reason, 'order_id': oid, 'ref_client': _int(ref_client) or None,
                'note': note or None,
            })
        except sqlite3.IntegrityError:
            # Тот же случай, что выше, только гонка попала точно в момент вставки.
            return {'ok': True, 'amount': 0, 'balance': _int(acc.get('balance')),
                    'reason': reason, 'skipped': 'already'}
        patch = {'balance': left, 'last_move_at': t}
        if amount > 0:
            patch['warned_at'] = None          # начислили — предупреждать заново
        db.update('bonus_accounts', patch, 'client_id=?', (cid,))

    _publish(cid, amount, reason, note)
    return {'ok': True, 'id': row_id, 'amount': amount, 'balance': left, 'reason': reason}


def accrue(client_id, amount, reason='admin', order_id=None, ref_client=None,
           note=None, once=True):
    """Начисление. Сумма всегда положительная, причина обязательна — по ней
    в админке видно, откуда взялся каждый тыйын."""
    amount = max(0, _int(amount))
    if reason not in REASONS:
        reason = 'admin'
    return _move(client_id, amount, reason, order_id=order_id,
                 ref_client=ref_client, note=note, once=once)


def spend(client_id, amount, order_id=None, order_total=None, note=None):
    """Списание в заказ. Больше, чем есть на счету и чем разрешает доля заказа,
    списать нельзя — проверяем здесь ещё раз, даже если вызывающий уже считал."""
    cid = _int(client_id)
    want = _som(max(0, _int(amount)))
    if want <= 0 or not enabled():
        return {'ok': True, 'amount': 0, 'balance': balance(cid), 'reason': 'spend',
                'skipped': 'zero'}
    with _atomic():
        # Остаток читаем в той же транзакции, в которой пишем: между проверкой
        # «хватает ли» и списанием баланс меняться не должен.
        limit = _int(_touch(cid).get('balance'))
        if order_total is not None:
            limit = min(limit, cap_for_total(order_total))
        want = _som(min(want, limit))
        if want <= 0:
            return {'ok': True, 'amount': 0, 'balance': limit, 'reason': 'spend',
                    'skipped': 'no_balance'}
        return _move(cid, -want, 'spend', order_id=order_id, note=note)


def refund(client_id, order_id, note=None):
    """Заказ отменили — списанные бонусы возвращаем. Человек не виноват, что
    машина не приехала, и терять из-за этого свои бонусы он не должен."""
    used = applied_to_order(order_id)
    if used <= 0:
        return {'ok': True, 'amount': 0, 'balance': balance(client_id), 'reason': 'refund',
                'skipped': 'nothing'}
    return _move(client_id, used, 'refund', order_id=order_id, note=note)


def applied_to_order(order_id):
    """Сколько бонусов уже списано в этот заказ (с учётом возврата).
    Нужно и чеку, и расчёту предоплаты."""
    ensure_schema()
    oid = _int(order_id)
    if oid <= 0:
        return 0
    total = db.value("SELECT COALESCE(SUM(amount),0) FROM bonus_log "
                     "WHERE order_id=? AND reason IN ('spend','refund')", (oid,), 0)
    return max(0, -_int(total))


def cap_for_total(order_total):
    """Потолок списания по сумме заказа, без оглядки на баланс. Нужен там, где
    клиент ещё не опознан — например, в предварительном расчёте цены."""
    if not enabled():
        return 0
    return _som(_pct(max(0, _int(order_total)), max_share()))


def max_spendable(client_id, order_total):
    """Сколько бонусов реально можно списать в заказ этой суммы: меньшее из
    остатка на счету и доли заказа."""
    if not enabled():
        return 0
    return _som(min(balance(client_id), cap_for_total(order_total)))


def history(client_id, limit=HISTORY_PAGE, offset=0, lang='ru'):
    """Журнал движений понятными строками — то, что человек видит в профиле."""
    ensure_schema()
    cid = _int(client_id)
    limit = _clamp(_int(limit, HISTORY_PAGE), 1, HISTORY_MAX)
    offset = max(0, _int(offset))
    rows = db.rows(
        'SELECT b.id, b.at, b.amount, b.balance, b.reason, b.note, o.public_id '
        'FROM bonus_log b LEFT JOIN orders o ON o.id = b.order_id '
        'WHERE b.client_id=? ORDER BY b.id DESC LIMIT ? OFFSET ?', (cid, limit, offset))
    out = []
    for r in rows:
        out.append({
            'id': r['id'], 'at': r['at'],
            'amount': _int(r['amount']), 'balance': _int(r['balance']),
            'reason': r['reason'], 'text': _move_text(r, lang),
            'order': r.get('public_id'),
        })
    return out


def _move_text(row, lang='ru'):
    """Строка движения для экрана: «Кэшбек с заказа AB12CD», «Пригласили Азамата»."""
    lang = i18n.norm_lang(lang)
    ru, ky = REASONS.get(row.get('reason'), REASONS['admin'])
    text = ky if lang == 'ky' else ru
    note = (row.get('note') or '').strip()
    if row.get('reason') == 'invite_owner' and note:
        text = ('%s — досуңуз' % note) if lang == 'ky' else ('Пригласили: %s' % note)
    elif note and row.get('reason') == 'admin':
        text = note
    pid = row.get('public_id')
    if pid and row.get('reason') in ('cashback', 'spend', 'refund', 'review'):
        text = '%s %s' % (text, pid)
    return text


# ─────────────────────────────────────────────────────────────── приглашения

def invite_code(client_id):
    """Личный код приглашения. Выдаётся один раз и больше не меняется:
    человек уже отправил его друзьям в переписке."""
    ensure_schema()
    acc = _touch(client_id)
    if acc.get('code'):
        return acc['code']
    cid = acc['client_id']
    for _ in range(8):
        code = ''.join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
        try:
            changed = db.execute('UPDATE bonus_accounts SET code=? '
                                 'WHERE client_id=? AND code IS NULL', (code, cid)).rowcount
        except sqlite3.IntegrityError:
            continue                            # код занят — берём следующий
        if changed:
            return code
        busy = db.value('SELECT code FROM bonus_accounts WHERE client_id=?', (cid,))
        if busy:
            return busy                         # выдали в соседнем потоке
    raise ApiError('bonus_code', say('code.busy'), 503)


def normalize_code(raw):
    """Код из чего угодно: пробелы, дефисы и регистр человеку прощаем."""
    return re.sub(r'[^A-Z0-9]', '', str(raw or '').upper())


def _owner_by_code(code):
    ensure_schema()
    code = normalize_code(code)
    if len(code) < 4:
        return None
    return db.row('SELECT * FROM bonus_accounts WHERE code=?', (code,))


def apply_invite(client_id, code, lang='ru'):
    """Друг вводит код пригласившего.

    Здесь только половина сделки: другу бонусы даём сразу, чтобы он потратил их
    на первый заказ, а пригласившему — не раньше, чем этот заказ будет выполнен
    (см. on_order_done). Иначе код превращается в кнопку «выдать себе денег».
    """
    if not enabled():
        raise ApiError('bonus_off', say('off', lang), 409)
    cid = _int(client_id)
    owner = _owner_by_code(code)
    if not owner:
        raise ApiError('invite_bad', say('code.none', lang), 404)
    if _int(owner['client_id']) == cid:
        raise ApiError('invite_self', say('code.self', lang), 409)

    me = account(cid)
    if me.get('invited_by'):
        raise ApiError('invite_used', say('code.used', lang), 409)
    if _int(owner.get('invited_by')) == cid:
        raise ApiError('invite_ring', say('code.ring', lang), 409)

    owner_client = db.row('SELECT id, name, blocked FROM clients WHERE id=?',
                          (owner['client_id'],))
    if not owner_client or owner_client.get('blocked'):
        raise ApiError('invite_bad', say('code.blocked', lang), 409)

    # Код — для новых. Кто уже съездил с нами, копит кэшбеком.
    done = db.value("SELECT COUNT(*) FROM orders WHERE client_id=? AND status='done'",
                    (cid,), 0)
    if _int(done) > 0:
        raise ApiError('invite_late', say('code.late', lang), 409)

    gift = invite_friend_sum()
    t = db.now()
    with _atomic():
        changed = db.execute('UPDATE bonus_accounts SET invited_by=?, invited_at=? '
                             'WHERE client_id=? AND invited_by IS NULL',
                             (owner['client_id'], t, cid)).rowcount
        if not changed:
            raise ApiError('invite_used', say('code.used', lang), 409)
        if gift:
            _move(cid, gift, 'invite_friend', ref_client=owner['client_id'],
                  note=(owner_client.get('name') or '').strip() or None, once=False)

    log('бонусы: клиент', cid, 'пришёл по коду', owner.get('code'),
        '—', i18n.fmt_money(gift))
    return {
        'ok': True, 'amount': gift, 'balance': balance(cid),
        'invited_by': (owner_client.get('name') or '').strip(),
        'owner_gets': invite_owner_sum(),
    }


# ─────────────────────────────────────────────────────────────── события заказа

def on_order_done(order):
    """Заказ закрыт: кэшбек клиенту и награда тому, кто его привёл.

    База кэшбека — деньги, а не бонусы: из суммы заказа вычитаем то, что человек
    закрыл бонусами. Иначе бонусы начали бы приносить бонусы.
    """
    if not enabled() or not isinstance(order, dict):
        return {'cashback': 0, 'invite_owner': 0}
    cid = _int(order.get('client_id'))
    oid = _int(order.get('id'))
    if cid <= 0 or oid <= 0 or order.get('status') != 'done':
        return {'cashback': 0, 'invite_owner': 0}

    acc = account(cid)
    paid = max(0, _int(order.get('price_total')) - applied_to_order(oid))
    cash = _som(_pct(paid, percent()))
    got = accrue(cid, cash, 'cashback', order_id=oid) if cash else {'amount': 0}

    # Пригласившему платим один раз и только после ЗАВЕРШЁННОГО заказа друга.
    owner_paid = 0
    inviter = _int(acc.get('invited_by'))
    reward = invite_owner_sum()
    if inviter and not acc.get('invite_paid_at') and reward:
        started = _int(order.get('created_at'))
        if started >= _int(acc.get('invited_at')):
            friend = db.row('SELECT name FROM clients WHERE id=?', (cid,))
            # Заблокированному не платим и отметку «оплачено» не ставим: разберутся
            # в поддержке и разблокируют — награда догонит его при следующем заходе.
            owner_ok = db.row('SELECT id FROM clients WHERE id=? AND blocked=0', (inviter,))
            if owner_ok:
                with _atomic():
                    # Отметку ставим в той же транзакции, что и выплату: иначе два
                    # одновременных закрытия заплатят за одного друга дважды.
                    mark = db.execute('UPDATE bonus_accounts SET invite_paid_at=? '
                                      'WHERE client_id=? AND invite_paid_at IS NULL',
                                      (db.now(), cid)).rowcount
                    if mark:
                        res = _move(inviter, reward, 'invite_owner', order_id=oid,
                                    ref_client=cid,
                                    note=((friend or {}).get('name') or '').strip() or None)
                        owner_paid = _int(res.get('amount'))
    if cash or owner_paid:
        log('бонусы по заказу', order.get('public_id') or oid,
            '— кэшбек', i18n.fmt_money(_int(got.get('amount'))),
            ('и пригласившему ' + i18n.fmt_money(owner_paid)) if owner_paid else '')
    return {'cashback': _int(got.get('amount')), 'invite_owner': owner_paid,
            'balance': balance(cid)}


def on_order_rated(order, rating=None):
    """Маленький бонус за оценку: без него отзывы просто не пишут."""
    if not enabled() or not isinstance(order, dict):
        return {'amount': 0}
    cid = _int(order.get('client_id'))
    oid = _int(order.get('id'))
    stars = _int(rating if rating is not None else order.get('client_rating'))
    if cid <= 0 or oid <= 0 or not (1 <= stars <= 5):
        return {'amount': 0}
    return accrue(cid, review_sum(), 'review', order_id=oid)


def catch_up(client_id, limit=20):
    """Догоняющее начисление: добираем то, что не начислено по закрытым заказам.

    Обычно кэшбек начисляет тот, кто закрывает заказ. Но заказ могли закрыть в
    обход этого вызова — например, руками из админки, — и человек не должен из-за
    этого остаться без своих бонусов. Поэтому на каждом открытии экрана бонусов
    мы проходим по закрытым заказам без начисления и доначисляем. Повторов не
    будет: за один заказ бонус начисляется ровно один раз.
    """
    ensure_schema()
    cid = _int(client_id)
    if cid <= 0 or not enabled():
        return {'orders': 0, 'amount': 0}
    since = db.now() - expire_days() * 86400
    rows = db.rows(
        'SELECT o.* FROM orders o '
        'LEFT JOIN bonus_log b ON b.order_id = o.id AND b.client_id = o.client_id '
        "                     AND b.reason = 'cashback' "
        "WHERE o.client_id=? AND o.status='done' AND COALESCE(o.done_at, 0) >= ? "
        '  AND b.id IS NULL ORDER BY o.id LIMIT ?',
        (cid, since, _clamp(_int(limit, 20), 1, 50)))
    amount = 0
    for o in rows:
        amount += _int(on_order_done(o).get('cashback'))

    # И награда за друзей, которые уже съездили, а нам об этом не сказали.
    waiting = db.rows('SELECT client_id FROM bonus_accounts '
                      'WHERE invited_by=? AND invite_paid_at IS NULL LIMIT 10', (cid,))
    for w in waiting:
        first = db.row("SELECT * FROM orders WHERE client_id=? AND status='done' "
                       'ORDER BY id LIMIT 1', (w['client_id'],))
        if first:
            amount += _int(on_order_done(first).get('invite_owner'))
    return {'orders': len(rows), 'amount': amount}


def on_order_cancelled(order):
    """Заказ отменён — возвращаем всё, что было списано в него."""
    if not isinstance(order, dict):
        return {'amount': 0}
    return refund(_int(order.get('client_id')), _int(order.get('id')))


# ─────────────────────────────────────────────────────────────── сгорание

def expire_old():
    """Сгорание и предупреждения. Гоняется по расписанию — раз в сутки хватает.

    Возвращает и тех, кого пора предупредить: у клиента нет ни почты, ни пароля,
    поэтому «письмо» здесь — отметка warned_at, по которой приложение показывает
    человеку полосу «бонусы сгорят такого-то числа».
    """
    ensure_schema()
    t = db.now()
    days = expire_days()
    dead_line = t - days * 86400
    warn_line = t - (days - warn_days()) * 86400

    burned_sum = 0
    burned = 0
    rows = db.rows('SELECT client_id, balance FROM bonus_accounts '
                   'WHERE balance > 0 AND COALESCE(last_move_at, created_at) < ?',
                   (dead_line,))
    for r in rows:
        with _atomic():
            # Сгорает всё, что лежит на счету в момент записи, а не то, что мы
            # прочитали списком минуту назад.
            live = _int(_touch(r['client_id']).get('balance'))
            res = _move(r['client_id'], -live, 'expire',
                        note='без заказов %d дней' % days, once=False) if live > 0 else {}
        if _int(res.get('amount')) < 0:
            burned += 1
            burned_sum += -_int(res['amount'])

    warn = db.rows(
        'SELECT a.client_id, a.balance, a.last_move_at, a.created_at, '
        '       c.phone, c.name, c.lang '
        'FROM bonus_accounts a JOIN clients c ON c.id = a.client_id '
        'WHERE a.balance > 0 AND COALESCE(a.last_move_at, a.created_at) < ? '
        '  AND COALESCE(a.last_move_at, a.created_at) >= ? '
        '  AND a.warned_at IS NULL', (warn_line, dead_line))
    warned = []
    for r in warn:
        last = _int(r.get('last_move_at')) or _int(r.get('created_at'))
        db.execute('UPDATE bonus_accounts SET warned_at=? WHERE client_id=? AND warned_at IS NULL',
                   (t, r['client_id']))
        warned.append({'client_id': r['client_id'], 'phone': r.get('phone'),
                       'name': r.get('name'), 'lang': r.get('lang') or 'ru',
                       'balance': _int(r['balance']), 'expires_at': last + days * 86400})
    if burned or warned:
        log('бонусы: сгорело у', burned, 'клиентов на', i18n.fmt_money(burned_sum),
            '· предупреждено', len(warned))
    return {'burned': burned, 'amount': burned_sum, 'warned': warned}


# ─────────────────────────────────────────────────────────────── сводки

def state(client_id, lang='ru', with_history=True):
    """Всё о бонусах одного человека — то, что рисует экран профиля.

    Перед показом добираем неначисленное: экран бонусов — последнее место, где
    человек должен обнаружить, что за прошлый заказ ему ничего не дали.
    """
    lang = i18n.norm_lang(lang)
    acc = account(client_id)
    catch_up(acc['client_id'])
    acc = db.row('SELECT * FROM bonus_accounts WHERE client_id=?', (acc['client_id'],))
    cid = acc['client_id']
    bal = max(0, _int(acc.get('balance')))
    ends = expires_at(cid)
    t = db.now()
    out = {
        'enabled': enabled(),
        'balance': bal,
        'balance_text': i18n.fmt_money(bal, lang),
        'code': invite_code(cid),
        'percent': percent(),
        'max_share': max_share(),
        'invite_friend': invite_friend_sum(),
        'invite_owner': invite_owner_sum(),
        'review': review_sum(),
        'expire_days': expire_days(),
        'expires_at': ends,
        'expiring': bal if ends else 0,
        # предупреждаем заранее, чтобы человек успел заказать и продлить бонусы
        'expire_soon': bool(ends and ends - t <= warn_days() * 86400),
        'days_left': max(0, (ends - t) // 86400) if ends else None,
        'invited': bool(acc.get('invited_by')),
        'invites_done': _int(db.value(
            'SELECT COUNT(*) FROM bonus_accounts WHERE invited_by=? AND invite_paid_at IS NOT NULL',
            (cid,), 0)),
        'invites_waiting': _int(db.value(
            'SELECT COUNT(*) FROM bonus_accounts WHERE invited_by=? AND invite_paid_at IS NULL',
            (cid,), 0)),
    }
    if with_history:
        out['history'] = history(cid, lang=lang)
    return out


def current_settings():
    """Настройки бонусов в том виде, в каком их показывает и сохраняет админка."""
    return {
        'enabled': enabled(),
        'percent': percent(), 'max_share': max_share(),
        'expire_days': expire_days(), 'warn_days': warn_days(),
        'invite_friend': invite_friend_sum(), 'invite_owner': invite_owner_sum(),
        'review': review_sum(), 'signup': signup_sum(),
    }


def stats(limit=30):
    """Сводка для админки: сколько выдано, сколько списано, сколько висит."""
    ensure_schema()
    limit = _clamp(_int(limit, 30), 1, HISTORY_MAX)
    issued = _int(db.value('SELECT COALESCE(SUM(amount),0) FROM bonus_log WHERE amount > 0', (), 0))
    spent = -_int(db.value("SELECT COALESCE(SUM(amount),0) FROM bonus_log WHERE reason='spend'", (), 0))
    burned = -_int(db.value("SELECT COALESCE(SUM(amount),0) FROM bonus_log WHERE reason='expire'", (), 0))
    live = _int(db.value('SELECT COALESCE(SUM(balance),0) FROM bonus_accounts', (), 0))
    moves = db.rows(
        'SELECT b.id, b.at, b.amount, b.balance, b.reason, b.note, b.client_id, '
        '       o.public_id, c.name, c.phone '
        'FROM bonus_log b LEFT JOIN orders o ON o.id = b.order_id '
        'LEFT JOIN clients c ON c.id = b.client_id '
        'ORDER BY b.id DESC LIMIT ?', (limit,))
    return {
        'enabled': enabled(),
        'issued': issued, 'spent': spent, 'burned': burned, 'live': live,
        'clients': _int(db.value('SELECT COUNT(*) FROM bonus_accounts WHERE balance > 0', (), 0)),
        'invites': _int(db.value('SELECT COUNT(*) FROM bonus_accounts WHERE invited_by IS NOT NULL', (), 0)),
        'invites_paid': _int(db.value('SELECT COUNT(*) FROM bonus_accounts WHERE invite_paid_at IS NOT NULL', (), 0)),
        'settings': current_settings(),
        'moves': [{
            'id': m['id'], 'at': m['at'], 'amount': _int(m['amount']),
            'balance': _int(m['balance']), 'reason': m['reason'],
            'text': _move_text(m), 'order': m.get('public_id'),
            'client_id': m['client_id'], 'client': m.get('name') or '',
            'phone': m.get('phone') or '',
        } for m in moves],
    }


# ─────────────────────────────────────────────────────────────── API

def _lang(ctx, fallback='ru'):
    raw = ctx.q('lang')
    if not raw and ctx.method in ('POST', 'PUT', 'PATCH'):
        try:
            raw = ctx.json.get('lang')
        except ApiError:
            raw = None
    if not raw:
        raw = (ctx.header('Accept-Language') or '')[:2]
    return i18n.norm_lang(raw or fallback)


def _client(ctx):
    """Клиент по своему постоянному токену — тому же, что в профиле и истории.
    Регистрации у клиента нет, телефон паролем не считаем."""
    token = ctx.q('token') or ctx.q('t') or ctx.header('X-Client-Token') or ''
    if not token and ctx.method in ('POST', 'PUT', 'PATCH'):
        try:
            token = ctx.json.get('token') or ctx.json.get('client_token') or ''
        except ApiError:
            token = ''
    token = str(token or '').strip().lower()
    if not CLIENT_TOKEN_RX.match(token):
        raise ApiError('client_unknown', say('client.unknown', _lang(ctx)), 401)
    row = db.row('SELECT * FROM clients WHERE token=?', (token,))
    if not row:
        raise ApiError('client_unknown', say('client.unknown', _lang(ctx)), 401)
    if row.get('blocked'):
        forbidden(say('client.blocked', row.get('lang') or _lang(ctx)))
    return row


@router.get(API + '/client/bonus')
def client_bonus(ctx):
    """Баланс, код приглашения, сгорание и история — весь экран бонусов разом."""
    client = _client(ctx)
    return state(client['id'], _lang(ctx, client.get('lang') or 'ru'))


@router.get(API + '/client/bonus/max')
def client_bonus_max(ctx):
    """Сколько бонусов можно списать в заказ такой суммы. Экран заказа спрашивает
    это на каждое изменение цены, поэтому ответ короткий."""
    client = _client(ctx)
    total = max(0, ctx.qi('total', 0))
    bal = balance(client['id'])
    return {'balance': bal, 'max': max_spendable(client['id'], total),
            'cap': cap_for_total(total), 'max_share': max_share(), 'enabled': enabled()}


@router.post(API + '/client/bonus/invite')
def client_bonus_invite(ctx):
    """Применить код друга. Частоту ограничиваем: код короткий, и перебирать его
    никто не должен."""
    client = _client(ctx)
    if not LIMIT.check('bi:' + ctx.ip, INVITE_PER_HOUR, 3600):
        too_many(say('code.often', _lang(ctx)))
    lang = _lang(ctx, client.get('lang') or 'ru')
    code = normalize_code(ctx.need('code', str, 32))
    res = apply_invite(client['id'], code, lang)
    res['bonus'] = state(client['id'], lang, with_history=False)
    return res


@router.get(API + '/admin/bonus')
def admin_bonus(ctx):
    auth.require(ctx, 'admin')
    return stats(ctx.qi('limit', 30))


@router.get(API + '/admin/bonus/clients/{id}')
def admin_bonus_client(ctx, id):
    """Бонусы одного клиента: карточка в админке открывает историю целиком."""
    auth.require(ctx, 'admin')
    out = state(_int(id), 'ru')
    out['history'] = history(_int(id), limit=HISTORY_MAX)
    return out


# Что админ может менять и в каких рамках. Рамки не формальность: процент
# кэшбека выше половины или доля списания выше сотни — это работа в убыток.
LIMITS = {
    'bonus.enabled': ('bool', 0, 0),
    'bonus.percent': ('num', 0, 50),
    'bonus.max_share': ('num', 0, 100),
    'bonus.expire_days': ('int', 1, 3650),
    'bonus.warn_days': ('int', 0, 90),
    'bonus.invite_friend': ('int', 0, 1000000),
    'bonus.invite_owner': ('int', 0, 1000000),
    'bonus.review': ('int', 0, 100000),
    'bonus.signup': ('int', 0, 1000000),
}


@router.put(API + '/admin/bonus/settings')
def admin_bonus_settings(ctx):
    """Настройки бонусов. Присланное зажимаем рамками, а не отвергаем целиком:
    ползунок в браузере мог сдвинуться на единицу дальше, чем мы ждём."""
    auth.require(ctx, 'admin')
    body = ctx.json
    patch = {}
    for key, (kind, low, high) in LIMITS.items():
        short = key.split('.', 1)[1]
        if key in body:
            raw = body[key]
        elif short in body:
            raw = body[short]
        else:
            continue
        if kind == 'bool':
            patch[key] = bool(raw) if not isinstance(raw, str) else raw.lower() in ('1', 'true', 'yes', 'on')
        elif kind == 'int':
            patch[key] = _clamp(_int(raw), low, high)
        else:
            try:
                patch[key] = _clamp(round(float(raw), 2), float(low), float(high))
            except (TypeError, ValueError):
                bad('Неверное значение «%s»' % short, 'bad_field')
    if patch:
        settings.put_many(patch)
    return {'ok': True, 'saved': len(patch), 'settings': current_settings()}


@router.post(API + '/admin/bonus/adjust')
def admin_bonus_adjust(ctx):
    """Ручное начисление или списание: поддержка извинилась перед клиентом.
    Причина обязательна — в журнале должно быть видно, за что."""
    auth.require(ctx, 'admin')
    cid = _int(ctx.need('client_id', int))
    amount = _int(ctx.need('amount', int))
    note = (ctx.field('note', str, 200) or '').strip()
    if not db.row('SELECT id FROM clients WHERE id=?', (cid,)):
        bad('Такого клиента нет', 'client_not_found')
    if amount == 0:
        bad('Сумма не может быть нулевой', 'bad_amount')
    if not note:
        bad('Напишите причину — её будет видно в журнале', 'note_required')
    if amount < 0 and balance(cid) < -amount:
        bad('У клиента столько бонусов нет', 'no_balance')
    res = _move(cid, amount, 'admin', note=note, once=False)
    return {'ok': True, 'amount': res['amount'], 'balance': res['balance']}


@router.post(API + '/admin/bonus/expire')
def admin_bonus_expire(ctx):
    """Прогнать сгорание руками — обычно это делает расписание."""
    auth.require(ctx, 'admin')
    res = expire_old()
    return {'ok': True, 'burned': res['burned'], 'amount': res['amount'],
            'warned': len(res['warned'])}


def register(app):
    """Подключение маршрутов — вызывается из app.py."""
    ensure_schema()
    app.router.include(router)
    return router


# У соседних роутеров точка входа называется по-разному; поддерживаем оба имени.
mount = register
