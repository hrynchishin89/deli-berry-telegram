# Deli Berry — тестовые фото и цены владельца

Что сделано:

- обработано фото: 8 шт.;
- фото сжаты и приведены к квадрату 1200×1200;
- фото положены в `webapp/assets/products`;
- цены взяты из названий файлов;
- `data/catalog.json` обновлён;
- совпавшие товары обновлены, новые товары добавлены.

## Обновлены существующие товары

- Бабл ти Марокко 650 мл → 410 ₽ → dybenko-babl-ti-marokko-650-ml → `/assets/products/babl-ti-marokko-650ml.jpg`
- Банан в шоколаде → 190 ₽ → rzhavki-banan-v-molochnom-shokolade, dybenko-banan-v-molochnom-shokolade → `/assets/products/banan-v-shokolade.jpg`
- Клубника в молочном и белом шоколаде → 1990 ₽ → rzhavki-klubnika-v-molochnom-i-belom-shokolade, dybenko-klubnika-v-molochnom-i-belom-shokolade → `/assets/products/klubnika-v-molochnom-i-belom-shokolade-owner.jpg`

## Добавлены новые товары

- Киндер Джой Гарри Поттер → 490 ₽ → `owner-kinder-joy-garri-potter` → `/assets/products/kinder-joy-garri-potter.jpg`
- Киндер Джой Майнкрафт → 490 ₽ → `owner-kinder-joy-minecraft` → `/assets/products/kinder-joy-minecraft.jpg`
- Очень странные дела — набор из 3 шт. → 1500 ₽ → `owner-ochen-strannye-dela-nabor-3-sht` → `/assets/products/ochen-strannye-dela-nabor-3-sht.jpg`
- Фистаблс Милк Кранч → 590 ₽ → `owner-fistabls-milk-crunch` → `/assets/products/fistabls-milk-crunch.jpg`
- Haribo мармеладки «Пиратские монеты» → 390 ₽ → `owner-haribo-piratskie-monety` → `/assets/products/haribo-piratskie-monety.jpg`

## Как установить

1. Открой GitHub → репозиторий `deli-berry-telegram`.
2. Нажми `Add file` → `Upload files`.
3. Перетащи из этого архива папки:
   - `webapp`
   - `data`
   - `docs`
4. Внизу напиши commit: `add owner product photos`.
5. Нажми `Commit changes`.
6. Дождись Render → `Live`.
7. Открой Telegram Mini App и проверь карточки товаров.

## Важно

Этот патч обновляет `data/catalog.json`. Если ты уже вручную правил каталог после V5, сначала скажи — я сделаю SAFE-патч только с фото и отдельной таблицей для вставки.
