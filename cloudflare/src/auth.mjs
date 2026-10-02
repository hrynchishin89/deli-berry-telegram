import { fail } from "./domain.mjs";
import { hmac, hmacKey, utf8 } from "./crypto.mjs";
export async function telegramUser(
  initData,
  botToken,
  maxAge = 3600,
  now = Date.now(),
) {
  if (!botToken || typeof initData !== "string" || initData.length > 12000)
    fail(401, "TELEGRAM_AUTH_REQUIRED", "Откройте приложение через Telegram.");
  const p = new URLSearchParams(initData),
    keys = [...p.keys()],
    hash = p.get("hash");
  if (
    new Set(keys).size !== keys.length ||
    !/^[a-f0-9]{64}$/i.test(hash || "") ||
    !/^\d{1,12}$/.test(p.get("auth_date") || "")
  )
    fail(401, "INVALID_AUTH", "Не удалось проверить вход.");
  p.delete("hash");
  const check = [...p]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac("WebAppData", botToken),
    signature = Uint8Array.from(hash.match(/../g), (x) => parseInt(x, 16));
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature,
    utf8.encode(check),
  );
  const age = Math.floor(now / 1000) - Number(p.get("auth_date"));
  if (!valid || age < 0 || age > maxAge)
    fail(
      401,
      "AUTH_EXPIRED",
      "Закройте и снова откройте приложение в Telegram.",
    );
  let user;
  try {
    user = JSON.parse(p.get("user"));
  } catch {}
  if (!Number.isSafeInteger(user?.id) || user.id <= 0 || user.is_bot)
    fail(401, "INVALID_USER", "Не удалось проверить пользователя.");
  return user;
}
export const isOperator = (user, config) =>
  String(user.id) === config.operatorId;
export function requireOperator(user, config) {
  if (!isOperator(user, config))
    fail(403, "OPERATOR_ONLY", "Доступ разрешён только оператору.");
}
