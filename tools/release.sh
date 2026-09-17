#!/usr/bin/env bash
# Собирает архив тестового стенда somex-test.tar.gz.
#   bash tools/release.sh            → slim (~3 MB): зависимости API ставятся на сервере (npm ci, нужен интернет)
#   FULL=1 bash tools/release.sh     → self-contained (~125 MB): node_modules внутри, интернет нужен только для apt
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/release}"
cd "$ROOT"
pnpm install --frozen-lockfile
pnpm --filter @somex/shared build
pnpm --filter @somex/api build
pnpm --filter @somex/mobile exec vite build
pnpm --filter @somex/admin exec vite build
rm -rf "$OUT" && mkdir -p "$OUT/somex/web" "$OUT/somex/shared" "$OUT/somex/api"

if [ "${FULL:-0}" = "1" ]; then
  pnpm --filter @somex/api deploy --prod --legacy "$OUT/somex/api"
  rm -rf "$OUT/somex/api/src" "$OUT/somex/api/test" "$OUT/somex/api/tsconfig"*.json "$OUT/somex/api/nest-cli.json" "$OUT/somex/api/storage" "$OUT/somex/api/.env"
  (cd "$OUT/somex/api" && npx prisma generate >/dev/null)
  find "$OUT/somex/api/node_modules/.pnpm" -path "*node_modules/prisma/libquery_engine-*" -delete
  rm -rf "$OUT/somex/api/node_modules/.pnpm"/typescript@* "$OUT/somex/api/node_modules/typescript"
  rm -rf "$OUT/somex/shared"
else
  cp -r apps/api/dist apps/api/prisma "$OUT/somex/api/"
  cp -r packages/shared/dist "$OUT/somex/shared/"
  # standalone package.json: workspace link → file dependency, exact versions, no dev deps
  node -e '
    const fs = require("fs");
    const src = JSON.parse(fs.readFileSync("apps/api/package.json", "utf8"));
    const deps = { ...src.dependencies, "@somex/shared": "file:../shared" };
    fs.writeFileSync(process.argv[1] + "/somex/api/package.json", JSON.stringify({ name: "somex-api", version: src.version, private: true, engines: { node: ">=20" }, scripts: { start: "node dist/main.js", migrate: "prisma migrate deploy", seed: "tsx prisma/seed.ts" }, prisma: { seed: "tsx prisma/seed.ts" }, dependencies: deps }, null, 2));
    const sh = JSON.parse(fs.readFileSync("packages/shared/package.json", "utf8"));
    fs.writeFileSync(process.argv[1] + "/somex/shared/package.json", JSON.stringify({ name: "@somex/shared", version: sh.version, private: true, type: "module", main: "./dist/index.js", types: "./dist/index.d.ts", exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } }, null, 2));
  ' "$OUT"
  # lock the full dependency tree so the server installs exactly what was tested
  (cd "$OUT/somex/api" && npm install --package-lock-only --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 && rm -rf node_modules)
fi
cp -r apps/mobile/dist "$OUT/somex/web/mobile"
cp -r apps/admin/dist "$OUT/somex/web/admin"
cp deploy/.env.example deploy/install.sh deploy/start.sh deploy/stop.sh deploy/docker-compose.yml deploy/README.md deploy/UPDATE.md "$OUT/somex/"
echo "somex $(git rev-parse --short HEAD) $(date -u +%F) $([ "${FULL:-0}" = "1" ] && echo full || echo slim)" > "$OUT/somex/VERSION"
(cd "$OUT" && tar czf somex-test.tar.gz somex)
du -sh "$OUT/somex-test.tar.gz"
