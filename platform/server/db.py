# -*- coding: utf-8 -*-
"""SQLite: схема, миграции и удобные помощники.

Соединение своё на каждый поток — sqlite3 не разрешает делить одно между потоками.
Режим WAL, чтобы чтение не блокировалось записью: у нас много читателей (живая карта,
отслеживание заказа) и мало писателей.

Деньги везде — целое число тыйынов (1 сом = 100 тыйынов). Ни одного float в расчётах,
иначе на сотнях заказов накопится расхождение в копейках, которое никто не объяснит.
Время везде — целые секунды unix в UTC.
"""
import json, os, sqlite3, threading, time

SCHEMA_VERSION = 3
_local = threading.local()
_path = None
_write_lock = threading.RLock()      # sqlite не любит параллельную запись даже в WAL


def init(path):
    global _path
    _path = os.path.abspath(path)
    os.makedirs(os.path.dirname(_path), exist_ok=True)
    conn = connect()
    _migrate(conn)
    return conn


def connect():
    conn = getattr(_local, 'conn', None)
    if conn is None:
        conn = sqlite3.connect(_path, timeout=15, isolation_level=None,
                               check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA synchronous=NORMAL')
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA busy_timeout=15000')
        _local.conn = conn
    return conn


# ─────────────────────────────────────────────────────────────── помощники

def rows(sql, args=()):
    return [dict(r) for r in connect().execute(sql, args).fetchall()]


def row(sql, args=()):
    r = connect().execute(sql, args).fetchone()
    return dict(r) if r else None


def value(sql, args=(), default=None):
    r = connect().execute(sql, args).fetchone()
    return r[0] if r and r[0] is not None else default


def execute(sql, args=()):
    with _write_lock:
        cur = connect().execute(sql, args)
        return cur


def insert(table, data):
    cols = list(data.keys())
    sql = 'INSERT INTO %s (%s) VALUES (%s)' % (
        table, ','.join(cols), ','.join('?' * len(cols)))
    with _write_lock:
        cur = connect().execute(sql, [data[c] for c in cols])
        return cur.lastrowid


def update(table, data, where, args=()):
    if not data:
        return 0
    cols = list(data.keys())
    sql = 'UPDATE %s SET %s WHERE %s' % (table, ','.join(f'{c}=?' for c in cols), where)
    with _write_lock:
        cur = connect().execute(sql, [data[c] for c in cols] + list(args))
        return cur.rowcount


class tx:
    """Транзакция: with db.tx(): ... — откат при исключении."""

    def __enter__(self):
        _write_lock.acquire()
        connect().execute('BEGIN IMMEDIATE')
        return self

    def __exit__(self, exc_type, *_):
        try:
            connect().execute('ROLLBACK' if exc_type else 'COMMIT')
        finally:
            _write_lock.release()
        return False


def now():
    return int(time.time())


def jdump(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'))


def jload(s, default=None):
    if not s:
        return default
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return default


# ─────────────────────────────────────────────────────────────── схема

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL, email TEXT UNIQUE, phone TEXT, name TEXT,
  password_hash TEXT, avatar TEXT, status TEXT NOT NULL DEFAULT 'pending',
  lang TEXT NOT NULL DEFAULT 'ru',
  created_at INTEGER NOT NULL, last_login_at INTEGER);
CREATE INDEX IF NOT EXISTS ix_users_role ON users(role, status);

CREATE TABLE IF NOT EXISTS couriers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vehicle_class TEXT, car_model TEXT, car_plate TEXT, car_color TEXT,
  body_w INTEGER, body_d INTEGER, body_h INTEGER, capacity_kg INTEGER,
  rating_sum INTEGER NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0,
  orders_done INTEGER NOT NULL DEFAULT 0, orders_cancelled INTEGER NOT NULL DEFAULT 0,
  offers_sent INTEGER NOT NULL DEFAULT 0, offers_taken INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  online INTEGER NOT NULL DEFAULT 0, busy INTEGER NOT NULL DEFAULT 0,
  lat REAL, lng REAL, heading REAL, speed REAL, geo_at INTEGER,
  balance INTEGER NOT NULL DEFAULT 0, note TEXT);
CREATE INDEX IF NOT EXISTS ix_couriers_avail ON couriers(online, busy);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL, name TEXT, avatar TEXT, lang TEXT NOT NULL DEFAULT 'ru',
  orders_count INTEGER NOT NULL DEFAULT 0,
  rating_sum INTEGER NOT NULL DEFAULT 0, rating_count INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_order_at INTEGER);

CREATE TABLE IF NOT EXISTS tariffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
  name_ru TEXT NOT NULL, name_ky TEXT NOT NULL, desc_ru TEXT, desc_ky TEXT,
  vehicle_class TEXT, icon TEXT,
  base_price INTEGER NOT NULL DEFAULT 0, included_km REAL NOT NULL DEFAULT 0,
  included_min INTEGER NOT NULL DEFAULT 0,
  per_km INTEGER NOT NULL DEFAULT 0, per_min INTEGER NOT NULL DEFAULT 0,
  min_price INTEGER NOT NULL DEFAULT 0,
  waiting_free_min INTEGER NOT NULL DEFAULT 10, waiting_per_min INTEGER NOT NULL DEFAULT 0,
  loaders_included INTEGER NOT NULL DEFAULT 0,
  loader_hour_price INTEGER NOT NULL DEFAULT 0, loader_min_hours REAL NOT NULL DEFAULT 1,
  body_w INTEGER, body_d INTEGER, body_h INTEGER, capacity_kg INTEGER,
  sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
  name_ru TEXT NOT NULL, name_ky TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'fixed',
  price INTEGER NOT NULL DEFAULT 0, unit_ru TEXT, unit_ky TEXT,
  min_qty REAL NOT NULL DEFAULT 1, max_qty REAL NOT NULL DEFAULT 20, step REAL NOT NULL DEFAULT 1,
  tariff_ids TEXT, sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT UNIQUE NOT NULL, track_token TEXT NOT NULL,
  client_id INTEGER REFERENCES clients(id), courier_id INTEGER REFERENCES users(id),
  tariff_id INTEGER REFERENCES tariffs(id),
  status TEXT NOT NULL DEFAULT 'draft', lang TEXT NOT NULL DEFAULT 'ru',
  points TEXT NOT NULL, distance_m INTEGER NOT NULL DEFAULT 0,
  duration_s INTEGER NOT NULL DEFAULT 0, route TEXT,
  loaders INTEGER NOT NULL DEFAULT 0, extras TEXT,
  price_base INTEGER NOT NULL DEFAULT 0, price_distance INTEGER NOT NULL DEFAULT 0,
  price_time INTEGER NOT NULL DEFAULT 0, price_loaders INTEGER NOT NULL DEFAULT 0,
  price_extras INTEGER NOT NULL DEFAULT 0, price_waiting INTEGER NOT NULL DEFAULT 0,
  price_total INTEGER NOT NULL DEFAULT 0,
  commission INTEGER NOT NULL DEFAULT 0, courier_payout INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'cash', payment_status TEXT NOT NULL DEFAULT 'none',
  payment_id TEXT, paid_amount INTEGER NOT NULL DEFAULT 0,
  comment TEXT, cancel_reason TEXT, cancelled_by TEXT,
  created_at INTEGER NOT NULL, searching_at INTEGER, assigned_at INTEGER,
  at_pickup_at INTEGER, started_at INTEGER, done_at INTEGER, cancelled_at INTEGER,
  waiting_s INTEGER NOT NULL DEFAULT 0, waiting_from INTEGER,
  client_rating INTEGER, client_comment TEXT,
  courier_rating INTEGER, courier_comment TEXT);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_courier ON orders(courier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_orders_client ON orders(client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  at INTEGER NOT NULL, actor TEXT, type TEXT NOT NULL, data TEXT);
CREATE INDEX IF NOT EXISTS ix_events_order ON order_events(order_id, at);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  courier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent', distance_m INTEGER, score REAL);
CREATE INDEX IF NOT EXISTS ix_offers_courier ON offers(courier_id, status);
CREATE INDEX IF NOT EXISTS ix_offers_order ON offers(order_id, status);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ua TEXT, ip TEXT);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS geo_track (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  courier_id INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_track ON geo_track(courier_id, at DESC);

CREATE TABLE IF NOT EXISTS mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, to_addr TEXT, subject TEXT, template TEXT,
  status TEXT, error TEXT, at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,                 -- client | courier | system
  text TEXT NOT NULL, at INTEGER NOT NULL, read_at INTEGER);
CREATE INDEX IF NOT EXISTS ix_messages_order ON messages(order_id, id);

CREATE TABLE IF NOT EXISTS reset_tokens (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
"""


# Колонки, добавленные после первой версии. ALTER TABLE ADD COLUMN в sqlite
# не умеет IF NOT EXISTS, поэтому смотрим, что уже есть, и досыпаем недостающее.
ADDED_COLUMNS = {
    'couriers': [
        ('verify_status', "TEXT NOT NULL DEFAULT 'none'"),   # none|pending|approved|rejected
        ('verify_photo', 'TEXT'),                            # файл фото с паспортом
        ('verify_note', 'TEXT'),                             # причина отказа
        ('verified_at', 'INTEGER'),
        ('photo', 'TEXT'),                                   # аватар курьера
        # Часы на линии. Считаем на сервере, а не в телефоне: водитель меняет
        # телефон, чистит браузер, выходит с двух устройств — а цифра, на
        # которую он смотрит весь день, должна быть одна и та же.
        ('online_since', 'INTEGER'),                         # когда вышел на линию
        ('online_s', 'INTEGER NOT NULL DEFAULT 0'),          # накоплено за сегодня
        ('online_day', 'INTEGER NOT NULL DEFAULT 0'),        # за какой день накоплено
    ],
    'clients': [
        ('token', 'TEXT'),          # опознаём вернувшегося клиента без регистрации
        ('name_asked', 'INTEGER NOT NULL DEFAULT 0'),
    ],
}


def _migrate(conn):
    with _write_lock:
        conn.executescript(SCHEMA)
        for table, cols in ADDED_COLUMNS.items():
            have = {r[1] for r in conn.execute(f'PRAGMA table_info({table})')}
            for name, decl in cols:
                if name not in have:
                    conn.execute(f'ALTER TABLE {table} ADD COLUMN {name} {decl}')
        conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_clients_token '
                     'ON clients(token) WHERE token IS NOT NULL')
        conn.execute('CREATE INDEX IF NOT EXISTS ix_couriers_verify '
                     'ON couriers(verify_status)')
        cur_version = conn.execute('PRAGMA user_version').fetchone()[0]
        if cur_version != SCHEMA_VERSION:
            conn.execute(f'PRAGMA user_version={SCHEMA_VERSION}')


def cleanup():
    """Периодическая уборка: просроченные сессии, старый трек, протухшие предложения."""
    t = now()
    execute('DELETE FROM sessions WHERE expires_at < ?', (t,))
    execute('DELETE FROM reset_tokens WHERE expires_at < ?', (t,))
    execute('DELETE FROM geo_track WHERE at < ?', (t - 7 * 86400,))
    execute("UPDATE offers SET status='expired' WHERE status='sent' AND expires_at < ?", (t,))
    execute('DELETE FROM mail_log WHERE at < ?', (t - 90 * 86400,))
