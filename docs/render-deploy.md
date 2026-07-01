# Деплой на HTTPS-хостинг

Нужен любой хостинг, который умеет Node.js и даёт HTTPS-ссылку. Примеры: Render, Railway, VPS, Яндекс Cloud, Timeweb Cloud.

## Вариант через GitHub + Render

1. Создайте аккаунт GitHub.
2. Создайте новый приватный репозиторий, например `deli-berry-telegram`.
3. Загрузите туда все файлы из архива.
4. Откройте Render.
5. New → Web Service.
6. Подключите репозиторий.
7. Build command: `npm install`.
8. Start command: `npm start`.
9. Добавьте Environment Variables из `.env.example`.
10. Нажмите Deploy.

После деплоя Render выдаст HTTPS-ссылку. Её нужно вставить в:

- `WEBAPP_URL`;
- `PUBLIC_URL`.

Потом запустите `npm run telegram:setup`, чтобы бот получил кнопку меню.

## Проверка

Откройте:

- `https://ВАШ-ДОМЕН/api/health` — должно быть `ok: true`;
- `https://ВАШ-ДОМЕН` — должен открыться каталог;
- `https://ВАШ-ДОМЕН/admin.html` — админка с PIN.
