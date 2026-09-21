#!/usr/bin/env bash
# Собирает архив для переноса на сервер: lux-bot-<версия>.tar.gz (без данных, без git).
# По умолчанию .env НЕ включается. Чтобы включить свой .env с ключами:  INCLUDE_ENV=1 bash scripts/make_archive.sh
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(python3 -c 'import bot; print(bot.__version__)' 2>/dev/null || echo dev)"
OUT="${1:-lux-bot-${VERSION}.tar.gz}"
EXCL=(--exclude='.git' --exclude='data' --exclude='__pycache__' --exclude='*.pyc' --exclude='.pytest_cache' --exclude='.venv' --exclude='*.tar.gz')
if [[ "${INCLUDE_ENV:-0}" != "1" ]]; then EXCL+=(--exclude='.env'); fi
tar "${EXCL[@]}" --transform "s,^\./,lux-bot/," -czf "$OUT" .
echo "Архив: $OUT ($(du -h "$OUT" | cut -f1))$( [[ "${INCLUDE_ENV:-0}" == "1" ]] && echo ' — ВКЛЮЧАЕТ .env с ключами, не публикуйте его')"
