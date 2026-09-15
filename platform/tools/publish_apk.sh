#!/usr/bin/env bash
# Положить собранное приложение курьера туда, откуда его скачивает телефон.
#
# Приложение раздаётся файлом с нашего же домена: /app/sprintergo-courier.apk.
# Google Play для этого не нужен — водитель открывает ссылку, Android спрашивает
# разрешение поставить из этого источника, и всё. Рядом кладётся version.json,
# по которому приложение понимает, что вышло обновление.
#
#   bash tools/publish_apk.sh путь/к/app-release.apk [номер версии]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?укажите путь к собранному apk}"
NAME="${2:-}"

[ -f "$SRC" ] || { echo "Файла нет: $SRC" >&2; exit 1; }
case "$SRC" in *.apk) ;; *) echo "Это не apk: $SRC" >&2; exit 1 ;; esac

DEST="$ROOT/web/app"
mkdir -p "$DEST"
cp "$SRC" "$DEST/sprintergo-courier.apk"

SIZE=$(stat -c %s "$DEST/sprintergo-courier.apk")
SHA=$(sha256sum "$DEST/sprintergo-courier.apk" | cut -d' ' -f1)
BUILT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Номер версии берём из самого apk, если умеем, иначе из аргумента, иначе из даты.
if [ -z "$NAME" ] && [ -x "${ANDROID_HOME:-/opt/android-sdk}/build-tools/34.0.0/aapt2" ]; then
  NAME=$("${ANDROID_HOME:-/opt/android-sdk}/build-tools/34.0.0/aapt2" dump badging \
         "$DEST/sprintergo-courier.apk" 2>/dev/null \
         | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1) || true
fi
[ -n "$NAME" ] || NAME=$(date -u +%Y.%m.%d)

cat > "$DEST/version.json" <<EOF
{
  "version": "$NAME",
  "size": $SIZE,
  "sha256": "$SHA",
  "built_at": "$BUILT",
  "url": "/app/sprintergo-courier.apk",
  "note": "Приложение курьера Sprinter Go. Ставится с телефона, без Google Play."
}
EOF

echo "Приложение выложено:"
echo "  файл    $DEST/sprintergo-courier.apk"
echo "  версия  $NAME"
echo "  размер  $((SIZE / 1024)) КБ"
echo "  ссылка  /app/sprintergo-courier.apk"
