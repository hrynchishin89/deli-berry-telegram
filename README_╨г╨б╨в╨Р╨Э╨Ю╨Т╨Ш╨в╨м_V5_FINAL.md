# Deli Berry V5 FINAL — установка

Это финальный объединённый пакет: V3 visual polish + V4 Motion 3D + менеджерские ответы/оплата/QR + релизная адаптация Telegram Mini App.

## Что загружать в GitHub

На главной странице репозитория `deli-berry-telegram` нажмите:

`Add file` → `Upload files`

Перетащите в GitHub папки:

- `webapp`
- `data`
- `src`
- `docs`

и файл:

- `README_УСТАНОВИТЬ_V5_FINAL.md`

Потом нажмите `Commit changes`.

## Что не трогать

В Render не меняйте:

- `BOT_TOKEN`
- `WEBAPP_URL`
- `PUBLIC_URL`
- `MANAGER_CHAT_ID`
- `ADMIN_PIN`

## Проверка

После Render `Live` откройте:

`https://deli-berry-telegram.onrender.com/api/health`

Должно быть:

- `ok: true`
- `botToken: true`
- `webAppUrl: true`
- `managerChatId: true`

Потом откройте Telegram → бот → `Заказать 🍓`.
