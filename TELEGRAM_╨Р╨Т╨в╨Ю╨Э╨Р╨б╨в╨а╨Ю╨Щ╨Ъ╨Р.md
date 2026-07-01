# Telegram автонастройка

Файл `src/telegramBot.js` запускается вместе с сервером и автоматически настраивает бота.

Что ставится автоматически:

- `setMyName` — имя Deli Berry;
- `setMyDescription` — описание;
- `setMyShortDescription` — короткое описание;
- `setMyCommands` — команды;
- `setChatMenuButton` — кнопка «Заказать 🍓», если есть HTTPS `WEBAPP_URL`;
- `deleteWebhook` — отключение webhook, чтобы работал polling.

Ручная команда после деплоя:

```bash
npm run telegram:setup
```

Она делает то же самое, но отдельно и явно.
