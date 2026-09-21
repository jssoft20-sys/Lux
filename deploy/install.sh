#!/usr/bin/env bash
# Установка Continental BOT на сервер Ubuntu/Debian как systemd-сервис (порт 7066).
# Запуск от root в распакованной папке архива:  sudo bash deploy/install.sh
set -euo pipefail

APP_DIR=/opt/lux-bot
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-7066}"

if [[ $EUID -ne 0 ]]; then echo "Запустите от root: sudo bash deploy/install.sh"; exit 1; fi

echo "==> Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip curl >/dev/null

echo "==> Пользователь и папки"
id -u lux >/dev/null 2>&1 || useradd -r -m -d /var/lib/lux -s /usr/sbin/nologin lux
mkdir -p "$APP_DIR"
rsync -a --delete --exclude '.venv' --exclude 'data' --exclude '.env' --exclude '.git' "$SRC_DIR/" "$APP_DIR/" 2>/dev/null || cp -r "$SRC_DIR/." "$APP_DIR/"
mkdir -p "$APP_DIR/data"

echo "==> Python-окружение"
if [[ ! -x "$APP_DIR/.venv/bin/python" ]]; then python3 -m venv "$APP_DIR/.venv"; fi
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

if [[ ! -f "$APP_DIR/.env" ]]; then
  if [[ -f "$SRC_DIR/.env" ]]; then
    cp "$SRC_DIR/.env" "$APP_DIR/.env"
  else
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16 || true)"
    sed -i "s/^DASHBOARD_PASSWORD=.*/DASHBOARD_PASSWORD=${PASS}/" "$APP_DIR/.env"
    echo "   Создан $APP_DIR/.env — пароль дашборда: ${PASS} (логин lux)"
  fi
fi
sed -i "s/^PORT=.*/PORT=${PORT}/" "$APP_DIR/.env"
chown -R lux:lux "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "==> systemd"
cp "$APP_DIR/deploy/lux-bot.service" /etc/systemd/system/lux-bot.service
systemctl daemon-reload
systemctl enable lux-bot >/dev/null
systemctl restart lux-bot

if command -v ufw >/dev/null 2>&1; then ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true; fi

sleep 4
IP="$(curl -s --max-time 4 https://api.ipify.org || hostname -I | awk '{print $1}')"
echo
echo "================================================================"
echo "  Continental BOT установлен и запущен."
echo "  Дашборд:   http://${IP}:${PORT}/"
echo "  Логи:      journalctl -u lux-bot -f"
echo "  Настройки: $APP_DIR/.env   (после правки: systemctl restart lux-bot)"
echo "================================================================"
systemctl --no-pager --lines=5 status lux-bot || true
