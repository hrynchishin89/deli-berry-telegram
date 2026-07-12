# Render Production

Полная инструкция находится в `docs/INSTALL_PRODUCTION_RU.md`.

Обязательные условия коммерческого запуска:

- Web Service Starter или выше;
- Render Postgres в том же регионе;
- `DATABASE_URL` = Internal Database URL;
- `REQUIRE_TELEGRAM_AUTH=true`;
- `/api/health` показывает `database=postgres` и `persistentDatabase=true`.

Сборка: `npm ci --omit=dev`. Запуск: `npm start`.
