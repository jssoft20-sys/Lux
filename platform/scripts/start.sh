#!/usr/bin/env bash
# Запуск Sprinter Go в фоне.
#
# Кладём номер процесса в data/sprintergo.pid, весь вывод — в data/sprintergo.log,
# ждём, пока сервис реально ответит, и печатаем адреса для входа. Если что-то
# пошло не так, показываем хвост журнала: искать его самому не придётся.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${SG_DATA:-$ROOT/data}"
PID_FILE="${SG_PID:-$DATA/sprintergo.pid}"
LOG_FILE="${SG_LOG:-$DATA/sprintergo.log}"
PORT="${PORT:-7030}"
HOST="${HOST:-0.0.0.0}"
PY="${PYTHON:-python3}"

if ! command -v "$PY" >/dev/null 2>&1; then
  echo "Не нашёлся $PY. Поставьте Python 3: sudo apt install -y python3" >&2
  exit 1
fi

mkdir -p "$DATA"

# Живой ли процесс с таким номером.
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# Занят ли порт. Проверяем через сам Python: ss и lsof есть не на каждом сервере.
port_busy() {
  "$PY" - "$PORT" <<'PYEOF'
import socket, sys
s = socket.socket()
s.settimeout(1)
try:
    s.connect(('127.0.0.1', int(sys.argv[1])))
    sys.exit(0)
except OSError:
    sys.exit(1)
finally:
    s.close()
PYEOF
}

# Отвечает ли сервис по-настоящему, а не просто держит порт.
answers() {
  "$PY" - "$PORT" <<'PYEOF'
import sys, urllib.request
try:
    with urllib.request.urlopen(
            'http://127.0.0.1:%s/api/v1/config' % sys.argv[1], timeout=2) as r:
        sys.exit(0 if r.status == 200 else 1)
except Exception:
    sys.exit(1)
PYEOF
}

# ── уже работает? ────────────────────────────────────────────────────────────
if [ -f "$PID_FILE" ]; then
  OLD="$(cat "$PID_FILE" 2>/dev/null || true)"
  if alive "$OLD"; then
    echo "Sprinter Go уже работает, номер процесса $OLD."
    echo "Перезапустить:  $ROOT/scripts/restart.sh"
    exit 0
  fi
  rm -f "$PID_FILE"
  echo "Нашёлся старый pid-файл от упавшего процесса — убрал."
fi

if port_busy; then
  echo "Порт $PORT занят кем-то другим." >&2
  echo "Или остановите то приложение, или запустите нас на другом порту:" >&2
  echo "    PORT=$((PORT + 10)) $ROOT/scripts/start.sh" >&2
  exit 1
fi

# ── запуск ───────────────────────────────────────────────────────────────────
FIRST_RUN=0
[ -s "$LOG_FILE" ] || FIRST_RUN=1

{
  echo
  echo "===== запуск $(date '+%d.%m.%Y %H:%M:%S') ====="
} >> "$LOG_FILE"

cd "$ROOT"
PORT="$PORT" HOST="$HOST" PYTHONUNBUFFERED=1 \
  nohup "$PY" app.py >> "$LOG_FILE" 2>&1 &
NEW=$!
echo "$NEW" > "$PID_FILE"
disown "$NEW" 2>/dev/null || true

# ── ждём, пока поднимется ────────────────────────────────────────────────────
printf 'Поднимаем сервис'
for _ in $(seq 1 40); do
  if ! alive "$NEW"; then
    echo
    echo "Сервис не запустился. Последние строки журнала:" >&2
    tail -n 25 "$LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
  if answers; then
    echo ' — готово.'
    break
  fi
  printf '.'
  sleep 0.5
done

if ! answers; then
  echo
  echo "Процесс живёт, но за 20 секунд так и не ответил. Журнал:" >&2
  tail -n 25 "$LOG_FILE" >&2
  exit 1
fi

# ── куда заходить ────────────────────────────────────────────────────────────
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP" ] || IP="127.0.0.1"

echo
echo "  Клиенты   http://$IP:$PORT/"
echo "  Курьеры   http://$IP:$PORT/courier"
echo "  Панель    http://$IP:$PORT/admin"
echo
echo "  Номер процесса $NEW · журнал $LOG_FILE"

if [ "$FIRST_RUN" = "1" ] && grep -qs '^ *Пароль ' "$LOG_FILE"; then
  echo
  echo "  Это первый запуск. Вход в панель управления:"
  grep -E '^ +(Почта|Пароль) ' "$LOG_FILE" | tail -n 2 | sed 's/^ */    /'
  echo
  echo "  Запишите пароль: второй раз он нигде не покажется."
fi
echo
