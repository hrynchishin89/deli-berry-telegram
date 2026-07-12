# Google Sheets — дополнительная копия

Основное хранилище Production 1.0 — PostgreSQL. Google Sheets можно подключить как дополнительную таблицу для менеджеров через `GOOGLE_SHEETS_WEBHOOK_URL` и код `google-apps-script/Code.gs`.

Отказ Google Sheets не должен мешать записи заказа в PostgreSQL и отправке в Telegram.
