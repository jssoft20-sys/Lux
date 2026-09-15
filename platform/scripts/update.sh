#!/usr/bin/env bash
# Обновление сервиса из распакованного архива.
#
# Почему отдельный скрипт, а не набор команд: обновление нельзя оборвать на
# середине. Здесь служба останавливается, код заменяется целиком, служба
# поднимается и проверяется — а если не поднялась, всё возвращается как было.
# Папка data не трогается никогда: там заказы, курьеры и настройки.
#
#   sudo ./scripts/update.sh /tmp/sgnew/sprintergo-platform
set -uo pipefail

SRC="${1:-}"
DEST="${SG_DEST:-/home/sprintergo-platform}"
SERVICE="${SG_SERVICE:-sprintergo-platform}"
PORT="${SG_PORT:-7030}"
CODE=(app.py server web scripts deploy tools README.md SPEC.md)

red() { printf '\033[31m%s\033[0m\n' "$*"; }
ok()  { printf '\033[32m%s\033[0m\n' "$*"; }

if [ -z "$SRC" ]; then
  echo "Укажите папку с новой версией:"
  echo "  cd /home && unzip -oq sprintergo-platform.zip -d /tmp/sgnew"
  echo "  sudo $DEST/scripts/update.sh /tmp/sgnew/sprintergo-platform"
  exit 2
fi
[ -f "$SRC/app.py" ] || { red "В $SRC нет app.py — это не папка с новой версией."; exit 2; }
[ -d "$DEST" ] || { red "Не найдена установка в $DEST."; exit 2; }

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$DEST/.backup-$STAMP"
echo "Обновляем $DEST"
echo "  копия старого кода: $BACKUP"
mkdir -p "$BACKUP"
for item in "${CODE[@]}"; do
  [ -e "$DEST/$item" ] && cp -r "$DEST/$item" "$BACKUP/" 2>/dev/null
done

restore() {
  red "Откатываемся на прежнюю версию."
  for item in "${CODE[@]}"; do
    [ -e "$BACKUP/$item" ] && { rm -rf "${DEST:?}/$item"; cp -r "$BACKUP/$item" "$DEST/"; }
  done
  systemctl start "$SERVICE" >/dev/null 2>&1
  sleep 3
  red "Вернули как было. Служба: $(systemctl is-active "$SERVICE" 2>/dev/null)"
}

systemctl stop "$SERVICE" >/dev/null 2>&1
sleep 1

copied=0
for item in "${CODE[@]}"; do
  if [ -e "$SRC/$item" ]; then
    rm -rf "${DEST:?}/$item"
    if cp -r "$SRC/$item" "$DEST/"; then copied=$((copied+1)); else red "не скопировалось: $item"; restore; exit 1; fi
  fi
done
echo "  заменено частей: $copied"
find "$DEST" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null
chmod +x "$DEST"/scripts/*.sh 2>/dev/null

systemctl start "$SERVICE" >/dev/null 2>&1
up=0
for _ in $(seq 1 40); do
  sleep 0.5
  if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$PORT/api/v1/config" 2>/dev/null)" = "200" ]; then up=1; break; fi
done

if [ "$up" != "1" ]; then
  red "Новая версия не поднялась. Последнее из журнала:"
  tail -n 25 "$DEST/data/service.log" 2>/dev/null | sed 's/^/    /'
  restore
  exit 1
fi

ok "Готово. Служба: $(systemctl is-active "$SERVICE")"
echo "  версия базы и данные не тронуты"
echo "  копия старого кода лежит в $BACKUP — можно удалить, когда убедитесь, что всё работает"
# старые копии не копим
ls -1dt "$DEST"/.backup-* 2>/dev/null | tail -n +4 | xargs -r rm -rf
