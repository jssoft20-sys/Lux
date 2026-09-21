#!/usr/bin/env bash
# Быстрый запуск без systemd/docker:  ./run.sh
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then cp .env.example .env; echo "Создан .env — впишите ключи и запустите снова"; exit 1; fi
if [[ ! -x .venv/bin/python ]]; then python3 -m venv .venv; .venv/bin/pip install --quiet --upgrade pip; fi
.venv/bin/pip install --quiet -r requirements.txt
exec .venv/bin/python -m bot.main
