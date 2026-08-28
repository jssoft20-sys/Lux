#!/usr/bin/env bash
# Запуск Telegram-мессенджера на порту 8044 (по умолчанию), слушает все интерфейсы.
set -e
cd "$(dirname "$0")"

export PORT="${PORT:-8044}"
export HOST="${HOST:-0.0.0.0}"

if [ ! -d node_modules ]; then
  echo "==> Устанавливаю зависимости (npm install)…"
  npm install --no-audit --no-fund
fi

echo "==> Запускаю сервер на ${HOST}:${PORT}"
exec node server/index.js
