#!/usr/bin/env bash
# Проверка здоровья: HTTP, БД, сервисы systemd. Код выхода 0 — всё в порядке.
set -uo pipefail
PORT="${PORT:-7031}"
ok=0
if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null; then echo "backend: ok"; else echo "backend: FAIL"; ok=1; fi
if curl -fsS "http://127.0.0.1:${PORT}/onoipay/api/health" | grep -q '"database": *"ok"'; then echo "database: ok"; else echo "database: FAIL"; ok=1; fi
if command -v systemctl >/dev/null; then
  for unit in onoipay-backend onoipay-worker onoipay-bot onoipay-support; do
    if systemctl is-active --quiet "$unit"; then echo "$unit: active"; else echo "$unit: INACTIVE"; ok=1; fi
  done
fi
exit $ok
