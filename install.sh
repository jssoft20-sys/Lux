#!/usr/bin/env bash
# LuxOn Optima Hub — установка на сервер.
set -e
cd "$(dirname "$0")"

echo "==> [1/4] Проверка окружения"
command -v python3 >/dev/null || { echo "Нужен Python 3.9+"; exit 1; }
command -v node   >/dev/null || { echo "Нужен Node.js 18+ (https://nodejs.org)"; exit 1; }
python3 --version; node --version

echo "==> [2/4] Установка Node-зависимостей (Playwright)"
npm install

echo "==> [3/4] Установка Chromium для Playwright"
npx playwright install chromium
# Системные библиотеки для Chromium (нужен root/sudo). Не критично, если упадёт —
# поставьте вручную: npx playwright install-deps chromium
npx playwright install-deps chromium 2>/dev/null || \
  sudo npx playwright install-deps chromium 2>/dev/null || \
  echo "   (пропущено: доустановите системные зависимости Chromium вручную при необходимости)"

echo "==> [4/4] Инициализация базы и привязка кошелька (из .env: OPTIMA_SEED_*)"
if [ ! -f .env ]; then
  echo "   .env не найден — копирую из .env.example (отредактируйте перед запуском!)"
  cp .env.example .env
fi
python3 optima.py --init

echo
echo "Готово. Запуск сервера:"
echo "    python3 optima.py --serve"
echo "Затем откройте http://СЕРВЕР:7094/ и войдите паролем из OPTIMA_ADMIN_PASSWORD (.env)."
echo "Ключи кошельков:   python3 optima.py --keys"
echo "Автозапуск (systemd): см. optima.service и README.md"
