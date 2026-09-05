#!/usr/bin/env bash
# Установка OnoiPay на сервер в /home/onoi (Ubuntu/Debian). Запуск от root:
#   bash scripts/install.sh
# Скрипт идемпотентен: повторный запуск обновляет зависимости и сервисы, не трогая .env и БД.
set -euo pipefail

APP_USER=onoi
APP_HOME=/home/onoi
APP_DIR="$APP_HOME/onoi"
PY=python3

echo "== OnoiPay install =="
if ! id "$APP_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$APP_USER"
fi
mkdir -p "$APP_HOME/data" "$APP_HOME/logs" "$APP_HOME/backups"

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  echo "-- копирую проект в $APP_DIR"
  mkdir -p "$APP_DIR"
  rsync -a --delete --exclude venv --exclude .env --exclude data --exclude '__pycache__' "$SRC_DIR/" "$APP_DIR/"
fi

echo "-- системные пакеты"
apt-get update -qq
apt-get install -y -qq python3-venv python3-dev build-essential libzbar0 nginx postgresql postgresql-contrib rsync >/dev/null

echo "-- python venv"
if [ ! -d "$APP_DIR/venv" ]; then
  sudo -u "$APP_USER" $PY -m venv "$APP_DIR/venv"
fi
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install -q --upgrade pip
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install -q -r "$APP_DIR/requirements.txt" zxing-cpp
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install -q -e "$APP_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "-- создаю .env из шаблона"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  SECRETS="$(sudo -u "$APP_USER" "$APP_DIR/venv/bin/python" -m onoipay.cli gen-secrets)"
  while IFS='=' read -r key value; do
    [ -z "$key" ] && continue
    case "$key" in \#*) continue;; esac
    sed -i "s|^$key=.*|$key=$value|" "$APP_DIR/.env"
  done <<< "$SECRETS"
  chmod 600 "$APP_DIR/.env"
  echo "   !! Заполните MAIN_BOT_TOKEN, SUPPORT_BOT_TOKEN, DATABASE_URL, SMTP_* в $APP_DIR/.env"
fi
chown -R "$APP_USER:$APP_USER" "$APP_HOME"

echo "-- PostgreSQL"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='onoi'" | grep -q 1; then
  DB_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 28)"
  sudo -u postgres psql -qc "CREATE USER onoi WITH PASSWORD '$DB_PASS';"
  sudo -u postgres psql -qc "CREATE DATABASE onoipay OWNER onoi;"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql+psycopg://onoi:$DB_PASS@127.0.0.1:5432/onoipay|" "$APP_DIR/.env"
  echo "   создана БД onoipay (пароль записан в .env)"
fi

echo "-- миграции и seed"
cd "$APP_DIR"
sudo -u "$APP_USER" env -i HOME="$APP_HOME" PATH="$APP_DIR/venv/bin:/usr/bin:/bin" bash -c "set -a; . ./.env; set +a; alembic upgrade head && python -m onoipay.cli seed"

echo "-- systemd"
for unit in onoipay-backend onoipay-worker onoipay-bot onoipay-support; do
  cp "$APP_DIR/deployment/systemd/$unit.service" /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable onoipay-backend onoipay-worker onoipay-bot onoipay-support >/dev/null

echo "-- nginx snippets (не подключаются автоматически)"
mkdir -p /etc/nginx/snippets
cp "$APP_DIR/deployment/nginx/onoipay.conf" /etc/nginx/snippets/onoipay.conf
cp "$APP_DIR/deployment/nginx/onoipay-proxy.conf" /etc/nginx/snippets/onoipay-proxy.conf
echo "   добавьте 'include /etc/nginx/snippets/onoipay.conf;' в server{} блок домена wwweeewww.fit,"
echo "   объявите limit_req_zone (см. deployment/nginx/onoipay-full-server.example.conf) и выполните: nginx -t && systemctl reload nginx"

echo
echo "Готово. Дальше:"
echo "  1) nano $APP_DIR/.env   — токены ботов, SMTP, ADMIN_TELEGRAM_CHAT_IDS"
echo "  2) sudo -u onoi bash -c 'cd $APP_DIR && set -a && . ./.env && set +a && venv/bin/python -m onoipay.cli create-admin'"
echo "  3) systemctl restart onoipay-backend onoipay-worker onoipay-bot onoipay-support"
echo "  4) curl -s http://127.0.0.1:7031/healthz"
