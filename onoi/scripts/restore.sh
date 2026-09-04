#!/usr/bin/env bash
# Восстановление из архива: scripts/restore.sh /home/onoi/backups/onoipay-YYYYmmdd-HHMM.tar.gz
# ВНИМАНИЕ: перезаписывает базу данных. Остановите сервисы перед запуском.
set -euo pipefail
ARCHIVE="${1:?укажите архив}"
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
tar -xzf "$ARCHIVE" -C "$TMP"
case "${DATABASE_URL:-}" in
  postgresql*)
    URL="$(echo "$DATABASE_URL" | sed 's|postgresql+psycopg://|postgresql://|')"
    pg_restore --clean --if-exists --no-owner -d "$URL" "$TMP/db.dump";;
  sqlite*) cp "$TMP/db.sqlite3" "${DATABASE_URL#sqlite:///}";;
esac
[ -d "$TMP/data" ] && rsync -a "$TMP/data/" "${DATA_DIR:-data}/"
echo "restore: done — запустите сервисы: systemctl start onoipay-backend onoipay-worker onoipay-bot onoipay-support"
