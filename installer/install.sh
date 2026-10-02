#!/usr/bin/env bash
# PayGo 1.13.9.68 — поверх 1.13.9.40 … 1.13.9.67
#
#   bash install.sh --check   только проверки, ничего не меняет
#   bash install.sh           установка
#
# Что делает:
#   1) собирает новые файлы во временной папке из файлов сервера и сверяет каждый с эталоном (sha256);
#      если хоть один файл на сервере отличается от 1.13.9.40 — останавливается, ничего не меняя
#   2) проверяет, что python сервисов компилирует новый код
#   3) резервная копия + rollback.sh
#   4) systemd: автоподъём сервисов (Restart=always), если ещё не включён (как в 1.13.9.41)
#   5) заменяет файлы, перезапускает работающие paygo-сервисы
#   6) если сервис не поднялся или в журнале ошибка — автоматический откат
# База данных не меняется. Журнал зачислений и защита от двойных зачислений сохраняются.
set -Eeuo pipefail

VERSION="1.13.9.68"
PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${PAYGO_DIR:-/home/PayGo}"; APP="${APP%/}"
UNITDIR="${PAYGO_SYSTEMD_DIR:-/etc/systemd/system}"
DROPIN_NAME="zz-paygo-autorestart.conf"
MODE="install"
case "${1:-}" in
  --check|check) MODE="check" ;;
  ""|--install|install) MODE="install" ;;
  *) echo "использование: bash install.sh [--check]"; exit 2 ;;
esac
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="${APP}-backup-before-${VERSION}-${TS}"
STAGE="$(mktemp -d /tmp/paygo-${VERSION}-stage.XXXXXX)"
LOG="/var/log/paygo-install-${VERSION}-${TS}.log"
DAEMONS=(paygo-backend paygo-worker paygo-bot paygo-support paygo-optima-live paygo-optima-mail
         paygo-operator-alerts paygo-redirect paygo-global-bot paygo-win-bot paygo-withdraw-reminders paygo-1win-live)

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mOK\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mОШИБКА: %s\033[0m\n' "$*" >&2; exit 1; }
trap 'rm -rf "$STAGE"' EXIT

exec > >(tee -a "$LOG") 2>&1
echo "PayGo ${VERSION} • $(date '+%F %T') • режим: ${MODE} • лог: ${LOG}"

[ "$(id -u)" -eq 0 ] || die "запустите от root: sudo bash $0"
[ -d "$APP/backend/paygo" ] || die "не найден $APP/backend/paygo (укажите PAYGO_DIR=...)"
for tool in systemctl sha256sum stat awk sed; do command -v "$tool" >/dev/null 2>&1 || die "нет утилиты $tool"; done
unit_exists() { systemctl list-unit-files "$1" --no-legend 2>/dev/null | grep -q .; }

say "Проверка пакета"
( cd "$PKG" && sha256sum -c --quiet PACKAGE.sha256 ) || die "пакет повреждён при копировании — вставьте блок заново"
ok "пакет цел"

interp_of() {
  local p sb
  p="$(systemctl show -p ExecStart --value "$1" 2>/dev/null | sed -n 's/.*path=\([^ ;]*\).*/\1/p' | head -1)"
  [ -n "$p" ] || return 0
  case "$(basename "$p")" in python*) echo "$p"; return 0 ;; esac
  if [ -f "$p" ] && [ "$(head -c 2 "$p" 2>/dev/null)" = "#!" ]; then
    sb="$(head -1 "$p" | sed 's/^#!//' | awk '{print $1}')"
    if [ "$(basename "$sb")" = "env" ]; then sb="$(command -v "$(head -1 "$p" | awk '{print $2}')" || true)"; fi
    case "$(basename "$sb")" in python*) echo "$sb" ;; esac
  fi
}
mapfile -t PYS < <(for u in "${DAEMONS[@]}"; do unit_exists "$u.service" && interp_of "$u.service"; done | awk 'NF' | sort -u)
[ "${#PYS[@]}" -gt 0 ] || PYS=(/usr/bin/python3)
PY=""; for py in "${PYS[@]}"; do [ -x "$py" ] && { PY="$py"; break; }; done
[ -n "$PY" ] || PY="$(command -v python3 || true)"
[ -n "$PY" ] || die "не найден python"

say "Сборка новых файлов из файлов сервера (сервер не меняется)"
SUMMARY="$(env -i PATH=/usr/bin:/bin HOME=/root "$PY" "$PKG/apply_delta.py" "$APP" "$STAGE")" || {
  echo "$SUMMARY" | "$PY" -c 'import json,sys; d=json.load(sys.stdin); [print("    - "+p) for p in d.get("problems",[])]' 2>/dev/null || echo "$SUMMARY"
  die "файлы на сервере отличаются от ожидаемых. Ничего не изменено — пришлите этот вывод."
}
mapfile -t INSTALL < <(echo "$SUMMARY" | "$PY" -c 'import json,sys; [print(x) for x in json.load(sys.stdin)["install"]]')
mapfile -t ALREADY < <(echo "$SUMMARY" | "$PY" -c 'import json,sys; [print(x) for x in json.load(sys.stdin)["already"]]')
for f in "${INSTALL[@]}"; do ok "будет обновлён: $f"; done
for f in "${ALREADY[@]}"; do ok "уже новой версии: $f"; done

say "Проверка python сервисов"
for py in "${PYS[@]}"; do
  [ -x "$py" ] || { warn "$py не найден — пропущен"; continue; }
  for f in "${INSTALL[@]}"; do
    case "$f" in *.py) ;; *) continue ;; esac
    "$py" - "$STAGE/$f" <<'PYCHECK' || die "$f не компилируется интерпретатором $py. Ничего не изменено."
import sys
compile(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1], "exec")
PYCHECK
  done
  ok "$py ($("$py" -c 'import platform; print(platform.python_version())')) — код компилируется"
done

say "Модули Telegram (telethon, python-socks) — для «Пополнить счет»"
pip_mod() {  # pip_mod python import-name requirement why
  local py="$1" mod="$2" req="$3" why="$4"
  if "$py" -c "import $mod" >/dev/null 2>&1; then ok "$py: $mod уже установлен"; return 0; fi
  if [ "$MODE" = "check" ]; then ok "$py: $mod будет установлен"; return 0; fi
  if timeout 300 "$py" -m pip install --disable-pip-version-check -q "$req" >/tmp/paygo-pip.log 2>&1 \
     || timeout 300 "$py" -m pip install --disable-pip-version-check -q --break-system-packages "$req" >>/tmp/paygo-pip.log 2>&1; then
    ok "$py: $mod установлен"
  else
    warn "$py: не удалось установить $mod ($(tail -1 /tmp/paygo-pip.log)) — $why, остальное ставится"
  fi
}
for py in "${PYS[@]}"; do
  [ -x "$py" ] || continue
  pip_mod "$py" telethon 'telethon>=1.36,<2' "«Пополнить счет» не заработает"
  pip_mod "$py" python_socks 'python-socks[asyncio]>=2.4,<3' "SOCKS-прокси для Telegram не заработает (MTProxy работает и без него)"
done

vpn_check() {  # read-only: the VPN block needs ip-api.com (if it is unreachable, nobody is blocked)
  say "VPN-защита админки (проверка адресов через ip-api.com)"
  timeout 15 "$PY" - <<'VPNCHECK' || warn "проверка не выполнилась"
import json, urllib.request
try:
    with urllib.request.urlopen("http://ip-api.com/json/1.1.1.1?fields=status,hosting,isp", timeout=8) as r:
        d = json.loads(r.read().decode())
    print("    \033[32mOK\033[0m ip-api.com отвечает — вход через VPN будет блокироваться" if d.get("status") == "success" else "    \033[33m!!\033[0m ip-api.com ответил странно: %s" % d)
except Exception as exc:
    print("    \033[33m!!\033[0m ip-api.com недоступен (%s) — VPN не будет блокироваться, остальное работает" % type(exc).__name__)
VPNCHECK
}

mail_check() {  # read-only: Demir Bank payments come from a mailbox over IMAP (993): Timeweb, Gmail, Mail.ru, Yandex
  say "Связь сервера с почтой (для Демир Банка): Timeweb, Gmail, Mail.ru, Яндекс"
  timeout 60 "$PY" - <<'MAILCHECK' || warn "проверка не выполнилась"
import socket, ssl, time
for host in ("imap.timeweb.ru", "imap.gmail.com", "imap.mail.ru", "imap.yandex.ru"):
    t = time.monotonic()
    try:
        with socket.create_connection((host, 993), timeout=6) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname=host) as s:
                s.settimeout(6)
                greet = s.recv(200).decode("ascii", "replace").strip()
        print("    \033[32mOK\033[0m %s:993 отвечает (%.1f сек): %s" % (host, time.monotonic() - t, greet[:48]))
    except Exception as exc:
        print("    \033[33m!!\033[0m %s:993 недоступен (%s) — почта этого сервиса читаться не будет" % (host, type(exc).__name__))
MAILCHECK
}

push_check() {  # read-only: Optima's instant notices (the same live channel as the bell on optimabusiness.kg)
  say "Мгновенные уведомления Optima (канал optimabusiness.kg/notification-service)"
  timeout 20 "$PY" - <<'PUSHCHECK' || warn "проверка не выполнилась"
import http.client, ssl, time
t = time.monotonic()
try:
    c = http.client.HTTPSConnection("optimabusiness.kg", 443, timeout=8, context=ssl.create_default_context())
    c.request("GET", "/notification-service/ob-ws/info", headers={"User-Agent": "Mozilla/5.0"})
    r = c.getresponse(); r.read()
    print("    \033[32mOK\033[0m канал отвечает (HTTP %d, %.1f сек) — сервис Optima подключится к нему сам своим входом" % (r.status, time.monotonic() - t))
except Exception as exc:
    print("    \033[33m!!\033[0m канал недоступен (%s) — платежи Optima пойдут по истории, как раньше" % type(exc).__name__)
PUSHCHECK
}

tg_check() {  # read-only: can this server reach Telegram for the account login, and which way
  say "Связь сервера с Telegram — нужна для входа в Telegram-аккаунт"
  timeout 45 "$PY" - "$STAGE/backend/paygo/services" "$APP/backend/paygo/services" <<'TGCHECK' || warn "проверка не выполнилась"
import asyncio, logging, os, sys
logging.disable(logging.CRITICAL)
for d in sys.argv[1:]:
    if os.path.exists(os.path.join(d, "tg_transport.py")):
        sys.path.insert(0, d)
        break
try:
    from telethon import TelegramClient, connection
    from telethon.sessions import StringSession
    import tg_transport
except Exception as exc:
    print("    !! модуль для Telegram недоступен:", exc); raise SystemExit(0)

async def one(label, conn, port=None):
    c = TelegramClient(StringSession(), 1, "0" * 32, connection=conn, timeout=10, connection_retries=1, retry_delay=1)
    if port:
        c.session.set_dc(2, "149.154.167.51", port)
    try:
        await asyncio.wait_for(c.connect(), 15)
        return label, True, ""
    except BaseException as exc:
        return label, False, "таймаут" if isinstance(exc, (asyncio.TimeoutError, TimeoutError)) else type(exc).__name__
    finally:
        try:
            await asyncio.wait_for(c.disconnect(), 5)
        except BaseException:
            pass

async def main():
    res = await asyncio.gather(one("WebSocket через HTTPS, как Telegram Web", tg_transport.ConnectionWebSocket),
                               one("MTProto · порт 443", connection.ConnectionTcpFull),
                               one("MTProto с обфускацией · порт 443", connection.ConnectionTcpObfuscated),
                               one("MTProto с обфускацией · порт 80", connection.ConnectionTcpObfuscated, 80))
    for label, good, err in res:
        print("    " + ("\033[32mOK\033[0m " if good else "\033[33m--\033[0m ") + label + ("" if good else " — нет (" + err + ")"))
    if any(good for _, good, _ in res):
        print("    \033[32mOK\033[0m вход в Telegram-аккаунт пойдёт через: " + next(label for label, good, _ in res if good))
    else:
        print("    \033[33m!!\033[0m Telegram с сервера недоступен ни одним способом: в «Меню → Telegram-аккаунт» укажите прокси (SOCKS5 или MTProxy)")

asyncio.run(main())
TGCHECK
}

say "Сервисы"
DROPINS=(); RESTART=(); BROKEN=()
# Only services that work right now are restarted and checked. A service that was already failing
# before the update (e.g. «activating auto-restart») is left as it is — it is not a reason to roll back.
for d in "${DAEMONS[@]}"; do
  u="$d.service"
  unit_exists "$u" || continue
  type="$(systemctl show -p Type --value "$u" 2>/dev/null || true)"
  case "$type" in simple|exec|notify|notify-reload|"") DROPINS+=("$u") ;; esac
  st="$(systemctl show -p ActiveState --value "$u" 2>/dev/null || true)"; sub="$(systemctl show -p SubState --value "$u" 2>/dev/null || true)"
  if [ "$st" = "active" ] && [ "$sub" = "running" ]; then
    RESTART+=("$u"); printf '    %-34s %s\n' "$u" "работает — будет перезапущен"
  elif [ "$st" = "activating" ] || [ "$st" = "failed" ] || [ "$sub" = "auto-restart" ]; then
    BROKEN+=("$u"); printf '    %-34s %s\n' "$u" "не работал и до обновления ($st $sub) — не трогаю"
  else
    printf '    %-34s %s\n' "$u" "${st:-?} — не запущен, не трогаю"
  fi
done
[ "${#DROPINS[@]}" -gt 0 ] || die "не найдено ни одного сервиса PayGo"

if [ "$MODE" = "check" ]; then tg_check; mail_check; push_check; vpn_check; say "Проверка пройдена — можно ставить: bash $PKG/install.sh"; exit 0; fi
if [ "${#INSTALL[@]}" -eq 0 ]; then
  missing=0; for u in "${DROPINS[@]}"; do [ -f "$UNITDIR/$u.d/$DROPIN_NAME" ] || missing=1; done
  [ "$missing" -eq 1 ] || { say "Уже установлено — ничего не меняю"; exit 0; }
fi

say "Резервная копия → $BACKUP"
mkdir -p "$BACKUP/files"
: > "$BACKUP/CREATED_DROPINS"; : > "$BACKUP/NEW_FILES"
for f in "${INSTALL[@]}"; do
  if [ -e "$APP/$f" ]; then mkdir -p "$BACKUP/files/$(dirname "$f")"; cp -a "$APP/$f" "$BACKUP/files/$f"; else echo "$f" >> "$BACKUP/NEW_FILES"; fi
done
{
  echo '#!/usr/bin/env bash'
  echo "# Откат PayGo ${VERSION}: вернуть прежние файлы и убрать автоподъём, добавленный этой установкой."
  echo 'set -Eeuo pipefail'
  printf 'APP=%q\nBACKUP=%q\n' "$APP" "$BACKUP"
  if [ "${#RESTART[@]}" -gt 0 ]; then printf 'RESTART=(%s)\n' "$(printf '%q ' "${RESTART[@]}")"; else echo 'RESTART=()'; fi
  cat <<'ROLLBACK'
[ "$(id -u)" -eq 0 ] || { echo "запустите от root"; exit 1; }
( cd "$BACKUP/files" && find . -type f -print0 ) | while IFS= read -r -d '' f; do cp -a "$BACKUP/files/$f" "$APP/$f"; done
while read -r f; do [ -n "$f" ] && rm -f "$APP/$f"; done < "$BACKUP/NEW_FILES"
while read -r f; do [ -n "$f" ] && rm -f "$f" && rmdir --ignore-fail-on-non-empty "$(dirname "$f")" 2>/dev/null || true; done < "$BACKUP/CREATED_DROPINS"
systemctl daemon-reload
if [ "${#RESTART[@]}" -gt 0 ]; then systemctl restart "${RESTART[@]}" || true; fi
for u in "${RESTART[@]}"; do printf '    %-34s %s\n' "$u" "$(systemctl is-active "$u" || true)"; done
echo "Откат выполнен. Админка: Ctrl+F5."
ROLLBACK
} > "$BACKUP/rollback.sh"
chmod 700 "$BACKUP/rollback.sh"
ok "откат: bash $BACKUP/rollback.sh"

rollback_now() { warn "откат: $1"; bash "$BACKUP/rollback.sh" || true; die "$1 — выполнен откат. Лог: $LOG"; }

say "Автоподъём сервисов"
for u in "${DROPINS[@]}"; do
  dir="$UNITDIR/$u.d"; f="$dir/$DROPIN_NAME"
  [ -f "$f" ] && continue
  mkdir -p "$dir"; echo "$f" >> "$BACKUP/CREATED_DROPINS"
  cat > "$f" <<'UNIT'
# PayGo: if the service crashes or hangs, systemd starts it again in 3 s — without a restart limit.
[Unit]
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=3
UNIT
  ok "$u"
done
systemctl daemon-reload || rollback_now "systemctl daemon-reload не прошёл"

say "Замена файлов"
REF="$APP/frontend/admin/index.html"
for f in "${INSTALL[@]}"; do
  dst="$APP/$f"; ref="$dst"; [ -e "$ref" ] || ref="$REF"
  owner="$(stat -c '%u:%g' "$ref")"; mode="$(stat -c '%a' "$ref")"
  mkdir -p "$(dirname "$dst")"
  cp "$STAGE/$f" "$dst.paygo-new" && chown "$owner" "$dst.paygo-new" && chmod "$mode" "$dst.paygo-new" && mv -f "$dst.paygo-new" "$dst" \
    || rollback_now "не удалось записать $f"
  [ "$(sha256sum "$dst" | awk '{print $1}')" = "$(sha256sum "$STAGE/$f" | awk '{print $1}')" ] || rollback_now "контрольная сумма $f не совпала"
  ok "$f"
done

say "Перезапуск: ${RESTART[*]:-нет активных}"
SINCE="$(date '+%Y-%m-%d %H:%M:%S')"
if [ "${#RESTART[@]}" -gt 0 ]; then systemctl restart "${RESTART[@]}" || true; fi
# Only the CORE services decide the install. A satellite bot (win/global/optima-live/…) that keeps
# crashing was already broken before and must not roll back the whole update — it is reported as a warning.
CORE=(paygo-backend.service paygo-worker.service paygo-bot.service paygo-support.service paygo-redirect.service)
is_core() { local x; for x in "${CORE[@]}"; do [ "$1" = "$x" ] && return 0; done; return 1; }
# bots do a Telegram login on start and may sit in «activating (start)» for a while — give them time
sleep 10
for _try in 1 2 3; do
  pend=0
  for u in "${RESTART[@]}"; do
    st="$(systemctl show -p ActiveState --value "$u" 2>/dev/null || true)"; sub="$(systemctl show -p SubState --value "$u" 2>/dev/null || true)"
    [ "$st" = "activating" ] && [ "$sub" != "auto-restart" ] && pend=1
  done
  [ "$pend" -eq 0 ] && break
  sleep 8
done
FAILED=(); DOWN=()
for u in "${RESTART[@]}"; do
  st="$(systemctl show -p ActiveState --value "$u" 2>/dev/null || true)"; sub="$(systemctl show -p SubState --value "$u" 2>/dev/null || true)"
  printf '    %-34s %-9s %s\n' "$u" "$st" "$sub"
  bad=0
  if [ "$st" != "active" ] || [ "$sub" = "auto-restart" ]; then bad=1; fi
  if [ "$bad" -eq 0 ] && command -v journalctl >/dev/null 2>&1 && journalctl -u "$u" --since "$SINCE" --no-pager 2>/dev/null | grep -q 'Traceback'; then
    bad=1
  fi
  if [ "$bad" -eq 1 ]; then
    if is_core "$u"; then
      command -v journalctl >/dev/null 2>&1 && journalctl -u "$u" --since "$SINCE" --no-pager -n 30 2>/dev/null || true
      FAILED+=("$u")
    else
      DOWN+=("$u")
    fi
  fi
done
[ "${#DOWN[@]}" -eq 0 ] || warn "эти вспомогательные сервисы не поднялись (обновление не откатывается — чините отдельно): ${DOWN[*]}"
[ "${#FAILED[@]}" -eq 0 ] || rollback_now "основные сервисы не поднялись: ${FAILED[*]}"

say "Готово: PayGo ${VERSION} установлен"
cat <<DONE
    Админка: откройте и нажмите Ctrl+F5 (на телефоне — закройте и откройте заново).
    Откат:   bash $BACKUP/rollback.sh
    Лог:     $LOG

    Telegram-аккаунт: Меню → Telegram-аккаунт → «Получить код». Все способы связи пробуются сразу,
    в том числе через HTTPS (WebSocket, как Telegram Web) — он проходит там, где прямой MTProto режется.
    Чат: смахните сообщение влево — ответ; нажмите на своё — изменить/удалить; сверху свежая заявка клиента.
    Касса 1WIN меньше 35 000 — операторам в Telegram «Пополните кассу» (порог: cash_refill_alert_below).
    «Пополнено» и «Вывод выполнен»: строка «⚡ Время обработки» (Настройки → Тексты, можно выключить).
    Premium-эмодзи по ботам: Расширенные настройки → Бот → «Проверить premium-эмодзи».
    Optima: платежи по QR зачисляются по мгновенному уведомлению (~1 сек), история — подстраховка.
      Кошельки → Optima: «Мгновенные уведомления: подключено».
    Клиенту: карточка оплаты и «Пополнено» с временем обработки («Банк подтвердил» выключено — Тексты).
    Демир Банк: Меню → Кошельки → «+ Demir» — почта Gmail / Mail.ru / Яндекс / Timeweb и QR Демира.
      Gmail, Mail.ru и Яндекс пускают только по «паролю приложения» — подсказка в окне подключения.
    Пополнить счет: боты @bingo1win_bot и @birkassabot (выбор в окне), чек загружается из панели.
    Пополнить кассу: кнопка рядом с «Пополнить счет» — сумма → «Зачислить».
    VPN: админка не открывается через VPN; снять блок с сервера: см. README.
DONE
tg_check
mail_check
push_check
vpn_check
if [ "${#BROKEN[@]}" -gt 0 ]; then
  echo
  warn "не работали и до обновления (их не трогал): ${BROKEN[*]}"
  for u in "${BROKEN[@]}"; do echo "      причина: journalctl -u ${u%.service} -n 40 --no-pager"; done
fi
