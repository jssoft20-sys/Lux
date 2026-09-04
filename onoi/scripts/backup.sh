#!/usr/bin/env bash
# Резервная копия: дамп PostgreSQL + data/ (загрузки) + .env → /home/onoi/backups/onoipay-YYYYmmdd-HHMM.tar.gz
# Хранит последние 14 копий. Cron: 0 3 * * * /home/onoi/onoi/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
case "${DATABASE_URL:-}" in
  postgresql*) pg_dump --no-owner --format=custom "${DATABASE_URL#postgresql+psycopg://}" > "$TMP/db.dump" 2>/dev/null || pg_dump --no-owner --format=custom "$(echo "$DATABASE_URL" | sed 's|postgresql+psycopg://|postgresql://|')" > "$TMP/db.dump";;
  sqlite*) cp "${DATABASE_URL#sqlite:///}" "$TMP/db.sqlite3";;
esac
[ -d "${DATA_DIR:-data}" ] && cp -r "${DATA_DIR:-data}" "$TMP/data"
cp .env "$TMP/env.backup"
tar -czf "$BACKUP_DIR/onoipay-$STAMP.tar.gz" -C "$TMP" .
ls -1t "$BACKUP_DIR"/onoipay-*.tar.gz | tail -n +15 | xargs -r rm -f
echo "backup: $BACKUP_DIR/onoipay-$STAMP.tar.gz"
