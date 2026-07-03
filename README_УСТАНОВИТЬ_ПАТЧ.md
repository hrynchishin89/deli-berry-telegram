# Deli Berry — Yandex catalog + premium design patch

Что внутри:

- `data/catalog.json` — новый каталог из публичных меню Yandex/Yango Deli: 120 позиций.
- `data/categories.json` — обновлённые категории.
- `webapp/styles.css` — глубокий шоколадно-премиальный дизайн.
- `webapp/app.js` — поддержка фотографий товаров.
- `webapp/index.html` — более солидный текст главной.
- `webapp/assets/logo.svg` и `icon.svg` — временный премиальный знак Deli Berry. Его можно заменить на настоящий.
- `docs/КАК_МЕНЯТЬ_КАТАЛОГ_ФОТО_ДИЗАЙН.md` — инструкция для владельца.

Как установить:

1. Откройте GitHub → `deli-berry-telegram`.
2. Нажмите `Add file` → `Upload files`.
3. Перетащите папки `data`, `webapp`, `docs` из этого архива.
4. GitHub заменит совпадающие файлы.
5. Нажмите `Commit changes`.
6. Render сам перезапустится.
7. Проверьте `https://deli-berry-telegram.onrender.com/api/health`.

Важно: публичные меню Яндекс/Yango Deli — это меню доставки. Цены на месте могут отличаться, поэтому в каталоге стоит `needsConfirmation: true`.
