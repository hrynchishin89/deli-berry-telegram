import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { JSDOM } from "jsdom";
import catalog from "../public/catalog.json" with { type: "json" };
import { priceCart } from "../src/domain.mjs";
const config = {
  ordersEnabled: true,
  dataCollectionEnabled: true,
  paymentEnabled: false,
  paymentMode: "disabled",
  termsUrl: "/legal.html#terms",
  privacyUrl: "/legal.html#privacy",
};
const settle = () => new Promise((r) => setTimeout(r, 10));
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await settle();
  }
  assert.fail("Не дождались клиентского состояния");
}
async function page(
  t,
  file = "index",
  handler = () => null,
  authenticated = true,
  query = "",
  saved = {},
) {
  const dom = new JSDOM(
    await readFile(
      new URL("../public/" + file + ".html", import.meta.url),
      "utf8",
    ),
    {
      url: "https://example.test/" + query,
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  t.after(() => dom.window.close());
  const w = dom.window;
  for (const [key, value] of Object.entries(saved))
    w.sessionStorage.setItem(key, value);
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(w, "crypto", { value: crypto.webcrypto });
  w.TextEncoder = TextEncoder;
  w.structuredClone = structuredClone;
  const noop = () => {},
    button = {
      hide: noop,
      show: noop,
      onClick: noop,
      offClick: noop,
      setParams: noop,
    };
  w.Telegram = {
    WebApp: {
      initData: authenticated ? "signed-test" : "",
      ready: noop,
      expand: noop,
      MainButton: button,
      BackButton: button,
    },
  };
  const calls = [];
  w.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const custom = await handler(url, options);
    if (custom) return custom;
    const data =
      url === "/api/catalog"
        ? catalog
        : url === "/api/config"
          ? config
          : url === "/api/me"
            ? { id: 100, operator: false }
            : url === "/api/orders"
              ? { orders: [], nextBefore: null }
              : url.startsWith("/api/slots?")
                ? { slots: ["15:00", "15:15", "15:30"] }
                : url === "/api/quote"
                  ? priceCart(catalog, JSON.parse(options.body))
                  : null;
    if (!data) throw new Error("Unexpected " + url);
    return { ok: true, json: async () => structuredClone(data) };
  };
  await w.eval(
    await readFile(
      new URL(
        "../public/" + (file === "index" ? "app" : file) + ".js",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return { w, calls, dom };
}
function click(w, s) {
  const el = w.document.querySelector(s);
  assert.ok(el, s);
  el.click();
}
function fill(w, s, v, event = "input") {
  const el = w.document.querySelector(s);
  assert.ok(el, s);
  if (el.type === "checkbox") el.checked = v;
  else el.value = v;
  el.dispatchEvent(new w.Event(event, { bubbles: true }));
}
async function add(w, id = "B04") {
  click(w, `[data-appearance="${id}"]`);
  click(w, '[data-action="add-cart"]');
  await until(() => w.document.querySelector('[data-action="to-cart"]'));
}
async function checkout(w) {
  await add(w);
  click(w, '[data-action="to-cart"]');
  click(w, '[data-action="checkout"]');
  await until(() =>
    w.document.querySelector('#orderTime option[value="15:15"]'),
  );
  fill(w, "#orderTime", "15:15", "change");
  fill(w, "#customerName", "Тест");
  fill(w, "#customerPhone", "+79990000000");
  fill(w, '[data-bind="consent"]', true, "change");
}
test("A1/A5: explicit incompatible reset, 19 group, old SKU link and exact price", async (t) => {
  const { w } = await page(t, "index", () => null, true, "?sku=BQT-A07-FRESH");
  assert.match(w.document.querySelector("h1").textContent, /19 ягод/);
  assert.match(w.document.querySelector("#app").textContent, /2\s750/);
  click(w, '[data-action="back"]');
  click(w, '[data-type="freeze_dried"]');
  assert.match(
    w.document.querySelector('[role="status"]').textContent,
    /Выберите оформление/,
  );
  assert.equal(w.document.querySelector('[data-appearance="A07"]'), null);
  click(w, '[data-appearance="B09"]');
  assert.match(w.document.querySelector("#app").textContent, /1\s690/);
});
test("A2/A5: A06 inscription and two distinct appearances survive cart and filters", async (t) => {
  const { w } = await page(t);
  click(w, '[data-group="SET-12"]');
  click(w, '[data-appearance="A06"]');
  fill(w, '[data-bind="inscription"]', true, "change");
  fill(w, "#inscriptionText", "Тестовая надпись");
  click(w, '[data-action="add-cart"]');
  await until(() => w.document.querySelector('[data-action="to-cart"]'));
  click(w, '[data-action="back"]');
  click(w, '[data-appearance="B02"]');
  click(w, '[data-action="add-cart"]');
  await until(() => w.document.querySelector('[data-action="to-cart"]'));
  click(w, '[data-action="to-cart"]');
  assert.equal(w.document.querySelectorAll(".cart-line").length, 2);
  assert.match(w.document.querySelector("#app").textContent, /3\s630/);
  assert.match(
    w.document.querySelector("#app").textContent,
    /Тестовая надпись/,
  );
});
test("A7: response lost after send retains cart/form and identical request key", async (t) => {
  const { w, calls } = await page(t, "index", (url, o) =>
    url === "/api/orders" && o.method === "POST"
      ? Promise.reject(new Error("lost"))
      : null,
  );
  await checkout(w);
  click(w, '[data-action="submit-order"]');
  await until(() =>
    w.document
      .querySelector("#submitError")
      ?.textContent.includes("без создания второго"),
  );
  assert.ok(w.document.querySelector("#customerPhone"));
  click(w, '[data-action="submit-order"]');
  await until(
    () =>
      calls.filter(
        (c) => c.url === "/api/orders" && c.options.method === "POST",
      ).length === 2,
  );
  const r = calls.filter(
    (c) => c.url === "/api/orders" && c.options.method === "POST",
  );
  assert.equal(
    r[0].options.headers["Idempotency-Key"],
    r[1].options.headers["Idempotency-Key"],
  );
  assert.equal(r[0].options.body, r[1].options.body);
  assert.equal(w.document.querySelector(".success-card"), null);
  assert.ok(
    !w.sessionStorage.getItem("deliBerry.pending.v2").includes("signed-test"),
  );
});
test("A9/A12: public preview has no contact collection; guest orders no authenticated request", async (t) => {
  const { w, calls } = await page(
    t,
    "index",
    (url) =>
      url === "/api/config"
        ? {
            ok: true,
            json: async () => ({
              ...config,
              ordersEnabled: false,
              dataCollectionEnabled: false,
            }),
          }
        : null,
    false,
  );
  await add(w);
  click(w, '[data-action="to-cart"]');
  click(w, '[data-action="checkout"]');
  assert.equal(w.document.querySelector("#customerPhone"), null);
  click(w, '[data-route="orders"]');
  assert.match(
    w.document.querySelector("#app").textContent,
    /Откройте приложение в Telegram/,
  );
  assert.equal(calls.filter((c) => c.url === "/api/orders").length, 0);
});
test("A7: success only after API persistence response, then pending storage cleared", async (t) => {
  const { w } = await page(t, "index", (url, o) =>
    url === "/api/orders" && o.method === "POST"
      ? {
          ok: true,
          json: async () => ({
            order: {
              id: "DB-1234567890ABCDEF",
              status: "WAITING_CONFIRMATION",
              customer: { phone: "+79990000000" },
              fulfilment: { type: "pickup" },
              items: [],
              total: 1190,
              store: { name: "Discovery" },
              schedule: { date: "2026-10-03", time: "15:15" },
            },
          }),
        }
      : null,
  );
  await checkout(w);
  click(w, '[data-action="submit-order"]');
  await until(() => w.document.querySelector(".success-card"));
  assert.match(w.document.querySelector("h1").textContent, /получен/);
  assert.equal(w.sessionStorage.getItem("deliBerry.pending.v2"), null);
});
test("Оператор: чужой Telegram ID не загружает список заказов", async (t) => {
  const { w, calls } = await page(t, "operator");
  assert.match(
    w.document.querySelector("#operatorError").textContent,
    /только оператору/,
  );
  assert.equal(
    calls.filter((c) => c.url.startsWith("/api/operator/")).length,
    0,
  );
});
test("Оператор: пользовательский HTML экранирован; ручного подтверждения оплаты нет", async (t) => {
  const order = {
    id: "DB-1234567890ABCDEF",
    status: "WAITING_CONFIRMATION",
    createdAt: new Date().toISOString(),
    customer: { name: "<img src=x onerror=alert(1)>", phone: "+79990000000" },
    product: { title: "Тест" },
    variant: { label: "Свежая" },
    quantity: 1,
    total: 100,
    addOns: [{ name: "<script>bad()</script>", unitPrice: 100 }],
    fulfilment: { type: "pickup", label: "Самовывоз" },
    store: { name: "Discovery" },
    schedule: { date: "2026-10-01", time: "15:15" },
    payment: { status: "NOT_CREATED" },
    history: [],
    allowedTransitions: ["CONFIRMED", "CANCELLED"],
  };
  const { w } = await page(t, "operator", (url) => {
    const d =
      url === "/api/me"
        ? { operator: true }
        : url === "/api/operator/orders"
          ? { orders: [order], nextBefore: null }
          : url === "/api/operator/notifications"
            ? { notifications: [] }
            : null;
    return d ? { ok: true, json: async () => d } : null;
  });
  await until(() => w.document.querySelector('[data-next="CONFIRMED"]'));
  assert.equal(w.document.querySelector("#orderDetail img"), null);
  assert.equal(w.document.querySelector("#orderDetail script"), null);
  assert.equal(w.document.querySelector('[data-next="PAID"]'), null);
});
test("A3/A10 operator sees every appearance, SKU, inscription and per-line batch", async (t) => {
  const q = priceCart(catalog, {
    items: [
      {
        sku: "SET-12-A06",
        appearanceId: "A06",
        quantity: 1,
        addOns: [{ id: "chocolate-inscription" }],
        inscriptionText: "Тестовая надпись",
      },
      { sku: "BQT-B09-FD", appearanceId: "B09", quantity: 1, addOns: [] },
    ],
  });
  const order = {
    ...q,
    id: "DB-1234567890ABCDEF",
    status: "IN_PRODUCTION",
    createdAt: new Date().toISOString(),
    customer: {},
    store: {},
    fulfilment: { type: "pickup" },
    schedule: { date: "2026-10-03", time: "15:15" },
    payment: { status: "CAPTURED" },
    history: [],
    allowedTransitions: ["READY"],
  };
  const { w } = await page(t, "operator", (url) => {
    const d =
      url === "/api/me"
        ? { id: 900, operator: true }
        : url === "/api/operator/orders"
          ? { orders: [order], nextBefore: null }
          : url === "/api/operator/notifications"
            ? { notifications: [] }
            : null;
    return d ? { ok: true, json: async () => d } : null;
  });
  await until(() => w.document.querySelector('[data-next="READY"]'));
  const detail = w.document.querySelector("#orderDetail");
  assert.equal(detail.querySelectorAll(".operator-item img").length, 2);
  assert.match(detail.textContent, /SET-12-A06/);
  assert.match(detail.textContent, /BQT-B09-FD/);
  assert.match(detail.textContent, /Тестовая надпись/);
  assert.equal(detail.querySelectorAll("[data-manufactured]").length, 2);
  assert.equal(detail.querySelectorAll("[data-expires]").length, 1);
});
test("A7 changed server price needs consent and updates every displayed cart line", async (t) => {
  let quotes = 0;
  const updated = structuredClone(catalog);
  updated.products
    .find((p) => p.id === "SET-09")
    .variants.find((v) => v.id === "SET-09-FRESH").price = 1290;
  const { w } = await page(t, "index", (url, o) =>
    url === "/api/quote"
      ? {
          ok: true,
          json: async () =>
            priceCart(++quotes > 1 ? updated : catalog, JSON.parse(o.body)),
        }
      : null,
  );
  await add(w);
  click(w, '[data-action="to-cart"]');
  click(w, '[data-action="checkout"]');
  await until(() => w.document.querySelector('[data-action="accept-price"]'));
  assert.ok(w.document.querySelector('[data-action="submit-order"]').disabled);
  click(w, '[data-action="accept-price"]');
  assert.match(
    w.document.querySelector(".cart-line strong").textContent,
    /1\s290/,
  );
  assert.equal(w.document.querySelector('[data-action="accept-price"]'), null);
});
test("A5 same SKU with different appearances remains separate after navigation", async (t) => {
  const { w } = await page(t);
  click(w, '[data-group="SET-16"]');
  await add(w, "B01");
  click(w, '[data-action="back"]');
  await add(w, "B03");
  click(w, '[data-action="to-cart"]');
  const saved = JSON.parse(w.sessionStorage.getItem("deliBerry.cart.v2"));
  assert.equal(saved.cart.length, 2);
  assert.ok(saved.cart.every((i) => i.raw.sku === "SET-16-FRESH"));
  assert.deepEqual(
    saved.cart.map((i) => i.raw.appearanceId),
    ["B01", "B03"],
  );
  assert.equal(w.document.querySelectorAll(".cart-line").length, 2);
});
test("A7 rapid double submit waits for one quote and creates one request identity", async (t) => {
  const { w, calls } = await page(t, "index", async (url, o) => {
    if (url === "/api/quote") {
      await new Promise((r) => setTimeout(r, 40));
      return {
        ok: true,
        json: async () => priceCart(catalog, JSON.parse(o.body)),
      };
    }
    if (url === "/api/orders" && o.method === "POST") {
      await new Promise((r) => setTimeout(r, 100));
      throw new Error("response lost");
    }
    return null;
  });
  await checkout(w);
  await until(
    () => !w.document.querySelector('[data-action="submit-order"]').disabled,
  );
  const submit = w.document.querySelector('[data-action="submit-order"]');
  submit.click();
  submit.click();
  await new Promise((r) => setTimeout(r, 200));
  const posts = calls.filter(
    (c) => c.url === "/api/orders" && c.options.method === "POST",
  );
  assert.equal(posts.length, 1);
  assert.equal(
    new Set(posts.map((p) => p.options.headers["Idempotency-Key"])).size,
    1,
  );
});

test("A7 authentication failure preserves unresolved key without exposing another owner", async (t) => {
  let sent = 0;
  const { w } = await page(t, "index", async (url, o) => {
    if (url === "/api/orders" && o.method === "POST") {
      if (++sent === 1) throw new Error("lost");
      return {
        ok: false,
        status: 401,
        json: async () => ({
          error: "AUTH_EXPIRED",
          message: "Обновите Telegram",
        }),
      };
    }
    return null;
  });
  await checkout(w);
  click(w, '[data-action="submit-order"]');
  await until(() =>
    w.document
      .querySelector("#submitError")
      ?.textContent.includes("без создания второго"),
  );
  const pending = w.sessionStorage.getItem("deliBerry.pending.v2"),
    cart = w.sessionStorage.getItem("deliBerry.cart.v2");
  click(w, '[data-action="submit-order"]');
  await until(() => sent === 2);
  await settle();
  assert.equal(w.sessionStorage.getItem("deliBerry.pending.v2"), pending);
  const saved = { "deliBerry.pending.v2": pending, "deliBerry.cart.v2": cart };
  const unavailable = await page(
    t,
    "index",
    (url) =>
      url === "/api/me" ? Promise.reject(new Error("auth unavailable")) : null,
    true,
    "",
    saved,
  );
  assert.equal(
    unavailable.w.sessionStorage.getItem("deliBerry.pending.v2"),
    pending,
  );
  assert.equal(unavailable.w.document.querySelector("#customerPhone"), null);
  await add(unavailable.w);
  click(unavailable.w, '[data-action="to-cart"]');
  click(unavailable.w, '[data-action="checkout"]');
  assert.equal(unavailable.w.document.querySelector("#customerPhone"), null);
  assert.equal(
    unavailable.w.document.querySelector('[data-action="submit-order"]'),
    null,
  );
  assert.equal(
    unavailable.calls.filter(
      (c) => c.url === "/api/orders" && c.options.method === "POST",
    ).length,
    0,
  );
  assert.equal(
    unavailable.w.sessionStorage.getItem("deliBerry.pending.v2"),
    pending,
  );
  assert.equal(unavailable.w.sessionStorage.getItem("deliBerry.cart.v2"), cart);
  const other = await page(
    t,
    "index",
    (url) =>
      url === "/api/me"
        ? { ok: true, json: async () => ({ id: 101, operator: false }) }
        : null,
    true,
    "",
    saved,
  );
  assert.equal(other.w.sessionStorage.getItem("deliBerry.pending.v2"), null);
});

test("A7 reauthenticated owner recovers original cart/body/key even after price update", async (t) => {
  const old = await page(t, "index", (url, o) =>
    url === "/api/orders" && o.method === "POST"
      ? Promise.reject(new Error("lost"))
      : null,
  );
  await checkout(old.w);
  click(old.w, '[data-action="submit-order"]');
  await until(() =>
    old.w.document
      .querySelector("#submitError")
      ?.textContent.includes("без создания второго"),
  );
  const pending = old.w.sessionStorage.getItem("deliBerry.pending.v2"),
    original = JSON.parse(pending);
  const restored = await page(
    t,
    "index",
    (url, o) =>
      url === "/api/orders" && o.method === "POST"
        ? Promise.reject(new Error("lost again"))
        : url === "/api/quote"
          ? Promise.reject(new Error("new price unavailable"))
          : null,
    true,
    "",
    { "deliBerry.pending.v2": pending },
  );
  await until(
    () =>
      restored.w.document.querySelector('[data-action="submit-order"]') &&
      !restored.w.document.querySelector('[data-action="submit-order"]')
        .disabled,
  );
  assert.equal(
    restored.w.document.querySelector("#customerPhone").value,
    "+79990000000",
  );
  assert.equal(restored.w.document.querySelectorAll(".cart-line").length, 1);
  click(restored.w, '[data-action="submit-order"]');
  await until(() =>
    restored.calls.some(
      (c) => c.url === "/api/orders" && c.options.method === "POST",
    ),
  );
  const sent = restored.calls.find(
    (c) => c.url === "/api/orders" && c.options.method === "POST",
  );
  assert.equal(sent.options.headers["Idempotency-Key"], original.key);
  assert.deepEqual(JSON.parse(sent.options.body), original.body);
});
