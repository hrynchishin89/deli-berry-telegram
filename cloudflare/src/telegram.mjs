import { fail } from "./domain.mjs";
import { secureEqual } from "./crypto.mjs";
export async function botWebhook(service, secret, update) {
  if (!service.config.telegramEnabled)
    fail(503, "TELEGRAM_DISABLED", "Бот пока не включён.");
  if (!(await secureEqual(secret, service.config.webhookSecret)))
    fail(401, "INVALID_WEBHOOK", "Недопустимый запрос.");
  if (!Number.isSafeInteger(update.update_id) || update.update_id < 0)
    fail(400, "INVALID_UPDATE", "Недопустимое уведомление.");
  const key = `telegram:${update.update_id}`;
  if (
    await service.db.first(
      "SELECT event_key FROM webhook_events WHERE event_key=?",
      [key],
    )
  )
    return;
  const statements = [
      [
        "INSERT INTO webhook_events(event_key,provider) VALUES(?,?)",
        [key, "telegram"],
      ],
    ],
    m = update.message;
  if (
    m?.chat?.type === "private" &&
    Number.isSafeInteger(m.from?.id) &&
    m.chat.id === m.from.id &&
    !m.from.is_bot &&
    /^\/(start|help)(\s|$)/.test(m.text || "")
  ) {
    statements.push([
      "INSERT INTO users(telegram_id) VALUES(?) ON CONFLICT DO NOTHING",
      [String(m.from.id)],
    ]);
    const operator = String(m.from.id) === service.config.operatorId,
      sku = (m.text.split(/\s+/)[1] || "")
        .replace(/^product[-_:]/i, "")
        .toUpperCase(),
      product = service.catalog.products.find(
        (p) => p.id.toUpperCase() === sku,
      );
    const page = operator
      ? "operator.html"
      : product
        ? "?product=" + encodeURIComponent(product.id)
        : "";
    statements.push(
      ...service.enqueue(
        `start:${update.update_id}`,
        m.chat.id,
        operator
          ? "Дели Берри. Кабинет оператора."
          : "Дели Берри. Выберите набор или букет, точку и время. Оператор проверит заказ перед оплатой.",
        service.config.origin + "/" + page,
      ),
    );
  }
  try {
    await service.db.atomic(
      "NOT EXISTS(SELECT 1 FROM webhook_events WHERE event_key=?)",
      [key],
      statements,
    );
  } catch (e) {
    if (
      await service.db.first(
        "SELECT event_key FROM webhook_events WHERE event_key=?",
        [key],
      )
    )
      return;
    throw e;
  }
}
export async function telegramCall(config, method, body) {
  const res = await fetch(
    `https://api.telegram.org/bot${config.botToken}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    },
  );
  const v = await res.json();
  if (!res.ok || !v.ok) {
    const e = new Error("Telegram delivery failed");
    e.deliveryCode = v.error_code || res.status;
    e.retryAfter = v.parameters?.retry_after;
    throw e;
  }
  return v.result;
}
export async function deliverNotifications(
  db,
  config,
  sender = telegramCall,
  now = new Date(),
) {
  if (!config.telegramEnabled) return 0;
  const token = crypto.randomUUID(),
    at = now.toISOString(),
    lease = new Date(now.getTime() + 120000).toISOString();
  const rows = await db.all(
    "UPDATE notifications SET lease_until=?,lease_token=?,attempts=attempts+1 WHERE id IN (SELECT id FROM notifications WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY next_attempt_at,id LIMIT 2) RETURNING *",
    [lease, token, at, at],
  );
  for (const row of rows) {
    try {
      await sender(config, "sendMessage", JSON.parse(row.body));
      await db.run(
        "UPDATE notifications SET delivered_at=?,lease_until=NULL,lease_token=NULL,last_error=NULL WHERE id=? AND lease_token=?",
        [at, row.id, token],
      );
    } catch (e) {
      const permanent =
          [400, 403].includes(e.deliveryCode) || row.attempts >= 8,
        seconds = Math.max(
          Number(e.retryAfter) || 0,
          Math.min(3600, 2 ** row.attempts * 10),
        );
      await db.run(
        "UPDATE notifications SET lease_until=NULL,lease_token=NULL,last_error=?,failed_at=?,next_attempt_at=? WHERE id=? AND lease_token=?",
        [
          `telegram:${e.deliveryCode || "NETWORK"}`,
          permanent ? at : null,
          new Date(now.getTime() + seconds * 1000).toISOString(),
          row.id,
          token,
        ],
      );
    }
  }
  return rows.length;
}
