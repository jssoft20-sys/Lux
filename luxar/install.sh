#!/usr/bin/env bash
# Установка Luxar Autorent на Ubuntu/Debian: запускать из папки проекта (например /home/luxar)
set -e
cd "$(dirname "$0")"
DIR="$(pwd)"
echo "Папка проекта: $DIR"

if ! command -v node >/dev/null 2>&1 || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 18 ]; then
  echo "Устанавливаю Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node: $(node -v)"

if [ ! -d node_modules ]; then
  echo "Устанавливаю зависимости…"
  npm install --omit=dev --no-audit --no-fund
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Создан .env — при необходимости отредактируйте (порт, пароль администратора)."
fi

mkdir -p data uploads

if command -v systemctl >/dev/null 2>&1; then
  sed "s#/home/luxar#$DIR#g" deploy/luxar.service > /etc/systemd/system/luxar.service
  systemctl daemon-reload
  systemctl enable luxar >/dev/null
  systemctl restart luxar
  sleep 2
  systemctl --no-pager status luxar | head -5
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo
  echo "Готово. Сайт:   http://${IP:-IP-сервера}:${PORT:-7088}"
  echo "        Админка: http://${IP:-IP-сервера}:${PORT:-7088}/admin"
  echo "Логи: journalctl -u luxar -f"
else
  echo "systemd не найден. Запуск вручную: npm start"
fi
