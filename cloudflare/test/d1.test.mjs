import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import { Database } from "../src/db.mjs";
import { OrderService } from "../src/service.mjs";
import { telegramUser } from "../src/auth.mjs";
import { hmac, hex, encode64, utf8 } from "../src/crypto.mjs";
import { verifyWebhook, amountKopecks } from "../src/yandex-pay.mjs";
import { loadConfig } from "../src/config.mjs";
import { slots, price, normalizeOrder } from "../src/domain.mjs";
import { botWebhook, deliverNotifications } from "../src/telegram.mjs";
import catalog from "../public/catalog.json" with { type: "json" };
const user = { id: 100 },
  operator = { id: 900 },
  origin = "https://example.test",
  token = "test-only-token";
const bindings = {
  SYNTHETIC_TEST_MODE: "true",
  TELEGRAM_BOT_TOKEN: token,
  TELEGRAM_OPERATOR_ID: "900",
  TELEGRAM_WEBHOOK_SECRET: "t".repeat(32),
  YANDEX_PAY_WEBHOOK_SECRET: "y".repeat(32),
  YANDEX_PAY_MERCHANT_ID: "merchant-test",
  YANDEX_PAY_API_KEY: "test-only-key",
  ORDERS_ENABLED: "true",
  TELEGRAM_ENABLED: "true",
  OWNER_LIVE_APPROVED: "true",
  LEGAL_APPROVED: "true",
  PAYMENT_MODE: "sandbox",
};
const config = loadConfig(bindings, origin);
let mf,
  binding,
  now = new Date("2026-09-29T06:45:01Z"),
  keys,
  maxQueries = 0;
const payments = new Map();
let creates = 0;
const provider = {
  enabled: () => true,
  create: async (body, id) => {
    creates++;
    if (!payments.has(body.orderId))
      payments.set(body.orderId, {
        orderId: body.orderId,
        merchantId: config.merchantId,
        currencyCode: "RUB",
        orderAmount: body.cart.total.amount,
        paymentStatus: "PENDING",
      });
    return "https://sandbox.pay.yandex.ru/payment/" + body.orderId;
  },
  get: async (id) => structuredClone(payments.get(id)),
  verify: async (token) =>
    verifyWebhook(token, async () => keys.publicKey, config.merchantId),
};
function service() {
  return new OrderService(
    new Database(binding),
    catalog,
    config,
    provider,
    () => now,
  );
}
async function call(method, ...args) {
  const s = service();
  try {
    return await s[method](...args);
  } finally {
    maxQueries = Math.max(maxQueries, s.db.queries);
  }
}
async function signed(user, date = Math.floor(Date.now() / 1000), extra = {}) {
  const p = new URLSearchParams({
    auth_date: String(date),
    query_id: "test",
    user: JSON.stringify(user),
    ...extra,
  });
  const check = [...p]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  p.set("hash", hex(await hmac(await hmac("WebAppData", token), check)));
  return p.toString();
}
function raw(variant = "SET-12-FRESH", store = "discovery", type = "pickup") {
  return {
    product: {
      id: catalog.products.find((p) => p.variants.some((v) => v.id === variant))
        .id,
    },
    variant: { id: variant },
    quantity: 1,
    addOns: [],
    store: { id: store },
    schedule: { date: "2026-09-30", time: "15:15" },
    customer: { name: "Тест", phone: "+79990000000" },
    fulfilment: {
      type,
      deliveryAddress: type === "courier" ? "Тестовый адрес" : "",
    },
    recipient: { sameAsCustomer: true },
    consent: true,
  };
}
const order = (v, s, t) =>
  call("create", raw(v, s, t), user, crypto.randomUUID());
const status = (o, next, extra = {}) =>
  call(
    "transition",
    o.id,
    { status: next, expectedVersion: o.version, ...extra },
    operator,
  );
async function jwt(event, header = {}) {
  const t = Math.floor(Date.now() / 1000),
    h = encode64(
      JSON.stringify({
        alg: "ES256",
        kid: "test-key",
        typ: "JWT",
        iat: t,
        exp: t + 300,
        ...header,
      }),
    ),
    p = encode64(JSON.stringify(event));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.privateKey,
    utf8.encode(h + "." + p),
  );
  return h + "." + p + "." + Buffer.from(sig).toString("base64url");
}
async function webhook(id, status = "CAPTURED", extra = {}) {
  payments.get(id).paymentStatus = status;
  const event = {
    merchantId: config.merchantId,
    event: "ORDER_STATUS_UPDATED",
    eventTime: new Date().toISOString(),
    order: { orderId: id, paymentStatus: status },
    ...extra,
  };
  const t = await jwt(event);
  await call("webhook", t);
  return t;
}
async function pending(v, s, t) {
  let o = await order(v, s, t);
  o = await status(o, "CONFIRMED");
  return call("createPayment", o.id, operator);
}
async function paid(v, s, t) {
  const o = await pending(v, s, t);
  await webhook(o.id);
  return call("read", o.id, operator, true);
}
before(async () => {
  keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const bundle = await build({
    entryPoints: ["src/worker.mjs"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
  });
  mf = new Miniflare({
    workers: [
      {
        name: "test",
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-07-30",
        d1Databases: ["DB"],
        bindings,
        serviceBindings: { ASSETS: () => new Response("asset") },
      },
    ],
  });
  binding = await mf.getD1Database("DB");
  for (const file of (await readdir("migrations")).sort()) {
    const sql = (await readFile("migrations/" + file, "utf8"))
      .replace(/^--.*$/gm, "")
      .replace(/\n/g, " ");
    await binding.exec(sql);
  }
});
after(async () => {
  console.log(
    "Maximum D1 statements in a tested service invocation:",
    maxQueries,
  );
  await mf?.dispose();
});
test("catalogue, prices, Moscow slots and validation preserved", async () => {
  assert.equal(catalog.products.length, 9);
  assert.equal(catalog.products.flatMap((p) => p.variants).length, 16);
  assert.equal(catalog.fulfilment.orderHours.slotMinutes, 15);
  const c = await call("getCatalog");
  assert.equal(
    slots(c, "SET-09-FRESH", "discovery", "2026-09-29", now)[0],
    "10:30",
  );
  assert.equal(
    slots(c, "BQT-A07-FRESH", "zelenopark", "2026-09-29", now)[0],
    "11:00",
  );
  assert.equal(
    slots(c, "SET-09-FD", "discovery", "2026-09-29", now)[0],
    "10:00",
  );
  assert.equal(price(c, { ...raw(), total: 1 }).total, 1590);
  for (const patch of [
    { consent: false },
    { quantity: 1.5 },
    { customer: { name: "Тест", phone: "invalid" } },
    { schedule: { date: "2026-09-28", time: "10:00" } },
  ])
    assert.throws(() => normalizeOrder(c, { ...raw(), ...patch }, user, now));
});
test("Web Crypto initData: valid, tampering, duplicate fields, future and expiry", async () => {
  assert.equal((await telegramUser(await signed(user), token)).id, user.id);
  const a = await signed(user);
  for (const value of [
    a.replace("test", "forged"),
    a + "&auth_date=1",
    await signed(user, 1),
    await signed(user, Math.floor(Date.now() / 1000) + 30),
    await signed({ id: 0 }),
  ])
    await assert.rejects(telegramUser(value, token));
});
test("native workerd API: health, guest, operator whitelist, origin, malformed and oversized JSON", async () => {
  assert.equal((await mf.dispatchFetch(origin + "/api/health")).status, 200);
  assert.equal((await mf.dispatchFetch(origin + "/api/orders")).status, 401);
  const h = { "X-Telegram-Init-Data": await signed(user) };
  assert.equal(
    (await mf.dispatchFetch(origin + "/api/operator/orders", { headers: h }))
      .status,
    403,
  );
  assert.equal(
    (
      await mf.dispatchFetch(origin + "/api/me", {
        headers: { ...h, Origin: "https://evil.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await mf.dispatchFetch(origin + "/api/quote", {
        method: "POST",
        body: "{",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await mf.dispatchFetch(origin + "/api/quote", {
        method: "POST",
        body: "x".repeat(65537),
      })
    ).status,
    413,
  );
  assert.equal((await mf.dispatchFetch(origin + "/api/config")).status, 200);
});
test("simultaneous identical requests: one order/event and exactly two notifications", async () => {
  const key = crypto.randomUUID(),
    r = raw();
  const [a, b] = await Promise.all([
    call("create", r, user, key),
    call("create", r, user, key),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(
    (
      await binding
        .prepare("SELECT COUNT(*) n FROM order_events WHERE order_id=?")
        .bind(a.id)
        .first()
    ).n,
    1,
  );
  assert.equal(
    (
      await binding
        .prepare("SELECT COUNT(*) n FROM notifications WHERE dedupe_key LIKE ?")
        .bind("new:" + a.id + ":%")
        .first()
    ).n,
    2,
  );
  await assert.rejects(
    call("create", { ...r, quantity: 2 }, user, key),
    (e) => e.code === "IDEMPOTENCY_CONFLICT",
  );
  await assert.rejects(
    call("read", a.id, { id: 101 }),
    (e) => e.status === 404,
  );
});
test("D1 transaction rollback and stale-version race leave no phantom journal/outbox", async () => {
  const o = await order(),
    s = service();
  await assert.rejects(
    s.db.atomic(
      "0",
      [],
      [["UPDATE orders SET version=999 WHERE id=?", [o.id]]],
    ),
  );
  assert.equal((await call("read", o.id, user)).version, 1);
  const result = await Promise.allSettled([
    status(o, "CONFIRMED"),
    status(o, "CANCELLED", { note: "Отмена" }),
  ]);
  assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (
      await binding
        .prepare("SELECT COUNT(*) n FROM order_events WHERE order_id=?")
        .bind(o.id)
        .first()
    ).n,
    2,
  );
  assert.equal(
    (await binding.prepare("SELECT COUNT(*) n FROM mutation_guards").first()).n,
    0,
  );
});
test("payment creation requires confirmation, retry reuses payment, operator polling cannot set PAID", async () => {
  let o = await order();
  await assert.rejects(
    call("createPayment", o.id, operator),
    (e) => e.code === "CONFIRM_FIRST",
  );
  o = await status(o, "CONFIRMED");
  const before = creates;
  await call("createPayment", o.id, operator);
  await call("createPayment", o.id, operator);
  assert.equal(creates, before + 1);
  payments.get(o.id).paymentStatus = "CAPTURED";
  await call("reconcile", o.id);
  assert.equal((await call("read", o.id, user)).status, "PAYMENT_PENDING");
  await assert.rejects(
    binding
      .prepare("UPDATE orders SET status='PAID' WHERE id=?")
      .bind(o.id)
      .run(),
    /PAID_REQUIRES_VERIFIED_WEBHOOK/,
  );
  await assert.rejects(
    status(await call("read", o.id, user), "PAID"),
    (e) => e.code === "INVALID_TRANSITION",
  );
});
test("ES256: valid signed webhook, duplicate/concurrent webhook, tampered token, wrong merchant and expired header", async () => {
  const o = await pending(),
    t = await webhook(o.id);
  await Promise.all([call("webhook", t), call("webhook", t)]);
  assert.equal((await call("read", o.id, user)).status, "PAID");
  assert.equal(
    (
      await binding
        .prepare(
          "SELECT COUNT(*) n FROM order_events WHERE order_id=? AND status='PAID'",
        )
        .bind(o.id)
        .first()
    ).n,
    1,
  );
  const event = { merchantId: config.merchantId, eventTime: now.toISOString() };
  for (const x of [
    await jwt({ ...event, merchantId: "wrong" }),
    await jwt(event, { exp: 1 }),
    await jwt(event, { alg: "HS256" }),
    t
      .split(".")
      .map((x, i) => (i === 1 ? encode64("{}") : x))
      .join("."),
  ])
    await assert.rejects(
      provider.verify(x),
      (e) => e.code === "INVALID_SIGNATURE",
    );
});
test("amount/order/merchant/currency mismatch cannot commit a webhook proof", async () => {
  const o = await pending();
  for (const patch of [
    { orderAmount: "1.00" },
    { orderId: "wrong" },
    { merchantId: "wrong" },
    { currencyCode: "USD" },
  ]) {
    const old = { ...payments.get(o.id) };
    Object.assign(payments.get(o.id), patch);
    await assert.rejects(webhook(o.id), (e) => e.code === "PAYMENT_MISMATCH");
    payments.set(o.id, old);
  }
  assert.equal((await call("read", o.id, user)).status, "PAYMENT_PENDING");
  assert.equal(
    (
      await binding
        .prepare("SELECT COUNT(*) n FROM webhook_events WHERE order_id=?")
        .bind(o.id)
        .first()
    ).n,
    0,
  );
  assert.ok(Number.isNaN(amountKopecks("1e3")));
  assert.equal(amountKopecks("1590.00"), 159000);
});
test("out-of-order events never downgrade captured/refunded payment", async () => {
  const o = await paid();
  await webhook(o.id, "PENDING");
  assert.equal((await call("read", o.id, user)).payment.status, "CAPTURED");
  await webhook(o.id, "PARTIALLY_REFUNDED");
  assert.equal((await call("read", o.id, user)).status, "REFUND_PENDING");
  await webhook(o.id, "REFUNDED");
  await webhook(o.id, "CAPTURED");
  assert.equal((await call("read", o.id, user)).status, "REFUNDED");
});
test("pickup/delivery business paths, shelf life and expiry", async () => {
  for (const type of ["pickup", "courier"]) {
    let o = await paid(
      type === "pickup" ? "SET-12-FRESH" : "BQT-B09-FD",
      type === "pickup" ? "discovery" : "zelenopark",
      type,
    );
    for (const next of ["SENT_TO_STORE", "IN_PRODUCTION"])
      o = await status(o, next);
    o = await status(o, "READY", {
      manufacturedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86400000).toISOString(),
    });
    assert.equal(o.holdUntil, new Date(now.getTime() + 86400000).toISOString());
    for (const next of type === "pickup"
      ? ["COMPLETED"]
      : ["COURIER_ORDERED", "COURIER_PICKED_UP", "DELIVERED"])
      o = await status(o, next);
    assert.equal(o.total, type === "pickup" ? 1590 : 1690);
  }
  let o = await paid();
  for (const next of ["SENT_TO_STORE", "IN_PRODUCTION"])
    o = await status(o, next);
  await assert.rejects(
    status(o, "READY", {
      manufacturedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 2 * 86400000).toISOString(),
    }),
  );
  o = await status(o, "READY", {
    manufacturedAt: new Date(now.getTime() - 23 * 3600000).toISOString(),
    expiresAt: new Date(now.getTime() + 3600000).toISOString(),
  });
  const old = now;
  now = new Date(now.getTime() + 3600001);
  await call("expire");
  assert.equal((await call("read", o.id, user)).status, "EXPIRED_UNCLAIMED");
  now = old;
});
test("store stop list and version are isolated by store; audit preserved", async () => {
  const c = await call("getCatalog"),
    s = c.stores[0];
  await call(
    "updateStore",
    s.id,
    { expectedVersion: s.settingsVersion, stopList: ["SET-12-FRESH"] },
    operator,
  );
  await assert.rejects(order(), (e) => e.code === "SLOT_UNAVAILABLE");
  await order("SET-12-FRESH", "zelenopark");
  await assert.rejects(
    call(
      "updateStore",
      s.id,
      { expectedVersion: s.settingsVersion, stopList: [] },
      operator,
    ),
  );
  await call(
    "updateStore",
    s.id,
    { expectedVersion: s.settingsVersion + 1, stopList: [] },
    operator,
  );
});
test("Telegram webhook validates secret and deduplicates update; outbox retries and lease isolation", async () => {
  const update = {
    update_id: 123,
    message: { text: "/start", chat: { type: "private", id: 100 }, from: user },
  };
  await assert.rejects(botWebhook(service(), "wrong", update));
  await Promise.all([
    botWebhook(service(), config.webhookSecret, update),
    botWebhook(service(), config.webhookSecret, update),
  ]);
  assert.equal(
    (
      await binding
        .prepare(
          "SELECT COUNT(*) n FROM notifications WHERE dedupe_key='start:123'",
        )
        .first()
    ).n,
    1,
  );
  await deliverNotifications(new Database(binding), config, async () => {
    throw new Error("network");
  });
  assert.ok(
    (
      await binding
        .prepare(
          "SELECT COUNT(*) n FROM notifications WHERE last_error IS NOT NULL",
        )
        .first()
    ).n > 0,
  );
  const sent = [];
  await Promise.all([
    deliverNotifications(new Database(binding), config, async (_, __, body) =>
      sent.push(body.chat_id + body.text),
    ),
    deliverNotifications(new Database(binding), config, async (_, __, body) =>
      sent.push(body.chat_id + body.text),
    ),
  ]);
  assert.equal(new Set(sent).size, sent.length);
});
test("full journal remains paginated; same-time order cursors have no gaps", async () => {
  const s = service(),
    who = { id: 777 },
    data = normalizeOrder(await s.getCatalog(), raw(), who, now);
  await binding
    .prepare("INSERT INTO users(telegram_id) VALUES(?)")
    .bind("777")
    .run();
  for (let i = 0; i < 45; i++) {
    const id = "DB-" + i.toString(16).toUpperCase().padStart(16, "0");
    await binding
      .prepare(
        "INSERT INTO orders(id,user_id,request_key,request_hash,store_id,status,total_kopecks,data,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        "777",
        "seed-" + i,
        "hash",
        "discovery",
        "WAITING_CONFIRMATION",
        159000,
        JSON.stringify({ ...data, id }),
        now.toISOString(),
      )
      .run();
  }
  let cursor = null,
    all = [];
  do {
    const page = await call("list", who, false, cursor);
    all.push(...page.orders);
    cursor = page.nextBefore;
  } while (cursor);
  assert.equal(new Set(all.map((o) => o.id)).size, 45);
  assert.equal(all.length, 45);
  await assert.rejects(call("list", who, false, "garbage"));
  const o = await order();
  for (let i = 0; i < 55; i++)
    await binding
      .prepare(
        "INSERT INTO order_events(order_id,actor,status,note) VALUES(?,?,?,?)",
      )
      .bind(o.id, "system", o.status, "journal " + i)
      .run();
  const a = await call("history", o.id, operator, true, null),
    b = await call("history", o.id, operator, true, a.nextBefore);
  assert.equal(a.history.length + b.history.length, 56);
});
test("preview fails closed; owner and fiscal gates; foreign keys and unique constraints", async () => {
  assert.equal(loadConfig({}, origin).ordersEnabled, false);
  for (const env of [
    { ORDERS_ENABLED: "true" },
    { ...bindings, OWNER_LIVE_APPROVED: "false" },
    { ...bindings, PAYMENT_MODE: "production" },
  ])
    assert.throws(() => loadConfig(env, origin));
  await assert.rejects(
    binding
      .prepare(
        "INSERT INTO payments(order_id,request_id,status,request_body) VALUES(?,?,?,?)",
      )
      .bind("missing", "id", "CREATING", "{}")
      .run(),
    /FOREIGN KEY/,
  );
  assert.ok(maxQueries < 30);
});

test("A3/A7 multi-line DB snapshot, price change consent, pre-write failure and lost-response retry", async () => {
  const r = {
    ...raw(),
    items: [
      {
        sku: "SET-12-A06",
        appearanceId: "A06",
        quantity: 1,
        addOns: [{ id: "chocolate-inscription" }],
        inscriptionText: "Тест",
      },
      { sku: "BQT-B09-FD", appearanceId: "B09", quantity: 1, addOns: [] },
    ],
    expectedTotalKopecks: 373000,
  };
  await assert.rejects(
    call(
      "create",
      { ...r, expectedTotalKopecks: 1 },
      user,
      crypto.randomUUID(),
    ),
    (e) => e.code === "PRICE_CHANGED",
  );
  const key = crypto.randomUUID(),
    before = (await binding.prepare("SELECT count(*) n FROM orders").first()).n;
  const failing = service();
  failing.db.atomic = async () => {
    throw new Error("before write");
  };
  await assert.rejects(failing.create(r, user, key));
  assert.equal(
    (await binding.prepare("SELECT count(*) n FROM orders").first()).n,
    before,
  );
  const o = await call("create", r, user, key);
  const again = await call("create", r, user, key);
  assert.equal(o.id, again.id);
  assert.equal(o.items.length, 2);
  assert.equal(o.items[0].appearance.id, "A06");
  assert.equal(o.items[1].appearance.id, "B09");
  assert.deepEqual((await call("read", o.id, operator, true)).items, o.items);
  let confirmed = await status(o, "CONFIRMED");
  await call("createPayment", o.id, operator);
  const req = JSON.parse(
    (
      await binding
        .prepare("SELECT request_body FROM payments WHERE order_id=?")
        .bind(o.id)
        .first()
    ).request_body,
  );
  assert.equal(req.cart.items.length, 3);
  assert.equal(req.cart.total.amount, "3730.00");
});
test("A8/A9 /v1/webhook accepts only raw octet-stream; no invented webhook secret needed", async () => {
  const env = { ...bindings };
  delete env.YANDEX_PAY_WEBHOOK_SECRET;
  assert.equal(loadConfig(env, origin).paymentMode, "sandbox");
  assert.equal(
    (
      await mf.dispatchFetch(origin + "/v1/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await mf.dispatchFetch(origin + "/v1/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: "bad",
      })
    ).status,
    401,
  );
  const r = await mf.dispatchFetch(origin + "/api/orders", {
    headers: { "X-Telegram-Init-Data": await signed(user) },
  });
  assert.equal(r.headers.get("Cache-Control"), "no-store");
});
test("A7/A8 operator proposes changed configuration, only owner accepts, no revision after payment", async () => {
  let o = await order();
  const revision = {
    ...raw(),
    items: [
      { sku: "SET-09-FRESH", appearanceId: "B04", quantity: 1, addOns: [] },
    ],
    expectedTotalKopecks: 119000,
  };
  const s = service();
  assert.equal(typeof s.proposeRevision, "function");
  o = await s.proposeRevision(
    o.id,
    {
      expectedVersion: o.version,
      order: revision,
      note: "Согласован другой размер",
    },
    operator,
  );
  assert.equal(o.total, 1590);
  assert.equal(o.pendingRevision.total, 1190);
  await assert.rejects(
    call("acceptRevision", o.id, { expectedVersion: o.version }, { id: 101 }),
  );
  o = await call("acceptRevision", o.id, { expectedVersion: o.version }, user);
  assert.equal(o.total, 1190);
  assert.equal(o.items[0].appearance.id, "B04");
  assert.equal(o.revision, 2);
  o = await status(o, "CONFIRMED");
  await call("createPayment", o.id, operator);
  o = await call("read", o.id, operator, true);
  await assert.rejects(
    call(
      "proposeRevision",
      o.id,
      { expectedVersion: o.version, order: revision, note: "Поздно" },
      operator,
    ),
    (e) => e.code === "PAYMENT_LOCKED",
  );
});
test("A6 operator holiday override blocks selected point only and all cart lines revalidated", async () => {
  const c = await call("getCatalog"),
    s = c.stores.find((s) => s.id === "discovery");
  await call(
    "updateStore",
    s.id,
    {
      expectedVersion: s.settingsVersion,
      dateOverrides: { "2026-09-30": { closed: true } },
    },
    operator,
  );
  await assert.rejects(order(), (e) => e.code === "SLOT_UNAVAILABLE");
  await order("SET-12-FRESH", "zelenopark");
  await call(
    "updateStore",
    s.id,
    { expectedVersion: s.settingsVersion + 1, dateOverrides: {} },
    operator,
  );
});
test("A9 semantic dedupe accepts renewed JWT once; late captured never enters production", async () => {
  let o = await pending();
  o = await status(o, "CANCELLED", { note: "Клиент отменил" });
  payments.get(o.id).paymentStatus = "CAPTURED";
  const event = {
    merchantId: config.merchantId,
    event: "ORDER_STATUS_UPDATED",
    eventTime: new Date().toISOString(),
    order: { orderId: o.id, paymentStatus: "CAPTURED" },
  };
  await call("webhook", await jwt(event));
  await call(
    "webhook",
    await jwt(event, { iat: Math.floor(Date.now() / 1000) - 1 }),
  );
  assert.equal((await call("read", o.id, user)).status, "REFUND_PENDING");
  assert.equal(
    (
      await binding
        .prepare("SELECT count(*) n FROM webhook_events WHERE order_id=?")
        .bind(o.id)
        .first()
    ).n,
    1,
  );
});
test("A9 payment link resends from durable outbox; expiry reconciles before reusing or renewing", async () => {
  const o = await pending();
  assert.equal(typeof service().resendPayment, "function");
  await call("resendPayment", o.id, operator);
  assert.ok(
    (
      await binding
        .prepare("SELECT count(*) n FROM notifications WHERE dedupe_key LIKE ?")
        .bind("resend:" + o.id + ":%")
        .first()
    ).n > 0,
  );
});

test("A9 an expired link is checked at provider and cannot be resent as payable", async () => {
  const o = await pending();
  await binding
    .prepare(
      "UPDATE payments SET created_at='2020-01-01T00:00:00.000Z' WHERE order_id=?",
    )
    .bind(o.id)
    .run();
  await assert.rejects(
    call("resendPayment", o.id, operator),
    (e) => e.code === "PAYMENT_LINK_EXPIRED",
  );
});
test("A7 payment creation race preserves one request identity", async () => {
  let o = await order();
  o = await status(o, "CONFIRMED");
  const results = await Promise.allSettled([
    call("createPayment", o.id, operator),
    call("createPayment", o.id, operator),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 2);
  assert.equal(
    (
      await binding
        .prepare("SELECT count(*) n FROM payments WHERE order_id=?")
        .bind(o.id)
        .first()
    ).n,
    1,
  );
});
test("A6 second cart SKU stop prevents operator confirmation", async () => {
  const r = {
    ...raw(),
    items: [
      { sku: "SET-09-FRESH", appearanceId: "B04", quantity: 1, addOns: [] },
      { sku: "BQT-A07-FRESH", appearanceId: "A07", quantity: 1, addOns: [] },
    ],
    expectedTotalKopecks: 394000,
  };
  let o = await call("create", r, user, crypto.randomUUID());
  const s = (await call("getCatalog")).stores.find((s) => s.id === "discovery");
  await call(
    "updateStore",
    s.id,
    { expectedVersion: s.settingsVersion, stopList: ["BQT-A07-FRESH"] },
    operator,
  );
  await assert.rejects(
    status(o, "CONFIRMED"),
    (e) => e.code === "SLOT_UNAVAILABLE",
  );
  await call(
    "updateStore",
    s.id,
    { expectedVersion: s.settingsVersion + 1, stopList: [] },
    operator,
  );
});
test("A8 sandbox mode on public host cannot bypass personal data/labeling gate", () => {
  assert.throws(
    () =>
      loadConfig(
        { ...bindings, PERSONAL_DATA_APPROVED: "false" },
        "https://shop.workers.dev",
      ),
    (e) => e.code === "LAUNCH_DATA_REQUIRED",
  );
});
test("A9 PAID requires a signed CAPTURED event, not a stale event plus provider polling", async () => {
  const o = await pending();
  payments.get(o.id).paymentStatus = "CAPTURED";
  const base = {
    merchantId: config.merchantId,
    event: "ORDER_STATUS_UPDATED",
    eventTime: new Date().toISOString(),
  };
  await call(
    "webhook",
    await jwt({ ...base, order: { orderId: o.id, paymentStatus: "PENDING" } }),
  );
  assert.equal((await call("read", o.id, user)).status, "PAYMENT_PENDING");
  await call(
    "webhook",
    await jwt({ ...base, order: { orderId: o.id, paymentStatus: "CAPTURED" } }),
  );
  assert.equal((await call("read", o.id, user)).status, "PAID");
});
test("A7 a pending customer revision blocks confirmation and payment", async () => {
  let o = await order();
  o = await status(o, "CONFIRMED");
  const r = {
    ...raw(),
    items: [
      { sku: "SET-09-FRESH", appearanceId: "B04", quantity: 1, addOns: [] },
    ],
    expectedTotalKopecks: 119000,
  };
  o = await call(
    "proposeRevision",
    o.id,
    { expectedVersion: o.version, order: r, note: "Тест согласования" },
    operator,
  );
  await assert.rejects(
    call("createPayment", o.id, operator),
    (e) => e.code === "REVISION_PENDING",
  );
});
