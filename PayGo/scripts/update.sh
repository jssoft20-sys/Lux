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
systemctl restart paygo-backend
sleep 2
scripts/healthcheck.sh || { echo "!! backend не поднялся, смотрите /home/PayGo/logs/backend.log"; exit 1; }
systemctl start paygo-worker paygo-bot paygo-support
echo "update: done"
