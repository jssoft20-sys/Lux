#!/usr/bin/env bash
# Packages site/ into dist/sprinter-go-site.zip and .tar.gz (files at archive root → unzip straight into /home/gotaxi)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="$ROOT/site"
DIST="${1:-$ROOT/dist}"
mkdir -p "$DIST"
rm -f "$DIST/sprinter-go-site.zip" "$DIST/sprinter-go-site.tar.gz"
( cd "$SITE" && zip -qr -X "$DIST/sprinter-go-site.zip" . -x '*.DS_Store' -x '__MACOSX/*' -x '*.pid' -x 'server.log' )
( cd "$SITE" && tar --exclude='*.pid' --exclude='server.log' -czf "$DIST/sprinter-go-site.tar.gz" . )
( cd "$DIST" && sha256sum sprinter-go-site.zip sprinter-go-site.tar.gz > SHA256SUMS.txt )
ls -la "$DIST"
unzip -l "$DIST/sprinter-go-site.zip" | tail -1
