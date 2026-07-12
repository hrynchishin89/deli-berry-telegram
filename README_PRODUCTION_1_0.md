# Deli Berry Production 1.0

Единая финальная сборка Telegram Mini App для двух точек Deli Berry.

## Главное

- отдельные меню Дыбенко/Discovery и Зеленопарка;
- варианты объёмов и цены;
- корзина и заказ менеджеру;
- статусы и уведомления;
- ссылка и локальный QR на оплату;
- ID клиентов и бонусный счёт 5%;
- профиль, история и повтор заказа;
- PostgreSQL, защита Telegram и rate limiting;
- админки заказов, каталога и лояльности.

## Начать установку

Откройте файл:

`00_УСТАНОВКА_PRODUCTION_1_0.md`

## Проверка перед загрузкой

```bash
npm ci
npm run release:check
```

## Служебные страницы

- `/api/health`
- `/setup.html`
- `/admin.html`
- `/catalog-admin.html`
- `/loyalty-admin.html`

Секреты хранятся только в Render Environment. Не коммитьте `.env`, токены, PIN и URL базы данных.
