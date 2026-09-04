#!/usr/bin/env bash
# Перенос касс 1xBet/1win и банковских реквизитов из старого config.json (LUXON).
#   scripts/import_legacy.sh /path/to/old/config.json [--enable 1xbet,1win]
# Старые пароли, токены и SMTP из config.json НЕ переносятся.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
PY="${PYTHON:-venv/bin/python}"; [ -x "$PY" ] || PY=python3
exec "$PY" -m onoipay.cli import-legacy "$@"
