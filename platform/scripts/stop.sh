#!/usr/bin/env bash
# Остановка Sprinter Go.
#
# Сначала вежливо: SIGTERM. Сервис успевает закрыть живые подключения, дописать
# начатое в базу и дослать письма из очереди. Не ушёл за 20 секунд — добиваем.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${SG_DATA:-$ROOT/data}"
PID_FILE="${SG_PID:-$DATA/sprintergo.pid}"

alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

if [ ! -f "$PID_FILE" ]; then
  echo "Сервис не запущен: файла $PID_FILE нет."
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"

if ! alive "$PID"; then
  echo "Процесса $PID уже нет — убираю pid-файл."
  rm -f "$PID_FILE"
  exit 0
fi

printf 'Останавливаем процесс %s' "$PID"
kill -TERM "$PID" 2>/dev/null || true

for _ in $(seq 1 40); do
  if ! alive "$PID"; then
    rm -f "$PID_FILE"
    echo ' — остановлен.'
    exit 0
  fi
  printf '.'
  sleep 0.5
done

echo
echo "За 20 секунд не завершился, придётся жёстко." >&2
kill -KILL "$PID" 2>/dev/null || true
sleep 1

if alive "$PID"; then
  echo "Процесс $PID не убился. Разбирайтесь руками: ps -p $PID" >&2
  exit 1
fi

rm -f "$PID_FILE"
echo "Остановлен принудительно."
