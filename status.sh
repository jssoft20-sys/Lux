#!/usr/bin/env bash
# Sprinter Go — статус сервера и последние строки лога
set -euo pipefail
cd "$(dirname "$0")"
PIDFILE=".server.pid"
PORT="${PORT:-7022}"

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo "✔ Работает. PID $(cat "$PIDFILE") — http://${IP:-IP_СЕРВЕРА}:${PORT}/"
else
  echo "✖ Не запущен (./start.sh — запустить)"
fi

if command -v ss >/dev/null 2>&1; then
  echo "— Порт ${PORT}:"; ss -ltnp 2>/dev/null | grep ":${PORT} " || echo "  никто не слушает"
fi

if [[ -f server.log ]]; then
  echo "— Последние 20 строк server.log:"
  tail -n 20 server.log
fi
