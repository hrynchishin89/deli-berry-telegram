import catalog from "../public/catalog.json";
import { Database } from "./db.mjs";
import { loadConfig } from "./config.mjs";
import { OrderService } from "./service.mjs";
import { YandexPay } from "./yandex-pay.mjs";
import { telegramUser, isOperator, requireOperator } from "./auth.mjs";
import { botWebhook, deliverNotifications } from "./telegram.mjs";
import {
  AppError,
  fail,
  price,
  priceCart,
  slots,
  cartSlots,
} from "./domain.mjs";
import { sha256, secureEqual } from "./crypto.mjs";
export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
};
const json = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: { ...securityHeaders, "Cache-Control": "no-store" },
  });
export async function body(req, raw = false) {
  if (Number(req.headers.get("Content-Length") || 0) > 65536)
    fail(413, "BODY_TOO_LARGE", "Слишком большой запрос.");
  const reader = req.body?.getReader();
  let size = 0,
    value = "",
    decoder = new TextDecoder();
  if (reader)
    try {
      while (true) {
        const { value: part, done } = await reader.read();
        if (done) break;
        size += part.byteLength;
        if (size > 65536) {
          await reader.cancel();
          fail(413, "BODY_TOO_LARGE", "Слишком большой запрос.");
        }
        value += decoder.decode(part, { stream: true });
      }
      value += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  if (raw) return value;
  try {
    const v = JSON.parse(value);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw 0;
    return v;
  } catch {
    fail(400, "INVALID_JSON", "Некорректный запрос.");
  }
}
async function limit(db, key, max) {
  const bucket = Math.floor(Date.now() / 60000),
    hash = await sha256(key + ":" + bucket);
  const row = await db.first(
    "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    [hash, new Date((bucket + 2) * 60000).toISOString()],
  );
  if (row.count > max)
    fail(429, "RATE_LIMIT", "Слишком много запросов. Попробуйте через минуту.");
}
export async function handle(request, env) {
  const url = new URL(request.url),
    p = url.pathname,
    method = request.method;
  if (!p.startsWith("/api/") && p !== "/v1/webhook")
    return env.ASSETS.fetch(request);
  const config = loadConfig(env, url.origin),
    db = new Database(env.DB),
    provider = new YandexPay(config),
    service = new OrderService(db, catalog, config, provider);
  if (
    request.headers.has("Origin") &&
    request.headers.get("Origin") !== url.origin
  )
    fail(403, "ORIGIN_REJECTED", "Недопустимый источник запроса.");
  if (p === "/api/health" && method === "GET") {
    await db.first("SELECT id FROM stores LIMIT 1");
    return json({
      status: "ok",
      platform: "cloudflare-workers-d1",
      liveEnabled: config.ordersEnabled,
      version: "2.0.0",
      commit: env.BUILD_COMMIT || "local-unpublished",
    });
  }
  if (p === "/api/config" && method === "GET")
    return json({
      paymentEnabled: provider.enabled(),
      paymentMode: config.paymentMode,
      termsUrl: config.termsUrl,
      privacyUrl: config.privacyUrl,
      ordersEnabled: config.ordersEnabled,
      dataCollectionEnabled: config.ordersEnabled,
      environment: config.synthetic
        ? "synthetic"
        : config.ordersEnabled
          ? "production"
          : "preview",
    });
  if (p === "/api/catalog" && method === "GET")
    return json(await service.getCatalog());
  if (p === "/api/slots" && method === "GET")
    return json({
      slots: cartSlots(
        await service.getCatalog(),
        (
          url.searchParams.get("variants") ||
          url.searchParams.get("variant") ||
          ""
        )
          .split(",")
          .map((sku) => ({ sku })),
        url.searchParams.get("store"),
        url.searchParams.get("date"),
      ),
      timeZone: "Europe/Moscow",
    });
  if (p === "/api/quote" && method === "POST") {
    const raw = await body(request);
    if (raw.items) return json(priceCart(catalog, raw));
    const q = price(catalog, raw);
    return json({
      total: q.total,
      quantity: q.quantity,
      unitPrice: q.variant.price,
      addOns: q.addOns,
    });
  }
  if (p === "/v1/webhook" && method === "POST") {
    if (!provider.enabled())
      fail(503, "PAYMENT_NOT_CONFIGURED", "Оплата ещё не подключена.");
    if (
      (request.headers.get("Content-Type") || "").split(";")[0].trim() !==
      "application/octet-stream"
    )
      fail(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Ожидается application/octet-stream.",
      );
    await service.webhook(await body(request, true));
    return json({ status: "success" });
  }
  if (p === "/api/telegram/webhook" && method === "POST") {
    await botWebhook(
      service,
      request.headers.get("X-Telegram-Bot-Api-Secret-Token"),
      await body(request),
    );
    return json({ ok: true });
  }
  const user = await telegramUser(
    request.headers.get("X-Telegram-Init-Data") || "",
    config.botToken,
    config.authMaxAge,
  );
  await limit(
    db,
    "ip:" + (request.headers.get("CF-Connecting-IP") || "local"),
    600,
  );
  await limit(db, "user:" + user.id, 120);
  if (p === "/api/me" && method === "GET")
    return json({ id: user.id, operator: isOperator(user, config) });
  if (p.startsWith("/api/operator/")) requireOperator(user, config);
  if (["POST", "PATCH", "DELETE"].includes(method) && !config.ordersEnabled)
    fail(503, "ORDERS_DISABLED", "Приём заказов пока не включён.");
  if (p === "/api/orders" && method === "POST") {
    await limit(db, "new-order:" + user.id, 10);
    return json(
      {
        order: await service.create(
          await body(request),
          user,
          request.headers.get("Idempotency-Key"),
        ),
      },
      201,
    );
  }
  if (p === "/api/orders" && method === "GET")
    return json(
      await service.list(user, false, url.searchParams.get("before")),
    );
  if (p === "/api/operator/orders" && method === "GET")
    return json(await service.list(user, true, url.searchParams.get("before")));
  if (p === "/api/operator/notifications" && method === "GET")
    return json({
      notifications: await db.all(
        "SELECT id,attempts,last_error,failed_at FROM notifications WHERE delivered_at IS NULL ORDER BY id DESC LIMIT 100",
      ),
    });
  const own = p.match(
    /^\/api\/orders\/(DB-[A-F0-9]{16})(?:\/(history|revision))?$/,
  );
  if (own && method === "POST" && own[2] === "revision")
    return json({
      order: await service.acceptRevision(own[1], await body(request), user),
    });
  if (own && method === "GET" && own[2] !== "revision")
    return json(
      own[2]
        ? await service.history(
            own[1],
            user,
            false,
            url.searchParams.get("before"),
          )
        : { order: await service.read(own[1], user) },
    );
  const op = p.match(
    /^\/api\/operator\/orders\/(DB-[A-F0-9]{16})(?:\/(status|note|payment|resend-payment|revision|sync-payment|history))?$/,
  );
  if (op) {
    if (method === "GET" && !op[2])
      return json({ order: await service.read(op[1], user, true) });
    if (method === "GET" && op[2] === "history")
      return json(
        await service.history(
          op[1],
          user,
          true,
          url.searchParams.get("before"),
        ),
      );
    if (method === "POST") {
      if (op[2] === "status")
        return json({
          order: await service.transition(op[1], await body(request), user),
        });
      if (op[2] === "note")
        return json({
          order: await service.note(op[1], await body(request), user),
        });
      if (op[2] === "revision")
        return json({
          order: await service.proposeRevision(
            op[1],
            await body(request),
            user,
          ),
        });
      if (op[2] === "resend-payment")
        return json({ order: await service.resendPayment(op[1], user) });
      if (op[2] === "payment")
        return json({ order: await service.createPayment(op[1], user) });
      if (op[2] === "sync-payment")
        return json({
          ...(await service.reconcile(op[1])),
          order: await service.read(op[1], user, true),
        });
    }
  }
  const store = p.match(/^\/api\/operator\/stores\/([a-z]+)$/);
  if (store && method === "PATCH")
    return json({
      store: await service.updateStore(store[1], await body(request), user),
    });
  return json({ error: "NOT_FOUND", message: "Страница не найдена." }, 404);
}
export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      const status = e instanceof AppError ? e.status : 500;
      return json(
        {
          error: e instanceof AppError ? e.code : "INTERNAL_ERROR",
          message:
            status === 500
              ? "Сервис временно недоступен. Заказ не подтверждён. Повторите отправку позже."
              : e.message,
        },
        status,
      );
    }
  },
  async scheduled(_event, env, ctx) {
    // No polling loop, no live calls while the preview is disabled. Bounded D1/outbox work.
    const config = loadConfig(env, env.APP_ORIGIN),
      db = new Database(env.DB),
      service = new OrderService(db, catalog, config, new YandexPay(config));
    ctx.waitUntil(
      (async () => {
        if (config.ordersEnabled) await service.expire();
        await deliverNotifications(db, config);
        await db.run(
          "DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE expires_at<? LIMIT 200)",
          [new Date().toISOString()],
        );
      })(),
    );
  },
};
