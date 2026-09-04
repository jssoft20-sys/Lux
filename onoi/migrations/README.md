# Миграции базы данных (Alembic)

* `alembic upgrade head` — применить все миграции (использует `DATABASE_URL` из `.env`).
* `alembic revision --autogenerate -m "описание"` — создать новую миграцию после изменения моделей.
* `alembic downgrade -1` — откатить последнюю миграцию.

Первая миграция `0001_initial` создаёт чистую схему OnoiPay. Старая база LUXON не используется.
