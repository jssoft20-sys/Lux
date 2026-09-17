#!/usr/bin/env bash
# Собирает самодостаточный архив somex-test.tar.gz: API (prod node_modules), web-приложения, установщик.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/release}"
cd "$ROOT"
pnpm install --frozen-lockfile
pnpm --filter @somex/shared build
pnpm --filter @somex/api build
pnpm --filter @somex/mobile exec vite build
pnpm --filter @somex/admin exec vite build
rm -rf "$OUT" && mkdir -p "$OUT/somex/web"
pnpm --filter @somex/api deploy --prod --legacy "$OUT/somex/api"
rm -rf "$OUT/somex/api/src" "$OUT/somex/api/test" "$OUT/somex/api/tsconfig*.json" "$OUT/somex/api/nest-cli.json"
(cd "$OUT/somex/api" && npx prisma generate >/dev/null)
# trim: uploads from dev, duplicate query engines of the CLI (migrate deploy needs only the schema engine), typescript
rm -rf "$OUT/somex/api/storage" "$OUT/somex/api/.env"
find "$OUT/somex/api/node_modules/.pnpm" -path "*node_modules/prisma/libquery_engine-*" -delete
rm -rf "$OUT/somex/api/node_modules/.pnpm"/typescript@* "$OUT/somex/api/node_modules/typescript"
cp -r apps/mobile/dist "$OUT/somex/web/mobile"
cp -r apps/admin/dist "$OUT/somex/web/admin"
cp deploy/.env.example deploy/install.sh deploy/start.sh deploy/stop.sh deploy/docker-compose.yml deploy/README.md "$OUT/somex/"
echo "somex $(git rev-parse --short HEAD) $(date -u +%F)" > "$OUT/somex/VERSION"
(cd "$OUT" && tar czf somex-test.tar.gz somex)
du -sh "$OUT/somex-test.tar.gz"
