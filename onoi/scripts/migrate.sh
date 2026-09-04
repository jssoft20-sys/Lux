#!/usr/bin/env bash
# Применить миграции БД (использует DATABASE_URL из .env).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
PY="${PYTHON:-venv/bin/python}"; [ -x "$PY" ] || PY=python3
exec "${PY%/python}/alembic" upgrade "${1:-head}" 2>/dev/null || exec alembic upgrade "${1:-head}"
