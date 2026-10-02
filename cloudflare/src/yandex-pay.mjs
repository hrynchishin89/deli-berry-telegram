import { fail, orderItems } from "./domain.mjs";
import { decode64, unbase64, utf8, sha256 } from "./crypto.mjs";
export function paymentBody(order, config) {
  const items = orderItems(order).flatMap((line, index) =>
    [
      {
        productId: line.variant.id + "-" + (index + 1),
        title: [line.product.title, line.variant.label, line.appearance?.label]
          .filter(Boolean)
          .join(", "),
        unit: line.variant.unitPrice,
      },
      ...line.addOns.map((a) => ({
        productId: a.id + "-" + (index + 1),
        title: a.name,
        unit: a.unitPrice,
      })),
    ].map((item) => ({
      productId: item.productId,
      title: item.title,
      quantity: { count: String(line.quantity) },
      unitPrice: item.unit.toFixed(2),
      total: (item.unit * line.quantity).toFixed(2),
      features: { pointsDisabled: true },
      ...(config.fiscalMode === "yandex"
        ? { receipt: { tax: config.tax } }
        : {}),
    })),
  );
  return {
    orderId: order.id,
    currencyCode: "RUB",
    availablePaymentMethods: ["CARD"],
    cart: { items, total: { amount: order.total.toFixed(2) } },
    ttl: 1800,
    ...(config.fiscalMode === "yandex"
      ? { fiscalContact: order.customer.phone }
      : {}),
    redirectUrls: {
      onSuccess: `${config.origin}/?payment_return=1#orders`,
      onError: `${config.origin}/?payment_return=1#orders`,
      onAbort: `${config.origin}/?payment_return=1#orders`,
    },
  };
}
export async function verifyWebhook(
  token,
  resolver,
  merchantId,
  now = Date.now(),
) {
  try {
    if (typeof token !== "string" || token.length > 32768) throw 0;
    const parts = token.split(".");
    if (
      parts.length !== 3 ||
      parts.some((x) => !x || !/^[A-Za-z0-9_-]+$/.test(x))
    )
      throw 0;
    const h = JSON.parse(decode64(parts[0])),
      t = Math.floor(now / 1000);
    if (
      h.alg !== "ES256" ||
      h.typ !== "JWT" ||
      typeof h.kid !== "string" ||
      h.kid.length > 128 ||
      h.crit ||
      h.b64 === false ||
      !Number.isFinite(Number(h.iat)) ||
      !Number.isFinite(Number(h.exp)) ||
      Number(h.iat) > t + 30 ||
      Number(h.exp) <= t ||
      Number(h.exp) <= Number(h.iat)
    )
      throw 0;
    const key = await resolver(h.kid),
      signature = unbase64(parts[2]);
    if (
      signature.length !== 64 ||
      !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signature,
        utf8.encode(parts[0] + "." + parts[1]),
      ))
    )
      throw 0;
    const event = JSON.parse(decode64(parts[1]));
    if (
      event.merchantId !== merchantId ||
      !Number.isFinite(Date.parse(event.eventTime))
    )
      throw 0;
    return { event, proofHash: await sha256(token) };
  } catch {
    fail(401, "INVALID_SIGNATURE", "Подпись уведомления не прошла проверку.");
  }
}
const jwksCache = new Map();
export class YandexPay {
  constructor(config, fetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
    this.base =
      config.paymentMode === "production"
        ? "https://pay.yandex.ru"
        : "https://sandbox.pay.yandex.ru";
  }
  enabled() {
    return this.config.paymentMode !== "disabled";
  }
  async key(kid) {
    let cached = jwksCache.get(this.base);
    // Fixed URL only: kid/jku/x5u from an incoming token can never choose a host.
    if (!cached || cached.until < Date.now()) {
      const res = await this.fetcher(this.base + "/api/jwks", {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!res.ok) throw new Error("JWKS unavailable");
      const txt = await res.text();
      if (txt.length > 65536) throw new Error("JWKS size");
      cached = { keys: JSON.parse(txt).keys, until: Date.now() + 300000 };
      if (!Array.isArray(cached.keys) || cached.keys.length > 32)
        throw new Error("JWKS invalid");
      jwksCache.set(this.base, cached);
    }
    const keys = cached.keys.filter(
      (k) =>
        k.kid === kid &&
        k.kty === "EC" &&
        k.crv === "P-256" &&
        (!k.alg || k.alg === "ES256") &&
        (!k.use || k.use === "sig"),
    );
    if (keys.length !== 1) throw new Error("Unknown key");
    return crypto.subtle.importKey(
      "jwk",
      keys[0],
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  }
  async verify(token) {
    if (!this.enabled())
      fail(503, "PAYMENT_NOT_CONFIGURED", "Оплата ещё не подключена.");
    return verifyWebhook(token, (kid) => this.key(kid), this.config.merchantId);
  }
  async request(route, method = "GET", body, requestId = crypto.randomUUID()) {
    if (!this.enabled())
      fail(503, "PAYMENT_NOT_CONFIGURED", "Оплата ещё не подключена.");
    let res;
    try {
      res = await this.fetcher(this.base + "/api/merchant" + route, {
        method,
        headers: {
          Authorization: `Api-Key ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "X-Request-Id": requestId,
          "X-Request-Timeout": "10000",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(11000),
        redirect: "error",
      });
    } catch {
      fail(
        502,
        "PAYMENT_UNAVAILABLE",
        "Платёжный сервис временно не отвечает.",
      );
    }
    if (!res.ok)
      fail(
        502,
        "PAYMENT_PROVIDER_ERROR",
        "Платёжный сервис не подтвердил операцию.",
      );
    const txt = await res.text();
    if (txt.length > 65536)
      fail(
        502,
        "PAYMENT_PROVIDER_ERROR",
        "Некорректный ответ платёжного сервиса.",
      );
    const data = JSON.parse(txt);
    if (data.status !== "success")
      fail(
        502,
        "PAYMENT_PROVIDER_ERROR",
        "Платёжный сервис не подтвердил операцию.",
      );
    return data.data;
  }
  safeUrl(value) {
    try {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        ["pay.yandex.ru", "sandbox.pay.yandex.ru"].includes(u.hostname) &&
        !u.username &&
        !u.password
      );
    } catch {
      return false;
    }
  }
  async create(body, requestId) {
    const data = await this.request("/v1/orders", "POST", body, requestId);
    if (!this.safeUrl(data?.paymentUrl))
      fail(502, "INVALID_PAYMENT_URL", "Некорректная ссылка оплаты.");
    return data.paymentUrl;
  }
  async get(id) {
    return (await this.request("/v1/orders/" + encodeURIComponent(id))).order;
  }
}
export function amountKopecks(value) {
  const s = String(value);
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return NaN;
  const [r, k = ""] = s.split(".");
  return Number(r) * 100 + Number(k.padEnd(2, "0"));
}
