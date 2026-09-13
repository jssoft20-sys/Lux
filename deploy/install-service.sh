#!/usr/bin/env bash
# Sprinter Go — установка systemd-службы (автозапуск после перезагрузки сервера)
# Запуск: sudo bash /home/gotaxi/deploy/install-service.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SITE_DIR="$(cd "$HERE/.." && pwd)"
UNIT_SRC="$HERE/sprinter-go.service"
UNIT_DST="/etc/systemd/system/sprinter-go.service"

if [[ $EUID -ne 0 ]]; then echo "Запустите с sudo: sudo bash $0"; exit 1; fi
command -v python3 >/dev/null || { echo "python3 не найден"; exit 1; }

# Подставляем фактический путь к сайту (если он не /home/gotaxi)
sed "s#/home/gotaxi#${SITE_DIR}#g" "$UNIT_SRC" > "$UNIT_DST"
chmod 644 "$UNIT_DST"

# Останавливаем ручной запуск, если был
[[ -x "$SITE_DIR/stop.sh" ]] && "$SITE_DIR/stop.sh" >/dev/null 2>&1 || true

systemctl daemon-reload
systemctl enable --now sprinter-go
sleep 1
systemctl --no-pager --lines=5 status sprinter-go || true
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "✔ Служба sprinter-go установлена и запущена: http://${IP:-IP_СЕРВЕРА}:7022/"
echo "  Управление: systemctl restart|stop|status sprinter-go ; логи: journalctl -u sprinter-go -f"
