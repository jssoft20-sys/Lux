#!/usr/bin/env bash
# Установка PayGo на сервер в /home/PayGo (Ubuntu 22.04/24.04, Debian 12). Запуск от root:
#   unzip -o /home/paygo.zip -d /home/ && bash /home/PayGo/scripts/install.sh
# Всё живёт в одном каталоге: /home/PayGo/{backend,bot,frontend,venv,data,logs,backups,.env}
# Скрипт идемпотентен: повторный запуск обновляет зависимости и сервисы, не трогая .env и БД.
set -euo pipefail
trap 'echo "!! ошибка на шаге: $BASH_COMMAND (строка $LINENO)"; exit 1' ERR

APP_USER=paygo
APP_HOME=/home/PayGo
APP_DIR="$APP_HOME"

echo "== PayGo install =="
if [ "$(id -u)" != "0" ]; then echo "!! запустите от root: sudo bash scripts/install.sh"; exit 1; fi

echo "-- системные пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-dev build-essential libzbar0 nginx postgresql postgresql-contrib rsync unzip curl >/dev/null

# Python: берём самый новый из установленных (3.12 / 3.11 / 3.10)
PY=""
for candidate in python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then PY="$candidate"; break; fi
done
if [ -z "$PY" ]; then echo "!! нужен Python 3.10+ (на Ubuntu 22.04: apt install python3.11 python3.11-venv python3.11-dev)"; exit 1; fi
if ! "$PY" -m venv --help >/dev/null 2>&1; then apt-get install -y -qq "${PY}-venv" "${PY}-dev" >/dev/null || true; fi
echo "   python: $("$PY" --version)"

if ! id "$APP_USER" &>/dev/null; then
  mkdir -p "$APP_HOME"
  useradd -M -d "$APP_HOME" -s /bin/bash "$APP_USER"
fi
mkdir -p "$APP_HOME/data" "$APP_HOME/logs" "$APP_HOME/backups"

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  echo "-- копирую проект $SRC_DIR -> $APP_DIR"
  mkdir -p "$APP_DIR"
  rsync -a --delete --exclude venv --exclude .env --exclude data --exclude '__pycache__' "$SRC_DIR/" "$APP_DIR/"
  if [ -f "$SRC_DIR/.env" ] && [ ! -f "$APP_DIR/.env" ]; then cp "$SRC_DIR/.env" "$APP_DIR/.env"; fi
fi
chown -R "$APP_USER:$APP_USER" "$APP_HOME"

echo "-- python venv"
if [ -d "$APP_DIR/venv" ] && ! "$APP_DIR/venv/bin/python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
  rm -rf "$APP_DIR/venv"
fi
if [ ! -d "$APP_DIR/venv" ]; then
  sudo -u "$APP_USER" "$PY" -m venv "$APP_DIR/venv"
fi
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install -q --upgrade pip
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install -q -r "$APP_DIR/requirements.txt" zxing-cpp
sudo -u "$APP_USER" "$APP_DIR/venv/bin/pip" install -q -e "$APP_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  echo "-- создаю .env из шаблона"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  SECRETS="$(sudo -u "$APP_USER" "$APP_DIR/venv/bin/python" -m paygo.cli gen-secrets)"
  while IFS='=' read -r key value; do
    [ -z "$key" ] && continue
    case "$key" in \#*) continue;; esac
    sed -i "s|^$key=.*|$key=$value|" "$APP_DIR/.env"
  done <<< "$SECRETS"
  echo "   !! Заполните MAIN_BOT_TOKEN, SUPPORT_BOT_TOKEN, SMTP_* в $APP_DIR/.env"
fi
chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

echo "-- PostgreSQL"
systemctl enable --now postgresql >/dev/null 2>&1 || true
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='paygo'" | grep -q 1; then
  DB_PASS="$("$PY" -c 'import secrets; print(secrets.token_hex(16))')"
  sudo -u postgres psql -qc "CREATE USER paygo WITH PASSWORD '$DB_PASS';"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql+psycopg://paygo:$DB_PASS@127.0.0.1:5432/paygo|" "$APP_DIR/.env"
  echo "   создан пользователь БД paygo (пароль записан в .env)"
elif grep -q "CHANGE_ME_DB_PASSWORD" "$APP_DIR/.env"; then
  DB_PASS="$("$PY" -c 'import secrets; print(secrets.token_hex(16))')"
  sudo -u postgres psql -qc "ALTER USER paygo WITH PASSWORD '$DB_PASS';"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql+psycopg://paygo:$DB_PASS@127.0.0.1:5432/paygo|" "$APP_DIR/.env"
  echo "   пользователь БД paygo уже был — задан новый пароль, записан в .env"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='paygo'" | grep -q 1; then
  sudo -u postgres psql -qc "CREATE DATABASE paygo OWNER paygo;"
  echo "   создана база paygo"
fi

echo "-- миграции и seed"
cd "$APP_DIR"
sudo -u "$APP_USER" env -i HOME="$APP_HOME" PATH="$APP_DIR/venv/bin:/usr/bin:/bin" bash -c "set -a; . ./.env; set +a; alembic upgrade head && python -m paygo.cli seed"

echo "-- systemd"
for unit in paygo-backend paygo-worker paygo-bot paygo-support; do
  cp "$APP_DIR/deployment/systemd/$unit.service" /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable paygo-backend paygo-worker paygo-bot paygo-support >/dev/null

echo "-- nginx: сниппеты и зоны limit_req (сам server{} домена не трогаем)"
mkdir -p /etc/nginx/snippets /etc/nginx/conf.d
cp "$APP_DIR/deployment/nginx/paygo.conf" /etc/nginx/snippets/paygo.conf
cp "$APP_DIR/deployment/nginx/paygo-proxy.conf" /etc/nginx/snippets/paygo-proxy.conf
cp "$APP_DIR/deployment/nginx/paygo-zones.conf" /etc/nginx/conf.d/paygo-zones.conf

echo
echo "Готово. Дальше:"
echo "  1) nano $APP_DIR/.env   — проверьте токены ботов, SMTP, ADMIN_TELEGRAM_CHAT_IDS"
echo "  2) sudo -u paygo $APP_DIR/scripts/create_admin.sh --username admin --role owner"
echo "  3) systemctl restart paygo-backend paygo-worker paygo-bot paygo-support"
echo "  4) curl -s http://127.0.0.1:7035/healthz"
echo "  5) nginx: добавьте 'include /etc/nginx/snippets/paygo.conf;' в server{} блок wwweeewww.fit (см. README, раздел 10), затем nginx -t && systemctl reload nginx"
