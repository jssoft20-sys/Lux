#!/usr/bin/env bash
# Заполнить базовые данные (кассы 1xBet/1win, кнопки банков). Идемпотентно.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
PY="${PYTHON:-venv/bin/python}"; [ -x "$PY" ] || PY=python3
exec "$PY" -m onoipay.cli seed
