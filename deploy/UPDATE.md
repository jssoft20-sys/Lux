# Обновление тестового стенда

1. Соберите новый архив из репозитория: `bash tools/release.sh` → `release/somex-test.tar.gz`.
2. На сервере (архив лежит рядом с папкой `somex`, например в `/home`):

```bash
cd /home
sudo systemctl stop somex
sudo tar xzf somex-test.tar.gz          # распаковывается поверх папки somex, .env не трогается
cd somex && sudo bash install.sh        # ставит новые зависимости, применяет миграции и сид, перезапускает сервис
```

`install.sh` можно запускать сколько угодно раз: существующие `.env` и база сохраняются.

## Полный сброс тестовых данных

Если нужно начать с чистой базы (все аккаунты, сделки и настройки удаляются):

```bash
cd /home
sudo systemctl stop somex
sudo -u postgres psql -c "DROP DATABASE IF EXISTS somex WITH (FORCE);"
redis-cli FLUSHALL
sudo rm -rf somex
sudo tar xzf somex-test.tar.gz
cd somex && sudo bash install.sh
```
