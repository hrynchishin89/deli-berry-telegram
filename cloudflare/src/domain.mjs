export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const fail = (status, code, message) => {
  throw new AppError(status, code, message);
};
export const STATUS = {
  WAITING_CONFIRMATION: "Ожидает подтверждения",
  CONFIRMED: "Подтверждён",
  PAYMENT_PENDING: "Ожидает оплаты",
  PAID: "Оплачен",
  SENT_TO_STORE: "Передан в точку",
  IN_PRODUCTION: "Готовится",
  READY: "Готов к получению",
  COMPLETED: "Выдан",
  COURIER_ORDERED: "Курьер вызван",
  COURIER_PICKED_UP: "Передан курьеру",
  DELIVERED: "Доставлен",
  CANCELLED: "Отменён",
  REFUND_PENDING: "Возврат согласуется",
  REFUNDED: "Возвращён",
  EXPIRED_UNCLAIMED: "Срок хранения истёк",
};
export function text(value, max, required = false) {
  if (value != null && typeof value !== "string")
    fail(400, "INVALID_FIELD", "Некорректное поле.");
  const v = (value || "").trim();
  if (
    v.length > max ||
    (required && !v) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    fail(400, "INVALID_FIELD", "Проверьте заполненные поля.");
  return v;
}
export function phone(value, optional = false) {
  let v = text(value, 30).replace(/[\s()+-]/g, "");
  if (!v && optional) return "";
  if (/^8\d{10}$/.test(v)) v = "7" + v.slice(1);
  if (/^\d{10}$/.test(v)) v = "7" + v;
  if (!/^7\d{10}$/.test(v))
    fail(400, "INVALID_PHONE", "Укажите телефон в формате +7 и 10 цифр.");
  return "+" + v;
}
export function moscowDate(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
}
export function validDate(v) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v
  );
}
export function slots(catalog, variantId, storeId, date, now = new Date()) {
  const variant = catalog.products
    .flatMap((p) => p.variants)
    .find((v) => v.id === variantId);
  const store = catalog.stores.find((s) => s.id === storeId);
  if (!variant || !store || !validDate(date))
    fail(400, "INVALID_SELECTION", "Проверьте товар, точку и дату.");
  if (
    date < moscowDate(now) ||
    store.enabled === false ||
    (store.stopList || []).includes(variantId)
  )
    return [];
  const override = store.dateOverrides?.[date];
  if (override?.closed) return [];
  const from = override?.openTime || store.openTime || "10:00",
    to = override?.closeTime || store.closeTime || "22:00";
  const start = Number(from.slice(0, 2)) * 60 + Number(from.slice(3));
  const end = Number(to.slice(0, 2)) * 60 + Number(to.slice(3));
  const availableAt = now.getTime() + variant.prepMinutes * 60000;
  const result = [];
  for (let n = Math.ceil(start / 15) * 15; n <= end; n += 15) {
    const time = `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
    if (new Date(`${date}T${time}:00+03:00`).getTime() >= availableAt)
      result.push(time);
  }
  return result;
}
export function price(catalog, raw) {
  const sku = raw.sku || raw.variant?.id;
  const product = catalog.products.find(
    (p) =>
      (raw.product?.id ? p.id === raw.product.id : true) &&
      p.variants.some((v) => v.id === sku),
  );
  const variant = product?.variants.find((v) => v.id === sku);
  if (!variant) fail(400, "INVALID_PRODUCT", "Товар или вариант не найден.");
  const appearance = catalog.appearances.find(
    (a) =>
      a.id === (raw.appearanceId || variant.defaultAppearanceId) &&
      a.allowedSkus.includes(variant.id),
  );
  if (!appearance)
    fail(400, "INVALID_APPEARANCE", "Выберите совместимое оформление.");
  const quantity = raw.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10)
    fail(400, "INVALID_QUANTITY", "Количество — целое число от 1 до 10.");
  const requested = raw.addOns ?? [];
  if (!Array.isArray(requested) || requested.length > 3)
    fail(400, "INVALID_ADDONS", "Проверьте дополнения.");
  const groups = new Set(),
    addOns = [];
  const inscriptionText = text(raw.inscriptionText, 4000);
  for (const item of requested) {
    const addon = catalog.pricing.addOns.find((a) => a.id === item?.id);
    if (
      !variant.addOns ||
      !addon ||
      groups.has(addon.group) ||
      variant.includedAddOnGroup === addon.group
    )
      fail(
        400,
        "INVALID_ADDONS",
        "Это дополнение недоступно или уже включено в цену.",
      );
    if (addon.id === "chocolate-inscription" && !inscriptionText)
      fail(400, "INVALID_INSCRIPTION", "Укажите текст надписи.");
    groups.add(addon.group);
    addOns.push({
      id: addon.id,
      name:
        addon.name +
        (addon.id === "chocolate-inscription" ? `: «${inscriptionText}»` : ""),
      unitPrice: addon.price,
    });
  }
  const total =
    (variant.price + addOns.reduce((sum, a) => sum + a.unitPrice, 0)) *
    quantity;
  return {
    product,
    variant,
    appearance,
    quantity,
    addOns,
    total,
    totalKopecks: total * 100,
    inscriptionText: groups.has("inscription") ? inscriptionText : "",
  };
}
export function priceCart(catalog, raw) {
  const requested = raw.items ?? [raw];
  if (!Array.isArray(requested) || !requested.length || requested.length > 30)
    fail(400, "INVALID_CART", "Проверьте корзину.");
  const items = requested.map((line) => {
    if (raw.items && !line.appearanceId)
      fail(400, "APPEARANCE_REQUIRED", "Выберите оформление.");
    const q = price(catalog, line);
    return {
      product: {
        id: q.product.id,
        title: q.product.title,
        image: q.appearance.photos[0],
        description: q.product.description,
      },
      variant: {
        id: q.variant.id,
        type: q.variant.type,
        label: q.variant.label,
        unitPrice: q.variant.price,
        prepMinutes: q.variant.prepMinutes,
        prepText: q.variant.prepText,
      },
      appearance: structuredClone(q.appearance),
      quantity: q.quantity,
      addOns: q.addOns,
      inscriptionText: q.inscriptionText,
      total: q.total,
      totalKopecks: q.totalKopecks,
      storage:
        q.variant.type === "fresh"
          ? catalog.storage.fresh
          : catalog.storage.freezeDried,
    };
  });
  const totalKopecks = items.reduce((n, i) => n + i.totalKopecks, 0);
  if (!Number.isSafeInteger(totalKopecks) || totalKopecks <= 0)
    fail(400, "INVALID_TOTAL", "Проверьте сумму.");
  return { items, totalKopecks, total: totalKopecks / 100 };
}
export const orderItems = (order) =>
  order.items?.length ? order.items : [order];
export function cartSlots(catalog, items, storeId, date, now = new Date()) {
  const lists = items.map((i) =>
    slots(catalog, i.sku || i.variant?.id, storeId, date, now),
  );
  return lists.length
    ? lists[0].filter((t) => lists.every((a) => a.includes(t)))
    : [];
}
export function normalizeOrder(catalog, raw, user, now = new Date()) {
  const q = priceCart(catalog, raw),
    first = q.items[0];
  if (raw.items && raw.expectedTotalKopecks !== q.totalKopecks)
    fail(
      409,
      "PRICE_CHANGED",
      "Стоимость изменилась. Проверьте новую сумму и подтвердите её.",
    );
  const store = catalog.stores.find((s) => s.id === raw.store?.id);
  if (
    !store ||
    !cartSlots(
      catalog,
      q.items,
      store.id,
      raw.schedule?.date || "",
      now,
    ).includes(raw.schedule?.time)
  )
    fail(
      400,
      "SLOT_UNAVAILABLE",
      "Выбранное время недоступно. Выберите другое.",
    );
  if (raw.consent !== true)
    fail(
      400,
      "CONSENT_REQUIRED",
      "Подтвердите согласие с условиями и обработкой данных.",
    );
  const type = raw.fulfilment?.type;
  if (!["pickup", "courier"].includes(type))
    fail(400, "INVALID_FULFILMENT", "Выберите способ получения.");
  const customer = {
    name: text(raw.customer?.name, 120, true),
    phone: phone(raw.customer?.phone),
  };
  const recipient =
    type === "courier"
      ? raw.recipient?.sameAsCustomer
        ? { ...customer }
        : {
            name: text(raw.recipient?.name, 120, true),
            phone: phone(raw.recipient?.phone),
          }
      : null;
  return {
    id:
      "DB-" +
      crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    status: "WAITING_CONFIRMATION",
    source: "telegram-mini-app-verified",
    telegramUser: { id: user.id },
    ...first,
    items: q.items,
    total: q.total,
    totalKopecks: q.totalKopecks,
    revision: 1,
    fulfilment: {
      type,
      label: type === "courier" ? "Курьерская доставка" : "Самовывоз",
      deliveryAddress:
        type === "courier"
          ? text(raw.fulfilment.deliveryAddress, 500, true)
          : "",
      deliveryPrice: null,
    },
    store: { id: store.id, name: store.name, address: store.address },
    schedule: {
      date: raw.schedule.date,
      time: raw.schedule.time,
      timeZone: "Europe/Moscow",
      at: new Date(
        raw.schedule.date + "T" + raw.schedule.time + ":00+03:00",
      ).toISOString(),
    },
    customer,
    recipient,
    comment: text(raw.comment, 2000),
    operatorNote: "",
    consent: {
      acceptedAt: now.toISOString(),
      version: "2026-10-02",
      termsUrl: "/legal.html",
    },
    payment: { provider: "YANDEX_PAY", status: "NOT_CREATED", url: "" },
  };
}
export function allowedTransitions(order) {
  const map = {
    WAITING_CONFIRMATION: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["CANCELLED"],
    PAYMENT_PENDING: ["CANCELLED"],
    PAID: ["SENT_TO_STORE", "REFUND_PENDING"],
    SENT_TO_STORE: ["IN_PRODUCTION", "REFUND_PENDING"],
    IN_PRODUCTION: ["READY", "REFUND_PENDING"],
    READY: [
      order.fulfilment.type === "pickup" ? "COMPLETED" : "COURIER_ORDERED",
      "REFUND_PENDING",
    ],
    COURIER_ORDERED: ["COURIER_PICKED_UP", "REFUND_PENDING"],
    COURIER_PICKED_UP: ["DELIVERED", "REFUND_PENDING"],
    COMPLETED: ["REFUND_PENDING"],
    DELIVERED: ["REFUND_PENDING"],
    EXPIRED_UNCLAIMED: ["REFUND_PENDING"],
  };
  return map[order.status] || [];
}
export function validateTransition(order, next, extra, now = new Date()) {
  if (!allowedTransitions(order).includes(next))
    fail(
      409,
      "INVALID_TRANSITION",
      "Этот переход статуса недоступен. Обновите заказ.",
    );
  if (next === "READY") {
    const items = orderItems(order),
      batches = extra.batches || items.map(() => extra);
    if (batches.length !== items.length)
      fail(
        400,
        "INVALID_EXPIRY",
        "Укажите данные изготовления для каждой позиции.",
      );
    const checked = items.map((line, i) => {
      const manufactured = Date.parse(batches[i]?.manufacturedAt),
        isFresh = line.variant.type === "fresh";
      const expiry = isFresh
        ? manufactured + 86400000
        : Date.parse(batches[i]?.expiresAt);
      if (
        !Number.isFinite(manufactured) ||
        !Number.isFinite(expiry) ||
        manufactured > now.getTime() ||
        expiry <= now.getTime() ||
        expiry <= manufactured
      )
        fail(
          400,
          "INVALID_EXPIRY",
          "Укажите фактическое изготовление и срок годности с упаковки.",
        );
      if (
        isFresh &&
        batches[i].expiresAt &&
        Date.parse(batches[i].expiresAt) !== expiry
      )
        fail(
          400,
          "INVALID_EXPIRY",
          "Срок свежего изделия — 24 часа с фактического изготовления.",
        );
      const maxFD = new Date(manufactured);
      maxFD.setUTCMonth(maxFD.getUTCMonth() + 3);
      if (!isFresh && expiry > maxFD.getTime())
        fail(
          400,
          "INVALID_EXPIRY",
          "Сверьте срок партии: не более трёх месяцев.",
        );
      return {
        manufacturedAt: new Date(manufactured).toISOString(),
        expiresAt: new Date(expiry).toISOString(),
      };
    });
    order.batches = checked;
    order.manufacturedAt = checked.map((b) => b.manufacturedAt).sort()[0];
    order.expiresAt = checked.map((b) => b.expiresAt).sort()[0];
    const pickup = Date.parse(
      order.schedule?.at ||
        `${order.schedule.date}T${order.schedule.time}:00+03:00`,
    );
    order.holdUntil = new Date(
      Math.min(pickup + 86400000, Date.parse(order.expiresAt)),
    ).toISOString();
    if (Date.parse(order.holdUntil) <= now.getTime())
      fail(409, "EXPIRED", "Срок хранения истёк. Выдача недоступна.");
  }
  if (
    ["COMPLETED", "COURIER_PICKED_UP", "COURIER_ORDERED"].includes(next) &&
    (!Number.isFinite(Date.parse(order.holdUntil)) ||
      Date.parse(order.holdUntil) <= now.getTime())
  )
    fail(409, "EXPIRED", "Срок хранения истёк. Выдача недоступна.");
  if (["REFUND_PENDING", "CANCELLED"].includes(next))
    text(extra.note, 1000, true);
}
