#!/usr/bin/env bash
# Что сейчас с сервисом: работает ли, отвечает ли, что в базе и что в журнале.
# Ничего не меняет — можно дёргать хоть каждую минуту.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${SG_DATA:-$ROOT/data}"
PID_FILE="${SG_PID:-$DATA/sprintergo.pid}"
LOG_FILE="${SG_LOG:-$DATA/sprintergo.log}"
DB_FILE="${SG_DB:-$DATA/sprintergo.sqlite3}"
PORT="${PORT:-7030}"
PY="${PYTHON:-python3}"

alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# Размер файла и его спутников. Для базы это важно: свежие записи лежат
# в файле -wal, и без него база выглядит подозрительно маленькой.
human_size() {
  local total=0 f
  for f in "$@"; do
    [ -f "$f" ] || continue
    total=$(( total + $(wc -c < "$f") ))
  done
  awk -v b="$total" 'BEGIN {
    if (b >= 1073741824) printf "%.1f ГБ", b/1073741824;
    else if (b >= 1048576) printf "%.1f МБ", b/1048576;
    else if (b >= 1024) printf "%.0f КБ", b/1024;
    else printf "%d Б", b;
  }'
}

echo
echo "Sprinter Go — состояние на $(date '+%d.%m.%Y %H:%M:%S')"
echo "────────────────────────────────────────────────────────"

# ── процесс ──────────────────────────────────────────────────────────────────
PID=""
[ -f "$PID_FILE" ] && PID="$(cat "$PID_FILE" 2>/dev/null || true)"

if alive "$PID"; then
  UP="$(ps -p "$PID" -o etime= 2>/dev/null | tr -d ' ')"
  MEM="$(ps -p "$PID" -o rss= 2>/dev/null | awk '{printf "%.0f МБ", $1/1024}')"
  echo "  Процесс    работает, номер $PID, в строю ${UP:-?}, память ${MEM:-?}"
else
  if [ -n "$PID" ]; then
    echo "  Процесс    НЕ работает (в pid-файле остался номер $PID)"
  else
    echo "  Процесс    НЕ работает"
  fi
fi

# ── ответ по сети ────────────────────────────────────────────────────────────
"$PY" - "$PORT" <<'PYEOF'
import json, sys, time, urllib.request

# Отчёт часто читают через head или less: тогда труба закрывается на полуслове,
# и без этой строчки Python вываливает пугающий Traceback вместо тишины.
import signal
try:
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
except (AttributeError, ValueError):
    pass

port = sys.argv[1]
started = time.time()
try:
    with urllib.request.urlopen(
            'http://127.0.0.1:%s/api/v1/config' % port, timeout=3) as r:
        body = json.loads(r.read().decode('utf-8'))
    ms = int((time.time() - started) * 1000)
    print('  Сеть       отвечает на порту %s за %d мс, тарифов %d'
          % (port, ms, len(body.get('tariffs') or [])))
except Exception as e:
    print('  Сеть       НЕ отвечает на порту %s (%s)' % (port, e))
PYEOF

# ── база ─────────────────────────────────────────────────────────────────────
if [ -f "$DB_FILE" ]; then
  echo "  База       $DB_FILE ($(human_size "$DB_FILE" "$DB_FILE-wal"))"
  "$PY" - "$DB_FILE" <<'PYEOF'
import sqlite3, sys, time

# Отчёт часто читают через head или less: тогда труба закрывается на полуслове,
# и без этой строчки Python вываливает пугающий Traceback вместо тишины.
import signal
try:
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
except (AttributeError, ValueError):
    pass

try:
    c = sqlite3.connect('file:%s?mode=ro' % sys.argv[1], uri=True, timeout=5)
except sqlite3.Error as e:
    print('  Данные     прочитать не вышло: %s' % e)
    raise SystemExit(0)


def one(sql, args=()):
    try:
        return c.execute(sql, args).fetchone()[0] or 0
    except sqlite3.Error:
        return 0


live = ('searching', 'assigned', 'to_pickup', 'at_pickup', 'in_transit', 'at_dropoff')
day = int(time.time()) - 86400
marks = ','.join('?' * len(live))
print('  Заказы     всего %d · за сутки %d · в работе прямо сейчас %d'
      % (one('SELECT COUNT(*) FROM orders'),
         one('SELECT COUNT(*) FROM orders WHERE created_at >= ?', (day,)),
         one('SELECT COUNT(*) FROM orders WHERE status IN (%s)' % marks, live)))
print('  Деньги     за сутки выполнено на %d сом, комиссия %d сом'
      % (one("SELECT COALESCE(SUM(price_total),0) FROM orders "
             "WHERE status='done' AND done_at >= ?", (day,)) // 100,
         one("SELECT COALESCE(SUM(commission),0) FROM orders "
             "WHERE status='done' AND done_at >= ?", (day,)) // 100))
print('  Курьеры    на смене %d · всего активных %d · ждут проверки %d'
      % (one('SELECT COUNT(*) FROM couriers WHERE online=1'),
         one("SELECT COUNT(*) FROM users WHERE role='courier' AND status='active'"),
         one("SELECT COUNT(*) FROM users WHERE role='courier' AND status='pending'")))
print('  Клиенты    %d · писем за сутки отправлено %d, не ушло %d'
      % (one('SELECT COUNT(*) FROM clients'),
         one("SELECT COUNT(*) FROM mail_log WHERE status='sent' AND at >= ?", (day,)),
         one("SELECT COUNT(*) FROM mail_log WHERE status='failed' AND at >= ?", (day,))))
c.close()
PYEOF
else
  echo "  База       ещё не создана — сервис ни разу не запускался"
fi

# ── журнал ───────────────────────────────────────────────────────────────────
if [ -f "$LOG_FILE" ]; then
  ERR="$(grep -c 'ОШИБКА\|Traceback' "$LOG_FILE" 2>/dev/null || true)"
  echo "  Журнал     $LOG_FILE ($(human_size "$LOG_FILE")), ошибок в нём: ${ERR:-0}"
  echo
  echo "  Последнее из журнала:"
  tail -n 8 "$LOG_FILE" | sed 's/^/    /'
else
  echo "  Журнал     пока пуст"
fi
echo

alive "$PID" || exit 1
exit 0
