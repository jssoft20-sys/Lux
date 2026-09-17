#!/bin/sh
set -e
echo "[somex] applying migrations"
npx prisma migrate deploy
if [ "${SEED_ON_START:-true}" = "true" ]; then
  echo "[somex] seeding catalog & superadmin (idempotent)"
  npx tsx prisma/seed.ts || echo "[somex] seed skipped"
fi
exec node dist/main.js
