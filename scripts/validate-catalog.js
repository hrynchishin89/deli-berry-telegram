const fs = require('fs');
const path = require('path');
const store = require('../src/store/jsonStore');

(async () => {
  const bundle = await store.getCatalogBundle();
  const categoryIds = new Set(bundle.categories.map((c) => c.id));
  const pointIds = new Set(bundle.points.map((p) => p.id));
  const errors = [];
  const warnings = [];
  const seen = new Set();

  for (const product of bundle.catalog) {
    if (!product.id) errors.push('Товар без id');
    if (seen.has(product.id)) errors.push(`Повторный id: ${product.id}`);
    seen.add(product.id);
    if (!product.name) errors.push(`${product.id}: нет названия`);
    if (!categoryIds.has(product.category)) errors.push(`${product.id}: неизвестная категория ${product.category}`);
    if ((!Array.isArray(product.points) || !product.points.length) && !product.hiddenAt && !product.legacyArchived) warnings.push(`${product.id}: товар скрыт / без точки`);
    for (const point of product.points || []) {
      if (!pointIds.has(point)) errors.push(`${product.id}: неизвестная точка ${point}`);
    }
    if (Array.isArray(product.variants) && product.variants.length) {
      const varIds = new Set();
      for (const variant of product.variants) {
        if (!variant.id || varIds.has(variant.id)) errors.push(`${product.id}: неверный/повторный variant id`);
        varIds.add(variant.id);
        if (!(Number(variant.price) >= 0)) errors.push(`${product.id}/${variant.id}: неверная цена`);
      }
    } else if (!(Number(product.price) >= 0)) errors.push(`${product.id}: неверная цена`);
    if (Array.isArray(product.options) && product.options.length) {
      const groupIds = new Set();
      for (const group of product.options) {
        if (!group.id || groupIds.has(group.id)) errors.push(`${product.id}: неверный/повторный option group id`);
        groupIds.add(group.id);
        if (!Array.isArray(group.values) || !group.values.length) errors.push(`${product.id}/${group.id}: нет вариантов выбора`);
        const valueIds = new Set();
        for (const value of group.values || []) {
          if (!value.id || valueIds.has(value.id)) errors.push(`${product.id}/${group.id}: неверный/повторный option value id`);
          valueIds.add(value.id);
          if (!value.label && !value.name) errors.push(`${product.id}/${group.id}/${value.id}: нет названия варианта`);
        }
      }
    }
    for (const field of ['image', 'cutout', 'stageImage']) {
      const value = String(product[field] || '');
      if (value.startsWith('/assets/')) {
        const file = path.join(__dirname, '..', 'webapp', value.replace(/^\//, ''));
        if (!fs.existsSync(file)) errors.push(`${product.id}: отсутствует ${field} ${value}`);
      }
    }
  }

  const dybenkoCoffee = bundle.catalog.filter((p) => p.points?.includes('dybenko') && p.category === 'coffee');
  if (dybenkoCoffee.length) errors.push(`На Дыбенко найден кофе: ${dybenkoCoffee.map((p) => p.name).join(', ')}`);
  const greenparkCoffee = bundle.catalog.filter((p) => p.points?.includes('rzhavki') && p.category === 'coffee');
  if (!greenparkCoffee.length) errors.push('В Зеленопарке отсутствует категория кофе');
  const dybenkoTea = bundle.catalog.filter((p) => p.points?.includes('dybenko') && /чай|улун|травяной/i.test(p.name));
  if (dybenkoTea.length) errors.push(`На Дыбенко найден листовой чай: ${dybenkoTea.map((p) => p.name).join(', ')}`);

  const activeProducts = bundle.catalog.filter((p) => Array.isArray(p.points) && p.points.length);
  const hiddenProducts = bundle.catalog.filter((p) => Array.isArray(p.points) && !p.points.length);
  const report = {
    ok: errors.length === 0,
    products: bundle.catalog.length,
    activeProducts: activeProducts.length,
    hiddenProducts: hiddenProducts.length,
    categories: bundle.categories.length,
    points: bundle.points.map((p) => p.name),
    dybenko: activeProducts.filter((p) => p.points?.includes('dybenko')).length,
    greenpark: activeProducts.filter((p) => p.points?.includes('rzhavki')).length,
    greenparkCoffee: greenparkCoffee.length,
    errors,
    warnings: warnings.slice(0, 20),
    warningCount: warnings.length
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
})().catch((error) => { console.error(error); process.exit(1); });
