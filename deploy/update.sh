#!/usr/bin/env bash
# Обновляет код бота с GitHub, не трогая .env и data/. Запуск на сервере от root:
#   bash /opt/lux-bot/deploy/update.sh            # ветка по умолчанию
#   bash /opt/lux-bot/deploy/update.sh main       # другая ветка
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/lux-bot}"
REPO="${REPO:-jssoft20-sys/Lux}"
BRANCH="${1:-claude/trading-bot-news-ncc8jl}"
URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "==> Скачиваю ${URL}"
curl -fsSL "$URL" -o "$TMP/src.tar.gz"
mkdir -p "$TMP/src"
tar xzf "$TMP/src.tar.gz" -C "$TMP/src" --strip-components=1

echo "==> Копирую в ${APP_DIR} (сохраняю .env и data/)"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude '.env' --exclude 'data' --exclude '.venv' --exclude '__pycache__' "$TMP/src/" "$APP_DIR/"
else
  (cd "$TMP/src" && tar cf - --exclude='.env' --exclude='data' .) | (cd "$APP_DIR" && tar xf -)
fi
find "$APP_DIR/bot" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true

echo "==> Зависимости"
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"
chmod +x "$APP_DIR"/deploy/*.sh "$APP_DIR"/scripts/*.sh "$APP_DIR"/run.sh 2>/dev/null || true
id -u lux >/dev/null 2>&1 && chown -R lux:lux "$APP_DIR" || true
chmod 600 "$APP_DIR/.env" 2>/dev/null || true

VERSION="$(cd "$APP_DIR" && "$APP_DIR/.venv/bin/python" -c 'import bot; print(bot.__version__)' 2>/dev/null || echo '?')"
if command -v systemctl >/dev/null 2>&1 && systemctl cat lux-bot.service >/dev/null 2>&1; then
  if systemctl restart lux-bot; then
    echo "==> lux-bot перезапущен, версия ${VERSION}. Логи: journalctl -u lux-bot -f"
  else
    echo "==> Код обновлён (версия ${VERSION}), но перезапуск не удался: systemctl status lux-bot"
  fi
else
  echo "==> Код обновлён (версия ${VERSION}); сервис lux-bot не найден, перезапустите бот вручную"
fi
