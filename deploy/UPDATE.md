# Обновление тестового стенда

1. Соберите новый архив из репозитория: `bash tools/release.sh` → `release/somex-test.tar.gz`.
2. На сервере: `systemctl stop somex`, распакуйте архив поверх (`tar xzf somex-test.tar.gz -C /path/where/somex/is/parent`), `.env` не трогайте.
3. `cd somex/api && npx prisma migrate deploy && npx tsx prisma/seed.ts`, затем `systemctl start somex`.
