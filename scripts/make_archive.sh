#!/usr/bin/env bash
# Собирает архив для переноса на сервер: lux-bot-<версия>.tar.gz (без .env, без данных, без git).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(python3 -c 'import bot; print(bot.__version__)' 2>/dev/null || echo dev)"
OUT="${1:-lux-bot-${VERSION}.tar.gz}"
tar --exclude='.git' --exclude='.env' --exclude='data' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='.pytest_cache' --exclude='.venv' --exclude='*.tar.gz' \
    --transform "s,^\./,lux-bot/," -czf "$OUT" .
echo "Архив: $OUT ($(du -h "$OUT" | cut -f1))"
