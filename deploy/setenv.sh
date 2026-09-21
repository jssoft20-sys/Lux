#!/usr/bin/env bash
# Меняет настройки в .env бота и перезапускает сервис. Примеры (на сервере, от root):
#   bash /opt/lux-bot/deploy/setenv.sh TRADING_MODE=live
#   bash /opt/lux-bot/deploy/setenv.sh ANTHROPIC_API_KEY=sk-ant-... LLM_MODEL=claude-opus-5
#   bash /opt/lux-bot/deploy/setenv.sh --no-restart POSITION_SIZE_USDT=8
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/lux-bot}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
RESTART=1
if [[ "${1:-}" == "--no-restart" ]]; then RESTART=0; shift; fi
if [[ $# -eq 0 ]]; then echo "Использование: $0 [--no-restart] KEY=VALUE [KEY=VALUE ...]"; exit 1; fi
if [[ ! -f "$ENV_FILE" ]]; then echo "Нет файла $ENV_FILE"; exit 1; fi

python3 - "$ENV_FILE" "$@" <<'EOF'
import re
import sys

path, pairs = sys.argv[1], sys.argv[2:]
secret = {"BINANCE_API_KEY", "BINANCE_API_SECRET", "ANTHROPIC_API_KEY", "DASHBOARD_PASSWORD", "CRYPTOPANIC_TOKEN", "NEWSAPI_KEY"}
with open(path, encoding="utf-8") as f:
    lines = f.read().splitlines()
for pair in pairs:
    if "=" not in pair:
        sys.exit(f"ожидалось KEY=VALUE, получено: {pair}")
    key, value = pair.split("=", 1)
    key = key.strip().upper()
    value = value.strip()
    pat = re.compile(r"^\s*" + re.escape(key) + r"\s*=")
    for i, line in enumerate(lines):
        if pat.match(line):
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    shown = (value[:6] + "…") if key in secret and value else value
    print(f"   {key}={shown}")
with open(path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
EOF
chmod 600 "$ENV_FILE"
if [[ $RESTART -eq 1 ]] && systemctl list-unit-files lux-bot.service >/dev/null 2>&1; then
  systemctl restart lux-bot
  echo "==> lux-bot перезапущен. Проверка: journalctl -u lux-bot -n 20 --no-pager"
fi
