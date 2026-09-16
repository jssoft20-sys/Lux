#!/usr/bin/env bash
# Все приёмочные прогоны разом. Один запуск — и видно, цел ли сервис.
#
# Прогоны поднимают свои серверы на свободных портах и работают с пустой базой,
# рабочую не трогают. Запускать можно прямо на сервере, ничего не сломается.
#
#   bash tools/check.sh          все прогоны
#   bash tools/check.sh быстро   только те, которым не нужен браузер
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${TEST_PORT:-7180}"
FAST="${1:-}"
NODE="$(command -v node || true)"
failed=()
ran=0

line() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

run() {           # run «имя» команда...
  local name="$1"; shift
  line "$name"
  ran=$((ran + 1))
  if "$@"; then
    printf '\033[32mпройдено:\033[0m %s\n' "$name"
  else
    printf '\033[31mпровалено:\033[0m %s\n' "$name"
    failed+=("$name")
  fi
}

run "ядро: база, маршруты, деньги"      python3 tools/core_test.py
run "API: заказ целиком"                env TEST_PORT=$((PORT + 1)) python3 tools/api_test.py
run "деньги: бронь и уведомление банка" env TEST_PORT=$((PORT + 2)) python3 tools/pay_test.py
run "карточка для мессенджеров"         python3 tools/share_test.py
run "переписка: повторы и обрывы"       python3 tools/chat_test.py
run "свой кодировщик QR"                python3 tools/qr_test.py

if [ "$FAST" = "быстро" ] || [ -z "$NODE" ]; then
  [ -z "$NODE" ] && printf '\n\033[33mnode не найден — прогоны с браузером пропущены\033[0m\n'
else
  # Эти три работают в настоящем браузере, поэтому им нужен поднятый сервис.
  UIPORT=$((PORT + 3))
  UIDATA="$(mktemp -d)"
  SG_DATA="$UIDATA" PORT="$UIPORT" SG_ADMIN_EMAIL=admin@test.kg \
    SG_ADMIN_PASSWORD=admin12345 python3 app.py > "$UIDATA/server.log" 2>&1 &
  srv=$!
  for _ in $(seq 40); do
    sleep 0.4
    curl -sf -o /dev/null "http://127.0.0.1:$UIPORT/api/v1/config" && break
  done

  run "оболочка и заставка"   env TEST_PORT=$UIPORT SG_DATA="$UIDATA" node tools/shell_test.mjs
  run "вёрстка на телефоне"   env TEST_PORT=$UIPORT SG_DATA="$UIDATA" node tools/ui_test.mjs
  run "экран оплаты"          env TEST_PORT=$UIPORT SG_DATA="$UIDATA" \
      SG_ADMIN_EMAIL=admin@test.kg SG_ADMIN_PASSWORD=admin12345 node tools/payui_test.mjs
  run "карта: серые дыры"     env TEST_PORT=$UIPORT SG_DATA="$UIDATA" node tools/map_test.mjs
  run "сценарий: заказ вживую" env TEST_PORT=$UIPORT SG_DATA="$UIDATA" node tools/flow_test.mjs
  run "ссылка: живая карта"    env TEST_PORT=$UIPORT SG_DATA="$UIDATA" node tools/watch_test.mjs
  run "мостик в приложение"    env TEST_PORT=$UIPORT SG_DATA="$UIDATA" node tools/app_test.mjs
  run "чат при обрыве связи"   env TEST_PORT=$UIPORT SG_DATA="$UIDATA" node tools/chatui_test.mjs

  kill "$srv" 2>/dev/null
  wait "$srv" 2>/dev/null
  rm -rf "$UIDATA"
fi

printf '\n\033[1m════ итог ════\033[0m\n'
if [ ${#failed[@]} -eq 0 ]; then
  printf '\033[32mВсе %d прогонов прошли.\033[0m\n' "$ran"
  exit 0
fi
printf '\033[31mПровалено %d из %d:\033[0m\n' "${#failed[@]}" "$ran"
for n in "${failed[@]}"; do printf '  · %s\n' "$n"; done
exit 1
