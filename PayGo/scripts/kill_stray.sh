#!/usr/bin/env bash
# Убить лишние экземпляры PayGo и запустить сервисы заново — ровно по одному процессу на роль.
# Трогает ТОЛЬКО PayGo: процессы python из /home/PayGo/venv и модули paygobot.*/paygo.*, docker-контейнеры paygo-*.
# Другие проекты, сайты и боты на сервере не затрагиваются.
#
#   /home/PayGo/scripts/kill_stray.sh              # стоп юнитов → убить всё лишнее → старт юнитов → healthcheck
#   /home/PayGo/scripts/kill_stray.sh --dry-run    # только показать, что было бы убито
#   /home/PayGo/scripts/kill_stray.sh --sessions   # дополнительно завершить все сеансы админки (все входят заново)
#   /home/PayGo/scripts/kill_stray.sh --only-kill  # убить только чужие (не из systemd) процессы, юниты не трогать
#
# Симптом, ради которого он нужен: в logs/bot.log «409 Conflict» (getUpdates), бот отвечает через раз —
# значит запущено два экземпляра бота (ручной запуск, старый docker compose, второй systemd-юнит).
set -uo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNITS="paygo-backend paygo-worker paygo-bot paygo-support"
# что считается процессом PayGo (регулярное выражение для pgrep -f / полной командной строки)
PATTERN="(paygobot\.(main_bot|support_bot)|paygo\.(server|workers\.main|app:app)|${APP_DIR}/venv/bin/)"
DRY=0; SESSIONS=0; ONLY_KILL=0; QUIET=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1;;
    --sessions) SESSIONS=1;;
    --only-kill) ONLY_KILL=1;;
    --quiet) QUIET=1;;
    -h|--help) sed -n '2,15p' "$0"; exit 0;;
    *) echo "неизвестный параметр: $arg"; exit 2;;
  esac
done
say() { [ "$QUIET" = 1 ] || echo "$@"; }
have_systemd() { command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; }

# PID-ы, которыми управляет systemd (вся cgroup юнита: главный процесс + его помощники, например распознавание QR)
managed_pids() {
  have_systemd || return 0
  for unit in $UNITS; do
    local cg main
    cg="$(systemctl show -p ControlGroup --value "$unit" 2>/dev/null || true)"
    if [ -n "$cg" ]; then
      for f in "/sys/fs/cgroup$cg/cgroup.procs" "/sys/fs/cgroup/systemd$cg/cgroup.procs" "/sys/fs/cgroup/pids$cg/cgroup.procs"; do
        [ -r "$f" ] && cat "$f" 2>/dev/null
      done
    fi
    main="$(systemctl show -p MainPID --value "$unit" 2>/dev/null || echo 0)"
    if [ -n "$main" ] && [ "$main" != 0 ]; then echo "$main"; pgrep -P "$main" 2>/dev/null; fi
  done | sort -un
}

# этот скрипт и всё, из чего он запущен (терминал, sudo, ssh, обёртка bash -c), — никогда не цель
ancestor_pids() {
  local pid=$$
  while [ -n "$pid" ] && [ "$pid" != 0 ] && [ "$pid" != 1 ]; do
    echo "$pid"
    pid="$(awk '/^PPid:/{print $2}' "/proc/$pid/status" 2>/dev/null || true)"
  done
}

# python из venv PayGo, запущенный по относительному пути (cd /home/PayGo && venv/bin/python …)
relative_venv_pids() {
  pgrep -f '(^|[[:space:]])venv/bin/' 2>/dev/null | while read -r pid; do
    [ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" = "$APP_DIR" ] && echo "$pid"
  done
}

# чужие процессы PayGo: подходят под шаблон, но не принадлежат юнитам, этому скрипту и его предкам
stray_pids() {
  local managed skip
  managed="$(managed_pids)"
  skip="$(printf '%s\n%s\n' "$managed" "$(ancestor_pids)")"
  { pgrep -f "$PATTERN" 2>/dev/null; relative_venv_pids; } | sort -un | while read -r pid; do
    [ -z "$pid" ] && continue
    echo "$skip" | grep -qx "$pid" && continue
    kill -0 "$pid" 2>/dev/null || continue
    echo "$pid"
  done
}

show() {
  local pids="$1"
  [ -z "$pids" ] && { say "лишних процессов PayGo нет"; return; }
  say "лишние процессы PayGo:"
  # shellcheck disable=SC2086
  ps -o pid=,user=,etimes=,args= -p $(echo $pids | tr ' ' ',') 2>/dev/null | cut -c1-160 | sed 's/^/  /'
}

kill_pids() {
  local pids="$1"
  [ -z "$pids" ] && return 0
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    local alive=""
    for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive="$alive $pid"; done
    [ -z "$alive" ] && { say "завершено: $pids"; return 0; }
  done
  # shellcheck disable=SC2086
  kill -KILL $alive 2>/dev/null || true
  say "принудительно завершено: $alive"
}

stop_docker() {
  command -v docker >/dev/null 2>&1 || return 0
  local names
  names="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^paygo[-_]' || true)"
  [ -z "$names" ] && return 0
  say "docker-контейнеры PayGo: $(echo "$names" | tr '\n' ' ')"
  [ "$DRY" = 1 ] && return 0
  # shellcheck disable=SC2086
  docker stop $names >/dev/null 2>&1 && say "docker: остановлены" || say "docker: не удалось остановить (проверьте docker ps)"
}

revoke_sessions() {
  [ "$SESSIONS" = 1 ] || return 0
  if [ "$DRY" = 1 ]; then say "сеансы админки: были бы завершены (--sessions)"; return 0; fi
  ( cd "$APP_DIR" && set -a && . ./.env && set +a && venv/bin/python -m paygo.cli revoke-sessions ) || say "!! не удалось завершить сеансы админки (см. вывод выше)"
}

# ------------------------------------------------------------------------------------------------
if [ "$ONLY_KILL" = 1 ]; then
  pids="$(stray_pids | tr '\n' ' ')"
  show "$pids"
  stop_docker
  [ "$DRY" = 1 ] && exit 0
  kill_pids "$pids"
  revoke_sessions
  exit 0
fi

if have_systemd; then
  say "== состояние юнитов"
  # shellcheck disable=SC2086
  systemctl is-active $UNITS 2>/dev/null | paste <(echo "$UNITS" | tr ' ' '\n') - | sed 's/^/  /'
fi
pids_before="$(stray_pids | tr '\n' ' ')"
show "$pids_before"
stop_docker
if [ "$DRY" = 1 ]; then
  say "(dry-run: ничего не остановлено)"
  exit 0
fi
if have_systemd; then
  say "== стоп юнитов PayGo"
  # shellcheck disable=SC2086
  systemctl stop $UNITS 2>/dev/null || true
fi
# после остановки юнитов всё, что осталось под шаблоном, — лишнее
pids="$(stray_pids | tr '\n' ' ')"
show "$pids"
kill_pids "$pids"
revoke_sessions
if have_systemd; then
  say "== старт юнитов PayGo"
  # shellcheck disable=SC2086
  systemctl start $UNITS
  sleep 3
  # shellcheck disable=SC2086
  systemctl is-active $UNITS 2>/dev/null | paste <(echo "$UNITS" | tr ' ' '\n') - | sed 's/^/  /'
  [ -x "$APP_DIR/scripts/healthcheck.sh" ] && "$APP_DIR/scripts/healthcheck.sh" || true
  say "проверка через минуту: grep -c 409 $APP_DIR/logs/bot.log  (число не должно расти)"
else
  say "systemd не найден: процессы убиты, запустите PayGo заново вручную"
fi
