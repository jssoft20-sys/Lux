#!/usr/bin/env bash
# Ручной запуск без systemd (например, для проверки): bash start.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Нет .env — сначала sudo bash install.sh (или скопируйте .env.example в .env и заполните)"; exit 1; }
set -a; . ./.env; set +a
cd api
[ -d node_modules ] || { echo "Ставлю зависимости…"; npm ci --omit=dev --no-audit --no-fund && npx prisma generate; }
npx prisma migrate deploy
npx tsx prisma/seed.ts || true
exec node dist/main.js
