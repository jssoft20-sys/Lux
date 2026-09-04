#!/usr/bin/env bash
# Сгенерировать новые секреты для .env (печатает строки KEY=VALUE).
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-venv/bin/python}"; [ -x "$PY" ] || PY=python3
APP_ENV=dev exec "$PY" -m onoipay.cli gen-secrets
