#!/usr/bin/env bash
# Somex — установка тестового стенда на Ubuntu/Debian (один порт, по умолчанию 7055).
# Запуск: sudo bash install.sh            (из распакованной папки somex/)
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"
PORT="${PORT:-7055}"
DB_PASS="${DB_PASS:-somex}"

log() { printf '\033[1;32m[somex]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[somex]\033[0m %s\n' "$*"; }
need_root() { if [ "$(id -u)" -ne 0 ]; then echo "Запустите от root: sudo bash install.sh"; exit 1; fi; }
need_root

if ! command -v apt-get >/dev/null 2>&1; then
  warn "Автоустановка поддерживает Ubuntu/Debian (apt). Для других систем: поставьте Node 22, PostgreSQL 14+, Redis 6+ и запустите start.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q >/dev/null

# ── Node.js 22 ──
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  log "Устанавливаю Node.js 22"
  apt-get install -y -q curl ca-certificates gnupg >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -q nodejs >/dev/null
fi
log "Node $(node -v)"

# ── PostgreSQL + Redis ──
if ! command -v psql >/dev/null 2>&1; then log "Устанавливаю PostgreSQL"; apt-get install -y -q postgresql >/dev/null; fi
if ! command -v redis-server >/dev/null 2>&1; then log "Устанавливаю Redis"; apt-get install -y -q redis-server >/dev/null; fi
systemctl enable --now postgresql >/dev/null 2>&1 || service postgresql start
systemctl enable --now redis-server >/dev/null 2>&1 || service redis-server start

# ── база ──
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='somex'\"" | grep -q 1 || su - postgres -c "psql -c \"CREATE USER somex WITH PASSWORD '$DB_PASS';\"" >/dev/null
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='somex'\"" | grep -q 1 || su - postgres -c "psql -c \"CREATE DATABASE somex OWNER somex;\"" >/dev/null
log "База somex готова"

# ── .env ──
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$IP" ] && IP="127.0.0.1"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s#^MASTER_KEY=.*#MASTER_KEY=$(openssl rand -hex 32)#; s#^JWT_ACCESS_SECRET=.*#JWT_ACCESS_SECRET=$(openssl rand -hex 32)#; s#^JWT_REFRESH_SECRET=.*#JWT_REFRESH_SECRET=$(openssl rand -hex 32)#" .env
  sed -i "s#SERVER_IP#$IP#g; s#^API_PORT=.*#API_PORT=$PORT#; s#^DATABASE_URL=.*#DATABASE_URL=postgresql://somex:$DB_PASS@localhost:5432/somex?schema=public#" .env
  log ".env создан (секреты сгенерированы)"
else
  log ".env уже есть — оставляю"
fi
set -a; . ./.env; set +a

# ── память: npm ci на VPS с 1 ГБ RAM убивает OOM-killer, поэтому при нехватке добавляем swap ──
MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
SWAP_MB="$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ $((MEM_MB + SWAP_MB)) -lt 2500 ] && [ ! -f /swapfile ]; then
  log "Мало памяти (${MEM_MB} МБ RAM, ${SWAP_MB} МБ swap) — создаю swap 2 ГБ"
  if (fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none) && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile; then
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  else
    warn "Swap создать не удалось (контейнер без поддержки swap?). Если npm ci будет убит, добавьте памяти серверу."
    rm -f /swapfile
  fi
fi

# ── зависимости API (ставятся заново, если изменился package-lock.json — например, после обновления архива) ──
LOCK_SUM="$(sha256sum api/package-lock.json | cut -c1-16)"
if [ ! -d api/node_modules ] || [ "$(cat api/node_modules/.somex-lock 2>/dev/null)" != "$LOCK_SUM" ]; then
  log "Устанавливаю зависимости API (npm ci, 2–5 минут)"
  apt-get install -y -q python3 make g++ >/dev/null   # на случай сборки нативных модулей
  rm -rf api/node_modules                              # остатки прерванной установки
  if ! (cd api && NODE_OPTIONS=--max-old-space-size=768 npm ci --omit=dev --no-audit --no-fund --loglevel=error 2>&1 | tail -5); then
    warn "npm ci не завершился. Обычно это нехватка памяти: проверьте free -h, добавьте swap и запустите install.sh снова."
    exit 1
  fi
  log "Генерирую Prisma client"
  (cd api && npx prisma generate >/dev/null)
  echo "$LOCK_SUM" > api/node_modules/.somex-lock
elif ! node -e "require('./api/node_modules/argon2'); require('./api/node_modules/sharp')" >/dev/null 2>&1; then
  warn "Пересобираю нативные модули под этот сервер"
  apt-get install -y -q python3 make g++ >/dev/null
  (cd api && npm rebuild argon2 sharp >/dev/null 2>&1 || true)
fi

# ── миграции и сид ──
log "Применяю миграции"
(cd api && npx prisma migrate deploy >/dev/null)
log "Заполняю справочники и тестовые аккаунты"
(cd api && npx tsx prisma/seed.ts >/dev/null)

# ── systemd ──
cat > /etc/systemd/system/somex.service <<UNIT
[Unit]
Description=Somex P2P (test mode)
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
WorkingDirectory=$ROOT/api
EnvironmentFile=$ROOT/.env
ExecStart=$(command -v node) dist/main.js
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now somex >/dev/null
systemctl restart somex
sleep 4

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then ufw allow "$PORT"/tcp >/dev/null || true; fi

if curl -fsS "http://127.0.0.1:$PORT/api/v1/health" >/dev/null; then
  echo
  log "══════════════════════════════════════════════════════"
  log " Готово! Somex запущен в ТЕСТОВОМ режиме"
  log "   Приложение:  http://$IP:$PORT"
  log "   Админка:     http://$IP:$PORT/admin"
  log "   API / Swagger: http://$IP:$PORT/api/docs"
  log ""
  log " Вход в приложение: ЛЮБОЙ номер +996, код $TEST_OTP_CODE"
  log "   +996 500 000 000 — Тестов Тест (5 000 USDT, KYC ✓, PIN 0000)"
  log "   +996 555 123 456 — Бекжан Абдыкадыров (1 250 USDT, KYC ✓, PIN 1234)"
  log "   +996 700 111 222 — AltynTrade, продавец (18 500 USDT)"
  log " Админка: $ADMIN_EMAIL / $ADMIN_PASSWORD (2FA выключен в тест-режиме)"
  log ""
  log " Логи: journalctl -u somex -f    Перезапуск: systemctl restart somex"
  log "══════════════════════════════════════════════════════"
else
  warn "Сервис не ответил. Смотрите: journalctl -u somex -n 100 --no-pager"
  exit 1
fi
