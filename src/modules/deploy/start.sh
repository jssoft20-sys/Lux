#!/usr/bin/env bash
# Sprinter Go — запуск сайта для проверки: http://IP_СЕРВЕРА:7022
# Использование: ./start.sh            (порт 7022)
#                PORT=8080 ./start.sh  (другой порт)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-7022}"
HOST="${HOST:-0.0.0.0}"
PIDFILE=".server.pid"
LOG="server.log"

if ! command -v python3 >/dev/null 2>&1; then
  echo "✖ python3 не найден. Установите: sudo apt install -y python3   (Ubuntu/Debian)"
  echo "                                sudo dnf install -y python3   (CentOS/Alma/Rocky)"
  exit 1
fi

# Уже запущен?
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "ℹ Сервер уже запущен (PID $(cat "$PIDFILE")). Остановить: ./stop.sh, перезапустить: ./restart.sh"
  exit 0
fi
rm -f "$PIDFILE"

# Порт занят другим процессом?
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  echo "✖ Порт ${PORT} уже занят другим процессом. Освободите его или задайте другой: PORT=8080 ./start.sh"
  exit 1
fi

nohup python3 server.py --port "$PORT" --host "$HOST" --root "$(pwd)" >"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "$PORT" >".server.port"
sleep 1

if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "✖ Сервер не запустился. Последние строки лога:"
  tail -n 20 "$LOG" || true
  rm -f "$PIDFILE"
  exit 1
fi

# Проверка ответа
if python3 - "$PORT" <<'PY' 2>/dev/null; then
import sys, urllib.request
port = sys.argv[1]
with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5) as r:
    sys.exit(0 if r.status == 200 else 1)
PY
  STATUS="OK (HTTP 200)"
else
  STATUS="ответ не получен — смотрите $LOG"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -z "${IP:-}" ]] && command -v curl >/dev/null 2>&1; then
  IP="$(curl -s --max-time 3 ifconfig.me || true)"
fi
[[ -z "${IP:-}" ]] && IP="IP_СЕРВЕРА"

echo "✔ Sprinter Go запущен. PID $(cat "$PIDFILE"), проверка: $STATUS"
echo "  Откройте в браузере:  http://${IP}:${PORT}/"
echo "  Лог:                  $(pwd)/$LOG"
echo "  Остановить:           ./stop.sh     Статус: ./status.sh"
echo ""
echo "  Если страница не открывается снаружи — откройте порт в файрволе:"
echo "    Ubuntu/Debian:  sudo ufw allow ${PORT}/tcp"
echo "    CentOS/Alma:    sudo firewall-cmd --permanent --add-port=${PORT}/tcp && sudo firewall-cmd --reload"
