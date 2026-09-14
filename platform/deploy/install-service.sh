#!/usr/bin/env bash
# Установка Sprinter Go как службы systemd: сервис поднимается сам после
# перезагрузки сервера и сам встаёт обратно, если вдруг упадёт.
#
# Запускать от root на распакованном архиве:
#     sudo bash deploy/install-service.sh
#
# Можно поменять умолчания:
#     APP_DIR=/srv/sprintergo PORT=7040 sudo -E bash deploy/install-service.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-/opt/sprintergo-platform}"
SERVICE_USER="${SERVICE_USER:-sprintergo}"
PORT="${PORT:-7030}"
SERVICE_NAME="sprintergo-platform"
UNIT="/etc/systemd/system/$SERVICE_NAME.service"

say() { echo "  $*"; }
die() { echo "Ошибка: $*" >&2; exit 1; }

echo
echo "Установка службы Sprinter Go"
echo "────────────────────────────────────────────"

[ "$(id -u)" = "0" ] || die "нужны права root. Запустите: sudo bash deploy/install-service.sh"
command -v systemctl >/dev/null 2>&1 || die "в системе нет systemd, служба не встанет"
command -v python3   >/dev/null 2>&1 || die "нет python3. Поставьте: apt install -y python3"
[ -f "$SRC/app.py" ] || die "рядом со скриптом нет app.py — распакуйте архив целиком"

PYTHON="$(command -v python3)"
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' \
  || die "нужен Python 3.9 или новее, у вас $("$PYTHON" -V)"

say "Исходники: $SRC"
say "Ставим в:  $APP_DIR"
say "Порт:      $PORT (только localhost, наружу — через nginx)"
echo

# ── пользователь ─────────────────────────────────────────────────────────────
if id -u "$SERVICE_USER" >/dev/null 2>&1; then
  say "Пользователь $SERVICE_USER уже есть."
else
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" \
    || useradd --system --home-dir "$APP_DIR" --shell /sbin/nologin "$SERVICE_USER"
  say "Создан системный пользователь $SERVICE_USER."
fi

# ── файлы ────────────────────────────────────────────────────────────────────
mkdir -p "$APP_DIR"
if [ "$(cd "$SRC" && pwd -P)" = "$(cd "$APP_DIR" && pwd -P)" ]; then
  say "Файлы уже на месте, копировать нечего."
else
  # data не трогаем никогда: там живая база, её нельзя затирать при обновлении.
  for item in app.py server web scripts deploy README.md SPEC.md; do
    [ -e "$SRC/$item" ] || continue
    rm -rf "${APP_DIR:?}/$item"
    cp -a "$SRC/$item" "$APP_DIR/"
  done
  say "Код и статика скопированы."
fi

find "$APP_DIR" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
mkdir -p "$APP_DIR/data"
chmod +x "$APP_DIR"/scripts/*.sh 2>/dev/null || true
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
chmod 750 "$APP_DIR/data"
say "Права выставлены, папка данных: $APP_DIR/data"

# ── файл службы ──────────────────────────────────────────────────────────────
[ -f "$SRC/deploy/$SERVICE_NAME.service" ] || die "не нашёлся deploy/$SERVICE_NAME.service"

sed -e "s|/opt/sprintergo-platform|$APP_DIR|g" \
    -e "s|^User=sprintergo$|User=$SERVICE_USER|" \
    -e "s|^Group=sprintergo$|Group=$SERVICE_USER|" \
    -e "s|^Environment=PORT=.*$|Environment=PORT=$PORT|" \
    -e "s|^ExecStart=/usr/bin/python3|ExecStart=$PYTHON|" \
    "$SRC/deploy/$SERVICE_NAME.service" > "$UNIT"
chmod 644 "$UNIT"
say "Файл службы записан: $UNIT"

# Старым systemd (до 240) не по зубам запись журнала прямо в файл —
# убираем эти строки, журнал будет читаться через journalctl.
SYSTEMD_VER="$(systemctl --version | head -n1 | awk '{print $2}' | tr -cd '0-9')"
if [ -n "$SYSTEMD_VER" ] && [ "$SYSTEMD_VER" -lt 240 ]; then
  sed -i '/^Standard\(Output\|Error\)=append:/d' "$UNIT"
  say "systemd $SYSTEMD_VER старый — журнал пойдёт в journalctl."
fi

# ── запуск ───────────────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl restart "$SERVICE_NAME"
say "Служба запущена и включена в автозагрузку."

# Ждём, пока сервис реально ответит, а не просто «systemd сказал ок».
echo
printf '  Проверяем'
OK=0
for _ in $(seq 1 30); do
  if python3 - "$PORT" <<'PYEOF'
import sys, urllib.request
try:
    with urllib.request.urlopen(
            'http://127.0.0.1:%s/api/v1/config' % sys.argv[1], timeout=2) as r:
        sys.exit(0 if r.status == 200 else 1)
except Exception:
    sys.exit(1)
PYEOF
  then OK=1; break; fi
  printf '.'
  sleep 0.5
done

if [ "$OK" != "1" ]; then
  echo ' — не отвечает.'
  echo
  echo "Служба не поднялась. Смотрите, что случилось:" >&2
  echo "    systemctl status $SERVICE_NAME" >&2
  echo "    journalctl -u $SERVICE_NAME -n 50" >&2
  exit 1
fi
echo ' — отвечает.'

# ── что дальше ───────────────────────────────────────────────────────────────
LOG="$APP_DIR/data/sprintergo.log"
if grep -qs '^ *Пароль ' "$LOG"; then
  echo
  echo "  Первый вход в панель управления:"
  grep -E '^ +(Почта|Пароль) ' "$LOG" | tail -n 2 | sed 's/^ */    /'
  echo "  Запишите пароль — второй раз он не покажется."
fi

cat <<TXT

  Готово. Что дальше:

    1. Настроить nginx на домен:
         cp $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/sprintergo
         (внутри поменять домен и путь $APP_DIR/web)
         ln -s /etc/nginx/sites-available/sprintergo /etc/nginx/sites-enabled/
         nginx -t && systemctl reload nginx

    2. Выпустить сертификат:
         certbot --nginx -d ваш-домен.kg -d www.ваш-домен.kg

    3. Зайти в панель по адресу https://ваш-домен.kg/admin и настроить
       тарифы, комиссию и почту. Подробности — в README.md.

  Управление службой:
    systemctl status $SERVICE_NAME
    systemctl restart $SERVICE_NAME
    journalctl -u $SERVICE_NAME -f

TXT
