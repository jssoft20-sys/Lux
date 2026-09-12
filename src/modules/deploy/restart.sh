#!/usr/bin/env bash
# Sprinter Go — перезапуск сервера (например, после обновления файлов сайта)
set -euo pipefail
cd "$(dirname "$0")"
./stop.sh || true
exec ./start.sh
