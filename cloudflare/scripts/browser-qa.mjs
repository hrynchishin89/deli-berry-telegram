import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.QA_URL || "http://127.0.0.1:8787",
  out = process.env.QA_OUTPUT || "evidence";
await mkdir(out + "/screenshots", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
await context.route("https://telegram.org/js/telegram-web-app.js", (r) =>
  r.abort(),
);
function sign(id) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id }),
    query_id: "synthetic-qa",
  });
  const checked = [...p]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => k + "=" + v)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update("test-only-token")
    .digest();
  p.set("hash", createHmac("sha256", secret).update(checked).digest("hex"));
  return p.toString();
}
async function identity(id) {
  await context.addInitScript((initData) => {
    const noop = () => {};
    window.Telegram = {
      WebApp: {
        initData,
        colorScheme: "dark",
        ready: noop,
        expand: noop,
        setHeaderColor: noop,
        setBackgroundColor: noop,
        onEvent: noop,
        BackButton: { onClick: noop, hide: noop, show: noop },
      },
    };
  }, sign(id));
}
await identity(100);
const page = await context.newPage(),
  issues = [];
page.on("pageerror", (e) => issues.push(e.message));
const screenshot = async (name, fullPage = true) => {
  await page.screenshot({
    path: out + "/screenshots/" + name + ".png",
    fullPage,
  });
};
const overflow = async () =>
  page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
const checks = [];
const check = (name, details) => checks.push({ name, status: "PASS", details });
const click = (selector) => page.locator(selector).click();
const waitImages = () =>
  page.evaluate(() =>
    Promise.all([...document.images].map((i) => i.decode().catch(() => {}))),
  );
async function noOverflow(name) {
  const d = await overflow();
  assert.ok(d.scroll <= d.width, JSON.stringify(d));
  check(name, d);
}
try {
  for (const width of [360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    await page.goto(origin);
    await page.waitForSelector('[data-appearance="B04"]');
    await waitImages();
    await noOverflow("catalog-" + width);
    await screenshot("catalog-" + width, false);
    if (width === 390) {
      const m = await page
        .locator(".catalog-grid")
        .evaluate((el) => ({
          photo: el.querySelector("img").getBoundingClientRect().toJSON(),
          price: el.querySelector(".price").getBoundingClientRect().toJSON(),
        }));
      assert.ok(m.photo.y <= 300);
      assert.ok(m.price.bottom < 784);
      assert.ok(Math.abs(m.photo.width - m.photo.height) < 1);
      check("first-screen-390", m);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  await page.waitForSelector('[data-group="SET-12"]');
  await click('[data-group="SET-12"]');
  assert.equal(await page.locator(".product-card").count(), 2);
  await waitImages();
  await screenshot("set12-390", false);
  await noOverflow("set12-390");
  await click('[data-category="bouquet"]');
  assert.equal(await page.locator(".product-card").count(), 2);
  await waitImages();
  await screenshot("bouquet19-fresh-390", false);
  assert.match(await page.locator(".catalog-grid").innerText(), /2\s750/);
  assert.match(await page.locator(".catalog-grid").innerText(), /2\s790/);
  await click('[data-type="freeze_dried"]');
  assert.equal(await page.locator('[data-appearance="A07"]').count(), 0);
  assert.equal(await page.locator('[data-appearance="B09"]').count(), 1);
  await waitImages();
  await screenshot("bouquet19-fd-390", false);
  check(
    "bouquet-19-compatibility",
    "2 fresh appearances, 1 FD; explicit reset",
  );
  await page.goto(origin + "/?sku=SET-12-A06");
  await page.waitForSelector('[data-action="add-cart"]');
  assert.equal(await page.locator('[data-bind="berryAddon"]').count(), 0);
  await page.locator('[data-bind="inscription"]').check();
  await page.locator("#inscriptionText").fill("С праздником");
  await click('[data-action="add-cart"]');
  await page.waitForSelector('[data-action="to-cart"]');
  await click('[data-action="back"]');
  await click('[data-category="bouquet"]');
  await click('[data-type="freeze_dried"]');
  await click('[data-appearance="B09"]');
  await click('[data-action="add-cart"]');
  await page.waitForSelector('[data-action="to-cart"]');
  await click('[data-action="to-cart"]');
  await page.waitForSelector(".cart-line");
  assert.equal(await page.locator(".cart-line").count(), 2);
  await waitImages();
  await screenshot("cart-390");
  assert.match(await page.locator("#app").innerText(), /3\s730/);
  check(
    "cart-configurations",
    "A06 + inscription 2040, B09 FD 1690; total 3730",
  );
  await click('[data-action="checkout"]');
  await page.waitForSelector("#customerPhone");
  const tomorrow = new Date(Date.now() + 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  await page.locator("#orderDate").fill(tomorrow);
  await page.locator("#orderDate").dispatchEvent("change");
  await page.waitForSelector('#orderTime option[value="15:15"]', {
    state: "attached",
  });
  await page.locator("#orderTime").selectOption("15:15");
  await waitImages();
  await screenshot("checkout-pickup-390");
  await click('[data-fulfilment="courier"]');
  assert.equal(await page.locator("#deliveryAddress").count(), 1);
  assert.match(
    await page.locator("#app").innerText(),
    /Доставка\s+оплачивается отдельно/,
  );
  assert.doesNotMatch(await page.locator("#app").innerText(), /Доставка.*0\s₽/);
  await screenshot("checkout-courier-390");
  check("courier", "Recipient reuse and separate courier tariff");
  await click('[data-fulfilment="pickup"]');
  await page.setViewportSize({ width: 390, height: 460 });
  await page.locator("#customerPhone").focus();
  await page.locator("#customerPhone").scrollIntoViewIfNeeded();
  const field = await page.locator("#customerPhone").boundingBox();
  assert.ok(field.y >= 0 && field.y + field.height <= 460);
  await screenshot("checkout-small-height-390", false);
  check(
    "keyboard-viewport-resize",
    "390×460: active field remains visible; device keyboard NOT TESTED",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#customerName").fill("Синтетическая заявка");
  await page.locator("#customerPhone").fill("+79990000000");
  await page.locator('[data-bind="consent"]').check();
  await click('[data-action="submit-order"]');
  await page.waitForSelector(".success-card");
  const id = (await page.locator("h1").innerText()).match(
    /DB-[A-F0-9]{16}/,
  )?.[0];
  assert.ok(id);
  check("browser-d1-persistence", { orderId: id, fixture: "synthetic" });
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("deliBerry.pending.v2")),
    null,
  );
  const operatorContext = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 1,
  });
  await operatorContext.route(
    "https://telegram.org/js/telegram-web-app.js",
    (r) => r.abort(),
  );
  await operatorContext.addInitScript((initData) => {
    const noop = () => {};
    window.Telegram = { WebApp: { initData, ready: noop, expand: noop } };
  }, sign(900));
  const op = await operatorContext.newPage();
  op.on("pageerror", (e) => issues.push(e.message));
  await op.goto(origin + "/operator.html");
  await op.waitForSelector(".operator-item");
  assert.equal(await op.locator(".operator-item").count(), 2);
  assert.match(await op.locator("#orderDetail").innerText(), /SET-12-A06/);
  assert.match(await op.locator("#orderDetail").innerText(), /BQT-B09-FD/);
  await op.evaluate(() =>
    Promise.all([...document.images].map((i) => i.decode().catch(() => {}))),
  );
  await op.screenshot({
    path: out + "/screenshots/operator-1280.png",
    fullPage: true,
    mask: [
      op
        .locator(".detail-table-row")
        .filter({ has: op.locator("dt", { hasText: "Клиент" }) }),
      op.locator(".order-card-meta"),
    ],
    maskColor: "#F3EADF",
  });
  await op.locator('[data-action="edit-revision"]').click();
  await op.locator('[data-rline="0"][data-rfield="quantity"]').fill("2");
  await op
    .locator('[data-revision="note"]')
    .fill("Тест согласования количества");
  await op.locator('[data-action="quote-revision"]').click();
  await op.waitForSelector('[data-action="send-revision"]:not([disabled])');
  assert.match(await op.locator("#revisionTotal").innerText(), /5\s770/);
  await op.locator('[data-action="send-revision"]').click();
  await op.waitForSelector("#revisionForm", { state: "detached" });
  await click('[data-action="refresh-orders"]');
  await page.waitForSelector('[data-action="accept-revision"]');
  await click('[data-action="accept-revision"]');
  await page.waitForSelector('[data-action="accept-revision"]', {
    state: "detached",
  });
  assert.match(await page.locator("#app").innerText(), /5\s770/);
  await op.locator("#refreshOrders").click();
  await op.waitForFunction(() =>
    document.querySelector("#orderDetail").textContent.includes("5\u00a0770"),
  );
  await op.locator('[data-next="CONFIRMED"]').click();
  await op.waitForFunction(
    () =>
      document.querySelector("#orderDetail .status-pill")?.textContent ===
      "Подтверждены",
  );
  check(
    "operator-revision",
    "Server quote; buyer explicitly accepts new items and sum; operator reconfirms",
  );
  await operatorContext.close();
  await page.goto(origin);
  await page.waitForSelector('[data-appearance="B04"]');
  await page.addStyleTag({ content: "html{font-size:125%}" });
  await click('[data-group="SET-12"]');
  await noOverflow("text-125-percent");
  await screenshot("text-125-390", false);
  const color = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
    scheme: Telegram.WebApp.colorScheme,
  }));
  assert.equal(color.background, "rgb(243, 234, 223)");
  assert.equal(color.text, "rgb(47, 40, 39)");
  check("telegram-dark-theme-stub", color);
  assert.deepEqual(issues, []);
  check("javascript-runtime", "No uncaught page errors");
  console.log(JSON.stringify({ status: "PASS", checks }, null, 2));
} catch (e) {
  checks.push({
    name: "blocked-browser-step",
    status: "FAIL",
    details: e.message,
  });
  await screenshot("failure", true);
  throw e;
} finally {
  await writeFile(
    out + "/browser-results.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        runtime:
          "Chromium / local Worker + native D1; signed synthetic Telegram identity; no real Telegram or payment",
        checks,
        issues,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
