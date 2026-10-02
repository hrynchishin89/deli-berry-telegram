import { fail } from "./domain.mjs";
export function loadConfig(env, origin) {
  const c = {
    origin,
    botToken: env.TELEGRAM_BOT_TOKEN || "",
    operatorId: env.TELEGRAM_OPERATOR_ID || "",
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || "",
    authMaxAge: 3600,
    paymentMode: env.PAYMENT_MODE || "disabled",
    merchantId: env.YANDEX_PAY_MERCHANT_ID || "",
    apiKey: env.YANDEX_PAY_API_KEY || "",
    synthetic:
      env.SYNTHETIC_TEST_MODE === "true" &&
      /^https?:\/\/(localhost|127\.0\.0\.1|example\.test)(:\d+)?$/.test(
        origin || "",
      ),
    dataProtectionApproved: env.PERSONAL_DATA_APPROVED === "true",
    labelingApproved: env.CATALOG_LABELING_APPROVED === "true",
    ordersEnabled: env.ORDERS_ENABLED === "true",
    telegramEnabled: env.TELEGRAM_ENABLED === "true",
    legalVersion: env.LEGAL_VERSION || "2026-10-02",
    termsUrl: env.TERMS_URL || "/legal.html#terms",
    privacyUrl: env.PRIVACY_URL || "/legal.html#privacy",
    fiscalMode: env.FISCAL_MODE || "",
    tax: Number(env.YANDEX_PAY_TAX),
  };
  if (!["disabled", "sandbox", "production"].includes(c.paymentMode))
    fail(503, "CONFIGURATION_ERROR", "Сервис ещё не настроен.");
  if (
    (c.ordersEnabled || c.telegramEnabled) &&
    (!c.botToken ||
      !/^[1-9]\d{0,15}$/.test(c.operatorId) ||
      env.OWNER_LIVE_APPROVED !== "true")
  )
    fail(
      503,
      "OWNER_APPROVAL_REQUIRED",
      "Запуск ещё не подтверждён владельцем.",
    );
  if (c.ordersEnabled && env.LEGAL_APPROVED !== "true")
    fail(503, "LEGAL_NOT_APPROVED", "Условия заказа ещё не утверждены.");
  if (
    (c.ordersEnabled || c.telegramEnabled) &&
    !c.synthetic &&
    !/^https:\/\//.test(c.origin || "")
  )
    fail(503, "ORIGIN_REQUIRED", "Укажите адрес приложения.");
  if (c.telegramEnabled && c.webhookSecret.length < 32)
    fail(503, "CONFIGURATION_ERROR", "Webhook ещё не настроен.");
  if (c.paymentMode !== "disabled" && (!c.merchantId || !c.apiKey))
    fail(503, "PAYMENT_NOT_CONFIGURED", "Оплата ещё не подключена.");
  if (
    c.ordersEnabled &&
    !c.synthetic &&
    (!c.dataProtectionApproved || !c.labelingApproved)
  )
    fail(503, "LAUNCH_DATA_REQUIRED", "Приём заказов ещё не открыт.");
  if (
    c.paymentMode === "production" &&
    (env.OWNER_LIVE_APPROVED !== "true" ||
      env.LIVE_PAYMENTS_APPROVED !== "true" ||
      c.fiscalMode !== "yandex" ||
      !Number.isInteger(c.tax) ||
      c.tax < 1 ||
      c.tax > 10)
  )
    fail(503, "PAYMENT_NOT_APPROVED", "Боевые платежи ещё не подтверждены.");
  return c;
}
