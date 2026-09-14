#!/usr/bin/env bash
# Сборка архива платформы для загрузки на сервер.
# Внутрь попадает только то, что нужно для работы: код, статика, скрипты, инструкция.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${1:-$ROOT/../dist}"
mkdir -p "$DIST"; DIST="$(cd "$DIST" && pwd)"
NAME="sprintergo-platform"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/$NAME"
cd "$ROOT"
# tools нужны на сервере: mkadmin и mkcourier заводят администратора и водителя
# руками, когда до админки не добраться. Без них обновление командой из README
# спотыкалось о несуществующую папку.
for item in app.py server web scripts deploy tools README.md SPEC.md; do
  [ -e "$item" ] && cp -r "$item" "$TMP/$NAME/"
done
mkdir -p "$TMP/$NAME/data"
cat > "$TMP/$NAME/data/.gitkeep" <<'EOF'
Здесь появится база sprintergo.sqlite3 после первого запуска.
Это единственный файл, который нужно включать в резервную копию.
EOF

rm -f "$TMP/$NAME"/tools/{api_test.py,ui_test.mjs,flow_test.mjs,core_test.py,icons.mjs} 2>/dev/null || true
rm -f "$TMP/$NAME"/tools/*workflow*.js 2>/dev/null || true

# в архив не тащим мусор разработки
find "$TMP/$NAME" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$TMP/$NAME" -name '*.pyc' -delete 2>/dev/null || true
find "$TMP/$NAME" -name '.DS_Store' -delete 2>/dev/null || true
chmod +x "$TMP/$NAME"/scripts/*.sh 2>/dev/null || true

rm -f "$DIST/$NAME.zip" "$DIST/$NAME.tar.gz"
( cd "$TMP" && zip -qr -X "$DIST/$NAME.zip" "$NAME" )
( cd "$TMP" && tar -czf "$DIST/$NAME.tar.gz" "$NAME" )
( cd "$DIST" && sha256sum "$NAME.zip" "$NAME.tar.gz" > "$NAME.sha256.txt" )

echo "Архив собран:"
ls -la "$DIST/$NAME".* | sed 's/^/  /'
echo "Файлов внутри: $(unzip -l "$DIST/$NAME.zip" | tail -1 | awk '{print $2}')"
