#!/usr/bin/env bash
# Создать администратора: scripts/create_admin.sh [--username NAME --password PASS --role owner]
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
PY="${PYTHON:-venv/bin/python}"; [ -x "$PY" ] || PY=python3
exec "$PY" -m onoipay.cli create-admin "$@"
