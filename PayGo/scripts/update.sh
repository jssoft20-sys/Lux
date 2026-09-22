#!/usr/bin/env bash
# Обновление проекта из нового архива/каталога с откатом при ошибке миграции. Запуск от root:
#   unzip -o /home/paygo.zip -d /tmp/paygo-new
#   /home/PayGo/scripts/update.sh /tmp/paygo-new/PayGo
# Порядок: backup → стоп ботов и worker → rsync кода → pip → права → миграции → seed → рестарт backend → healthcheck → старт остальных.
# .env, venv/, data/, logs/, backups/ на сервере не трогаются.
set -euo pipefail
NEW_SRC="${1:?укажите каталог с новой версией}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${APP_USER:-paygo}"
cd "$APP_DIR"
if [ ! -f "$NEW_SRC/pyproject.toml" ] || [ ! -d "$NEW_SRC/backend/paygo" ]; then
  echo "!! в $NEW_SRC нет проекта PayGo (ожидается каталог с pyproject.toml и backend/paygo)"; exit 1
fi
scripts/backup.sh
systemctl stop paygo-bot paygo-support paygo-worker || true
rsync -a --exclude venv --exclude .env --exclude data --exclude logs --exclude backups \
  --exclude '__pycache__' --exclude '*.pyc' --exclude '.pytest_cache' --exclude '*.egg-info' \
  "$NEW_SRC/" "$APP_DIR/"
venv/bin/pip install -q -r requirements.txt zxing-cpp
venv/bin/pip install -q -e .
chmod +x scripts/*.sh || true
# лишние экземпляры PayGo (ручные запуски, старый docker compose) убираются, иначе два бота делят одни обновления (409 Conflict)
[ -x scripts/kill_stray.sh ] && scripts/kill_stray.sh --only-kill --quiet || true
# файлы, скопированные от root, должны принадлежать пользователю сервисов
if id "$APP_USER" >/dev/null 2>&1; then chown -R "$APP_USER:$APP_USER" "$APP_DIR"; fi
[ -f .env ] && chmod 600 .env
# юниты systemd могли обновиться (перезапуск ниже подхватит изменения)
if [ -d deployment/systemd ] && command -v systemctl >/dev/null 2>&1; then
  for unit in deployment/systemd/paygo-*.service; do
    [ -f "$unit" ] || continue
    if ! cmp -s "$unit" "/etc/systemd/system/$(basename "$unit")"; then cp "$unit" /etc/systemd/system/; fi
  done
  systemctl daemon-reload
fi
set -a; . ./.env; set +a
if ! venv/bin/alembic upgrade head; then
  echo "!! миграция не прошла — откат: scripts/restore.sh <последний backup>"; exit 1
fi
venv/bin/python -m paygo.cli seed >/dev/null || true
# тестовый вывод для проверки панели (один раз, нужна хотя бы одна касса): Главная → Актуальные, клиент «Тест PayGo»
if [ ! -f data/.demo_withdrawal ] && venv/bin/python scripts/demo_withdrawal.py \
    --qr "https://qr.finik.kg/f36e0f6a-1f22-4f34-a177-71444f6c91aa?type=t" --amount 150 >/dev/null 2>&1; then
  touch data/.demo_withdrawal
  if id "$APP_USER" >/dev/null 2>&1; then chown "$APP_USER:$APP_USER" data/.demo_withdrawal; fi
fi
systemctl restart paygo-backend
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  curl -fsS "http://127.0.0.1:${PORT:-7035}/healthz" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:${PORT:-7035}/healthz" >/dev/null 2>&1; then
  echo "!! backend не поднялся, смотрите /home/PayGo/logs/backend.log (боты и worker не запущены)"; exit 1
fi
systemctl start paygo-worker paygo-bot paygo-support
sleep 3
scripts/healthcheck.sh || { echo "!! часть сервисов не поднялась: systemctl status paygo-worker paygo-bot paygo-support"; exit 1; }
echo "update: done ($(venv/bin/python -c 'import paygo; print(paygo.__version__)' 2>/dev/null || echo '?'))"
