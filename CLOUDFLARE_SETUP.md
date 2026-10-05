# Дели Берри · Cloudflare Workers Free

Один fetch Worker: Mini App, кабинет оператора, JSON API, Telegram webhook и Яндекс Пэй webhook. Static Assets обходят Worker на статических маршрутах. D1 вместо PostgreSQL, без Express, ORM, Node compatibility и постоянного процесса. Только стандартные Web APIs / Web Crypto.

Резерв: ветка `release/deli-berry-miniapp-1.1.1`, PR #2 и старый main/Render не изменяются. Новый код изолирован в `cloudflare/`; архив содержит обычные исходники, тесты и миграции. После распаковки редактируйте этот каталог; перед новым PR пересоберите архив. CI распаковывает и проверяет ровно содержимое архива. Сам PR не включает боевые интеграции.

## Локально

Node.js 24; все npm-зависимости только для разработки.

```sh
tar -xzf deli-berry-cloudflare-2.0.0.tar.gz
cd cloudflare
npm ci
npm run migrate:local
npm run dev
npm run check
```

`wrangler dev` запускает локальный workerd и D1 на localhost:8787. Это инструмент разработки, не production Node-сервер. Для изолированного локального ввода секретов скопируйте `.dev.vars.example` в `.dev.vars`; файл исключён из Git. Preview работает без секретов; создание заказов и платежи выключены.

## Cloudflare — действия владельца

1. Открыть Cloudflare, войти и выбрать **Workers Free**. Не вводить карту и не выбирать Paid. Согласия/проверки учётной записи выполняет владелец. Создать бесплатный `workers.dev` subdomain, если его ещё нет.
2. Авторизовать локальный Wrangler командой `npx wrangler login`. Создать D1: `npx wrangler d1 create deli-berry-orders`. Скопировать возвращённый UUID в `wrangler.toml` вместо нулевого UUID.
3. `npm run migrate:remote`, затем `npm run deploy`. Wrangler напечатает фактический `https://deli-berry.<subdomain>.workers.dev`. Не покупать домен. Проверить `/`, `/operator.html`, `/api/health`, `/api/catalog`. До выполнения этих шагов deployment URL не существует.
4. GitHub → Settings → Environments: `cloudflare-free`. Секреты CI: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Токен ограничить нужным аккаунтом, Workers Scripts Edit + D1 Edit; для workers.dev DNS Edit не нужен. Создание токена/предоставление доступа выполняет владелец.
5. Repository Variables: `CLOUDFLARE_D1_DATABASE_ID` (UUID) и `CLOUDFLARE_DEPLOY_ENABLED=true` после проверки тарифа Free. Workflow `.github/workflows/deploy-cloudflare.yml`: тесты на PR, автоматический deploy после push в main, ручной workflow_dispatch для отдельной ветки. На PR из чужой ветки deploy и secrets не выдаются. Default permissions — только contents:read. Не меняйте существующие Render/VK workflows.
6. После первого deploy измерить CPU на каждой группе запросов в Workers Observability (p50/p95/max, ошибки exceededCpu). Free: 10 ms CPU, 50 D1-запросов на invocation, 100 000 Worker requests/day; D1: 5 млн прочитанных/100 тыс. записанных строк/day, 500 MB/database, 5 GB/account. При квотах Free запросы перестают выполняться, оплачиваемого перерасхода не возникает. Не переключать на Paid. Static Assets обслуживаются отдельно и бесплатно.

## Секреты приложения — только Cloudflare Secrets

Вводите через защищённый Cloudflare UI или интерактивный `npx wrangler secret put ИМЯ`, не аргументом shell/файлом в Git:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_OPERATOR_ID — положительный Telegram ID единственного оператора, не ID группы
- TELEGRAM_WEBHOOK_SECRET — дополнительный случайный секрет длиной ≥32 символов для Telegram secret_token
- YANDEX_PAY_MERCHANT_ID
- YANDEX_PAY_API_KEY
- YANDEX_PAY_WEBHOOK_SECRET — случайный секрет ≥32 символов для непредсказуемого пути callback

Яндекс Пэй **не подписывает webhook общим HMAC-секретом**. Официальная подпись ES256 проверяется через Web Crypto и публичные ключи фиксированного `/api/jwks` на sandbox.pay.yandex.ru или pay.yandex.ru. `YANDEX_PAY_WEBHOOK_SECRET` — дополнительная защита URL, не замена подписи. Callback URL в кабинете продавца: `APP_ORIGIN/api/payments/yandex-pay/<sha256('deli-berry-yandex-callback:'+secret)>`; провайдер дописывает `/v1/webhook`. Значение/полный секретный URL не публиковать. Telegram endpoint: `/api/telegram/webhook`, `secret_token=TELEGRAM_WEBHOOK_SECRET`.

## Включение интеграций — отдельное подтверждение владельца

Сейчас ORDERS_ENABLED=false, TELEGRAM_ENABLED=false, PAYMENT_MODE=disabled, OWNER_LIVE_APPROVED=false, LIVE_PAYMENTS_APPROVED=false, LEGAL_APPROVED=false. Деплой preview не меняет BotFather, polling старого бота, Telegram webhook или кабинет Яндекс Пэй.

После отдельного подтверждения: утвердить юридические тексты, сроки/кассовую схему и tax; указать APP_ORIGIN (фактический workers.dev URL), TERMS_URL, PRIVACY_URL, LEGAL_VERSION; внести секреты. Сначала проверить Яндекс Пэй sandbox и возврат. Только затем отдельно утвердить production, fiscalMode=yandex, налог и Live gates. Старый Render polling остановить лишь после резервного экспорта и согласованного переключения. Не устанавливайте новый webhook одновременно со старым polling.

Текущие старые заказы/клиентские данные не экспортировались и не переносились: доступ к исходной рабочей БД/JSON не был предоставлен. Перед переключением владелец сохраняет и проверяет резервный экспорт; старый сервис остаётся резервом. Миграции создают схему и точки, не выдумывают записи/PAID для старых заказов.

## D1 и целостность

- `0001_initial.sql`: users, stores, orders, order_events, payments, webhook_events, notifications, audit_events, rate_limits, schema_migrations; FK, UNIQUE и индексы. `mutation_guards` обеспечивает проверку версий с откатом всего D1 batch. Служебную таблицу d1_migrations ведёт Wrangler.
- `0002_stores.sql`: исходные две точки, 10:00–22:00 МСК, enabled=true, пустой stopList.
- `0003_payment_proof.sql`: триггеры запрещают прямой PAID без сохранённого доказательства проверенного webhook и совпадения суммы/orderId.

Ключ заказа UNIQUE(user_id,request_key); конфликт комплектации — 409. Один платёж на заказ, UNIQUE request_id; повтор API использует тот же request_id. Webhook event_key PRIMARY KEY; доказательство, статус, журнал и outbox фиксируются одним batch. При гонке новая версия не перезаписывается; провайдер получает ошибку для повтора. Polling sync-payment только читает статус, PAID не ставит. Проверяются orderId, merchantId, RUB и точные копейки; CAPTURED/REFUNDED не понижаются старым событием.

Список заказов: 20 записей/страница, без N+1 запросов. Все записи журнала остаются в БД; API history отдаёт страницы по 50. Кабинет загружает полный журнал выбранного заказа без изменения дизайна. Cron раз в минуту: максимум 2 истёкших заказа, 2 уведомления и 200 устаревших rate-limit записей. Outbox с lease и повтором; после сбоя между Telegram send и отметкой D1 возможен повтор сообщения (у Telegram sendMessage нет идемпотентного ключа). Дубли заказов/платежей при этом исключаются отдельно.

## Стоимость и оставшиеся проверки

Инфраструктура на **Workers Free + D1 + Static Assets + workers.dev — $0 регулярных платежей**, пока аккаунт остаётся Free. Платные сервисы, карта, домен и Render upgrade не подключались. Комиссия платёжного провайдера при будущем боевом эквайринге — отдельный договор, не стоимость этой инфраструктуры.

Фактический deployment пока заблокирован проверкой браузера Cloudflare и отсутствием авторизованного Wrangler/API token. Поэтому CPU production и визуальная проверка 360/390/430 px ещё не подтверждены. Не считать локальные тесты доказательством этих двух пунктов. Для приёмки после deploy проверить каталог/карточку/форму/заказы/контакты/кабинет на каждом размере: отсутствие горизонтального overflow, доступность кнопок/полей, согласия и корректность ошибок. Дизайн/CSS/клиентский app.js/каталог/изображения побайтово совпадают с резервом.

Если реальные метрики обнаружат превышение CPU, сначала оптимизировать конкретный маршрут. Если он всё равно не проходит Free, отдельно перенести на Cloudflare Pages + Supabase Free PostgreSQL + Supabase Edge Functions и сообщить измеренную причину. Render не является резервным способом хостинга новой версии.

Официальные источники: https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/d1/platform/pricing/ ; https://developers.cloudflare.com/d1/worker-api/d1-database/ ; https://developers.cloudflare.com/workers/static-assets/binding/ ; https://pay.yandex.ru/docs/ru/custom/backend/merchant-api/webhook
