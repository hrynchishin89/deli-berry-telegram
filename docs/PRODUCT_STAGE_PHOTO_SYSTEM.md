# Product Stage Photo System

Формат для новых фото:
1. исходное фото товара;
2. обработанный объект без фона или stage PNG;
3. в `catalog.json` добавить:

```json
"image": "/assets/products/original.jpg",
"stageImage": "/assets/products/stage/product-stage.png",
"cutout": "/assets/products/cutouts/product-cutout.png"
```

Если `stageImage` есть, приложение показывает товар как объёмный объект на премиальной кремовой сцене. Если `stageImage` нет, используется обычное фото.
