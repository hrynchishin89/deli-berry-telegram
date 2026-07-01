# Google Sheets — опционально

Проект и без Google Sheets хранит заказы в `data/orders.json` и показывает их в админке.

Google Sheets нужен, если менеджерам удобнее таблица.

## Подключение

1. Создайте Google Таблицу.
2. Откройте Расширения → Apps Script.
3. Вставьте код из `google-apps-script/Code.gs`.
4. Deploy → New deployment → Web app.
5. Execute as: Me.
6. Who has access: Anyone with the link.
7. Скопируйте URL.
8. Вставьте URL в переменную `GOOGLE_SHEETS_WEBHOOK_URL` на хостинге.
9. Сделайте тестовый заказ.

Если Google Sheets упадёт, заказ всё равно сохранится локально и уйдёт в Telegram-группу.
