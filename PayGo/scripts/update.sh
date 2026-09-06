#!/usr/bin/env bash
# Обновление проекта из нового архива/каталога с откатом при ошибке миграции.
#   scripts/update.sh /path/to/new/paygo
set -euo pipefail
NEW_SRC="${1:?укажите каталог с новой версией}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
scripts/backup.sh
systemctl stop paygo-bot paygo-support paygo-worker || true
rsync -a --exclude venv --exclude .env --exclude data --exclude '__pycache__' "$NEW_SRC/" "$APP_DIR/"
venv/bin/pip install -q -r requirements.txt zxing-cpp
venv/bin/pip install -q -e .
set -a; . ./.env; set +a
if ! venv/bin/alembic upgrade head; then
  echo "!! миграция не прошла — откат: scripts/restore.sh <последний backup>"; exit 1
fi
venv/bin/python -m paygo.cli seed >/dev/null || true
systemctl restart paygo-backend
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://127.0.0.1:${PORT:-7035}/healthz" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:${PORT:-7035}/healthz" >/dev/null 2>&1; then
  echo "!! backend не поднялся, смотрите /home/PayGo/logs/backend.log (боты и worker не запущены)"; exit 1
fi
systemctl start paygo-worker paygo-bot paygo-support
sleep 2
scripts/healthcheck.sh || { echo "!! часть сервисов не поднялась: systemctl status paygo-worker paygo-bot paygo-support"; exit 1; }
echo "update: done"
