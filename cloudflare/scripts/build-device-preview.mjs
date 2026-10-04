import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const arg = process.argv.indexOf("--out");
const out = resolve(arg >= 0 ? process.argv[arg + 1] : "device-preview-dist");
const project = resolve(".");
if (!out || out === "/" || out === project)
  throw new Error("Unsafe preview output path");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const sourceIndex = await readFile("public/index.html", "utf8");
const index = sourceIndex
  .replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n  <meta name="robots" content="noindex,nofollow">',
  )
  .replace(
    '<script src="app.js"></script>',
    '<script src="catalog-data.js"></script>\n  <script src="preview-config.js"></script>\n  <script src="app.js"></script>',
  );
await writeFile(resolve(out, "index.html"), index);

for (const name of ["app.js", "styles.css"])
  await cp(resolve("public", name), resolve(out, name));

const catalog = JSON.parse(await readFile("public/catalog.json", "utf8"));
const appearances = catalog.appearances.map(
  ({ photoSource: _photoSource, photoVersion: _photoVersion, ...appearance }) =>
    appearance,
);
const publicCatalog = {
  brand: catalog.brand,
  stores: catalog.stores,
  fulfilment: catalog.fulfilment,
  storage: catalog.storage,
  pricing: catalog.pricing,
  products: catalog.products,
  groups: catalog.groups,
  appearances,
};
await writeFile(
  resolve(out, "catalog-data.js"),
  `window.DELI_BERRY_CATALOG = ${JSON.stringify(publicCatalog)};\n`,
);

const assetPaths = new Set(["assets/logo.webp"]);
for (const product of publicCatalog.products) {
  assetPaths.add(product.image);
  assetPaths.add(product.thumbnail);
}
for (const appearance of publicCatalog.appearances)
  for (const photo of appearance.photos) assetPaths.add(photo);
for (const relativePath of assetPaths) {
  if (!relativePath?.startsWith("assets/") || relativePath.includes(".."))
    throw new Error(`Unsafe asset path: ${relativePath}`);
  const destination = resolve(out, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(resolve("public", relativePath), destination);
}

const html = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const phone = html(catalog.brand.phone);
const legal = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#F3EADF">
  <title>Информация — Дели Берри</title>
  <link rel="icon" href="assets/logo.webp">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="legal-content">
    <a class="top-back" href="index.html#contacts">← В каталог</a>
    <div class="brand">
      <img class="brand-logo" src="assets/logo.webp" alt="Дели Берри">
      <div class="brand-copy"><div class="brand-name">Дели Берри</div><div class="brand-tagline">Информационная витрина</div></div>
    </div>
    <h1 id="terms">Информация о витрине</h1>
    <p class="notice">Это версия для просмотра на устройстве. Витрина не принимает заказы и персональные данные, не проводит оплату и не использует средства аналитики.</p>
    <h2>Как оформить заказ</h2>
    <p>Позвоните по номеру <a href="${html(catalog.brand.phoneLink)}">${phone}</a>. Состав, аллергены, дополнения, итоговую стоимость и время получения согласуйте до заказа.</p>
    <h2>Точки</h2>
    <ul>${catalog.stores.map((store) => `<li><strong>${html(store.shortName)}</strong>: ${html(store.address)}. ${html(store.hours)}.</li>`).join("")}</ul>
    <h2 id="seller">Продавец</h2>
    <p><strong>${html(catalog.seller.legalName)}</strong><br>ИНН ${html(catalog.seller.inn)}<br>ОГРНИП ${html(catalog.seller.ogrnip)}</p>
    <h2 id="privacy">Персональные данные</h2>
    <p>На этой информационной странице нет формы заказа, регистрации, оплаты и сбора персональных данных.</p>
  </main>
</body>
</html>
`;
await writeFile(resolve(out, "legal.html"), legal);
await writeFile(
  resolve(out, "preview-config.js"),
  `window.DELI_BERRY_STATIC_CONFIG = Object.freeze({
  previewMode: true,
  ordersEnabled: false,
  dataCollectionEnabled: false,
  paymentEnabled: false,
  paymentMode: "disabled",
  termsUrl: "legal.html#terms",
  privacyUrl: "legal.html#privacy"
});
`,
);
await writeFile(resolve(out, ".nojekyll"), "");
await writeFile(
  resolve(out, "release.json"),
  JSON.stringify(
    {
      mode: "temporary-device-preview",
      commit: process.env.GITHUB_SHA || "local",
      orders: false,
      payment: false,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Device preview built at ${out}`);
