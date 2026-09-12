#!/usr/bin/env bash
# Sprinter Go — остановка сервера, запущенного через ./start.sh
set -euo pipefail
cd "$(dirname "$0")"
PIDFILE=".server.pid"
PORT="${PORT:-7022}"

stopped=0
if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    for _ in 1 2 3 4 5; do kill -0 "$PID" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$PID" 2>/dev/null || true
    stopped=1
  fi
  rm -f "$PIDFILE"
fi

# На всякий случай — процессы, запущенные вручную с этим портом
if pkill -f "server.py --port ${PORT}" 2>/dev/null; then stopped=1; fi

if [[ $stopped -eq 1 ]]; then
  echo "✔ Сервер остановлен."
else
  echo "ℹ Сервер не был запущен."
fi
