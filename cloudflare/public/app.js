(async () => {
  "use strict";
  const app = document.getElementById("app"),
    tg = window.Telegram?.WebApp,
    toastEl = document.getElementById("toast");
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const money = (n) =>
    new Intl.NumberFormat("ru-RU").format(n).replace(/\s/g, "\u00a0") +
    "\u00a0₽";
  const today = () =>
    new Date(Date.now() + 10800000).toISOString().slice(0, 10);
  const statuses = {
    WAITING_CONFIRMATION: "Ожидает подтверждения оператора",
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
  let sessionOwner = "guest";
  let catalog,
    config,
    orders = [],
    ordersError = "",
    nextBefore = null,
    busy = false,
    quoteBusy = false,
    slotsLoading = false,
    slotsError = "",
    slots = [],
    quote = null,
    priceChanged = false,
    added = false,
    errors = {},
    submitError = "",
    resetNotice = "",
    request = null,
    editing = null,
    catalogScroll = 0;
  const state = {
    route: "catalog",
    category: "set",
    group: "SET-09",
    type: "fresh",
    appearance: "",
    sku: "",
    quantity: 1,
    berryAddon: "",
    inscription: false,
    inscriptionText: "",
    cart: [],
    currentOrder: null,
    checkout: {
      fulfilment: "pickup",
      storeId: "discovery",
      date: today(),
      time: "",
      customerName: "",
      customerPhone: "",
      deliveryAddress: "",
      recipientName: "",
      recipientPhone: "",
      sameRecipient: true,
      comment: "",
      consent: false,
    },
  };
  const stack = [];
  async function api(url, options = {}) {
    const r = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": tg?.initData || "",
        ...options.headers,
      },
    });
    const d = await r.json();
    if (!r.ok) {
      const e = new Error(d.message || "Не удалось выполнить запрос.");
      e.code = d.error;
      e.status = r.status;
      throw e;
    }
    return d;
  }
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toastEl.classList.remove("show"), 3500);
  }
  function saveLocal() {
    if (tg?.initData && sessionOwner === "guest") return;
    try {
      sessionStorage.setItem(
        "deliBerry.cart.v2",
        JSON.stringify({
          until: Date.now() + 1800000,
          owner: sessionOwner,
          cart: state.cart,
        }),
      );
    } catch {}
  }
  function loadLocal() {
    try {
      const saved = JSON.parse(sessionStorage.getItem("deliBerry.cart.v2"));
      if (
        saved?.until > Date.now() &&
        saved.owner === sessionOwner &&
        Array.isArray(saved.cart)
      )
        state.cart = saved.cart;
      else if (saved?.until <= Date.now() || sessionOwner !== "guest")
        sessionStorage.removeItem("deliBerry.cart.v2");
      const p = JSON.parse(sessionStorage.getItem("deliBerry.pending.v2"));
      if (
        p?.until > Date.now() &&
        sessionOwner !== "guest" &&
        p.owner === sessionOwner
      ) {
        request = p;
        if (Array.isArray(p.cart)) state.cart = p.cart;
        Object.assign(state.checkout, p.form);
      } else if (p?.until <= Date.now() || sessionOwner !== "guest")
        sessionStorage.removeItem("deliBerry.pending.v2");
    } catch {}
  }
  function selection(sku = state.sku, id = state.appearance) {
    return {
      sku,
      appearanceId: id,
      quantity: state.quantity,
      addOns: [
        ...(state.berryAddon ? [{ id: state.berryAddon }] : []),
        ...(state.inscription ? [{ id: "chocolate-inscription" }] : []),
      ],
      inscriptionText: state.inscription ? state.inscriptionText.trim() : "",
    };
  }
  function product(sku = state.sku) {
    return catalog.products.find((p) => p.variants.some((v) => v.id === sku));
  }
  function variant(sku = state.sku) {
    return product(sku)?.variants.find((v) => v.id === sku);
  }
  function appearance(id = state.appearance) {
    return catalog.appearances.find((a) => a.id === id);
  }
  function group() {
    return catalog.groups.find((g) => g.id === state.group);
  }
  function choices() {
    const g = group();
    return catalog.appearances
      .filter((a) => g.families.includes(a.familyId))
      .flatMap((a) =>
        a.allowedSkus.map((sku) => ({ a, v: variant(sku), p: product(sku) })),
      )
      .filter((o) => o.v.type === state.type);
  }
  function typeOptions() {
    return [
      ...new Set(
        catalog.products
          .filter((p) => group().families.includes(p.id))
          .flatMap((p) => p.variants.map((v) => v.type)),
      ),
    ];
  }
  function estimated(raw) {
    const v = variant(raw.sku);
    return (
      ((v?.price || 0) +
        raw.addOns.reduce(
          (n, a) =>
            n + (catalog.pricing.addOns.find((x) => x.id === a.id)?.price || 0),
          0,
        )) *
      raw.quantity
    );
  }
  function clearSelection() {
    state.sku = "";
    state.appearance = "";
    state.quantity = 1;
    state.berryAddon = "";
    state.inscription = false;
    state.inscriptionText = "";
    added = false;
    editing = null;
  }
  function select(sku, id) {
    const v = variant(sku),
      p = product(sku),
      a = appearance(id || v?.defaultAppearanceId);
    if (!v || !a?.allowedSkus.includes(sku)) return false;
    state.category = p.kind;
    state.group = p.groupId;
    state.type = v.type;
    state.sku = sku;
    state.appearance = a.id;
    state.quantity = 1;
    state.berryAddon = "";
    state.inscription = false;
    state.inscriptionText = "";
    added = false;
    resetNotice = "";
    return true;
  }
  function deepLink() {
    const params = new URLSearchParams(location.search);
    const raw =
      params.get("sku") ||
      params.get("product") ||
      tg?.initDataUnsafe?.start_param ||
      "";
    const id = raw.replace(/^product[-_:]/i, "").toUpperCase();
    const sku = variant(id)
      ? id
      : catalog.products.find((p) => p.id === id)?.variants[0].id;
    if (sku && select(sku, params.get("appearance"))) {
      state.route = "product";
      return;
    }
    const route = location.hash.slice(1);
    if (["orders", "contacts", "cart"].includes(route)) state.route = route;
  }
  function go(route) {
    if (state.route === "catalog") catalogScroll = window.scrollY;
    stack.push(state.route);
    state.route = route;
    errors = {};
    submitError = "";
    render();
    history.replaceState(null, "", "#" + route);
    if (route === "catalog") window.scrollTo(0, catalogScroll);
    else window.scrollTo(0, 0);
    if (route === "orders") refreshOrders();
    if (route === "checkout") refreshCheckout();
    if (route === "cart") refreshQuote();
  }
  function back() {
    const route = stack.pop() || "catalog";
    state.route = route;
    added = false;
    render();
    history.replaceState(null, "", "#" + route);
    window.scrollTo(0, route === "catalog" ? catalogScroll : 0);
    if (route === "cart") refreshQuote();
  }
  function button(action, text, cls = "secondary", attrs = "") {
    return `<button type="button" class="button ${cls}" data-action="${action}" ${attrs}>${text}</button>`;
  }
  function header(backButton = false) {
    return `<header class="app-header">${backButton ? button("back", "←", "icon-button", 'aria-label="Назад"') : ""}<a href="#catalog" class="brand" data-route="catalog"><img class="brand-logo" src="assets/logo.webp" alt="" width="40" height="40"><span class="brand-name">Дели Берри</span></a><div class="header-actions"><a class="icon-button" href="tel:+79959014724" aria-label="Позвонить">☎</a><button class="icon-button" data-route="cart" aria-label="Корзина, товаров ${state.cart.reduce((n, i) => n + i.raw.quantity, 0)}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 3h2l2.5 12h11l2-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg><span class="cart-count">${state.cart.reduce((n, i) => n + i.raw.quantity, 0)}</span></button></div></header>`;
  }
  function nav() {
    return `<nav class="bottom-nav" aria-label="Главное меню">${[
      ["catalog", "Каталог"],
      ["orders", "Мои заказы"],
      ["contacts", "Контакты"],
    ]
      .map(
        ([id, label]) =>
          `<button data-route="${id}" class="${state.route === id ? "active" : ""}" ${state.route === id ? 'aria-current="page"' : ""}>${label}</button>`,
      )
      .join("")}</nav>`;
  }
  function footer() {
    return `<footer class="catalog-footer"><h2>Заберите заказ в удобной точке</h2><p>Discovery и Zеленопарк · 10:00–22:00</p><p class="muted">Цены одинаковые в обеих точках</p><button class="text-link" data-route="contacts">Адреса и маршруты →</button><h2>Нужна помощь с выбором?</h2><a class="phone-link" href="tel:+79959014724">+7 (995) 901-47-24</a><div class="footer-links"><a href="#contacts" data-route="contacts">Контакты</a><a href="legal.html#seller">О продавце</a><a href="legal.html#terms">Условия заказа</a><a href="legal.html#privacy">Персональные данные</a></div></footer>`;
  }
  function photo(a, p, first = true) {
    return `<img class="product-photo" src="${esc(a.photos[0])}" alt="${esc(p.title + " — " + a.label)}" width="960" height="960" loading="${first ? "eager" : "lazy"}" decoding="async">`;
  }
  function reference(a, v) {
    return [
      a.note,
      a.referenceForTypes.includes(v.type)
        ? "Референс оформления: на фото свежая клубника. В заказе — сублимированная."
        : "",
    ]
      .filter(Boolean)
      .map((s) => `<p class="form-note photo-note">${esc(s)}</p>`)
      .join("");
  }
  function renderCatalog() {
    const opts = choices();
    return `${header()}<main><section class="catalog-intro"><h1>Клубника в шоколаде</h1><p>Наборы и букеты — для подарка и для себя</p><p class="muted">Самовывоз или курьерская доставка</p></section><div class="catalog-controls"><div class="segmented categories" aria-label="Категория">${[
      ["set", "Наборы"],
      ["bouquet", "Букеты"],
    ]
      .map(
        ([id, label]) =>
          `<button data-category="${id}" class="segment-button ${state.category === id ? "active" : ""}" aria-pressed="${state.category === id}">${label}</button>`,
      )
      .join(
        "",
      )}</div><div class="size-row" aria-label="Размер, ягод">${catalog.groups
      .filter((g) => g.kind === state.category)
      .map(
        (g) =>
          `<button data-group="${g.id}" class="size-chip ${state.group === g.id ? "active" : ""}" aria-pressed="${state.group === g.id}">${esc(g.label)}</button>`,
      )
      .join("")}</div><div class="type-row"><span>Клубника</span>${typeOptions()
      .map((type) =>
        typeOptions().length === 1
          ? `<strong>Свежая</strong>`
          : `<button data-type="${type}" class="type-chip ${state.type === type ? "active" : ""}" aria-pressed="${state.type === type}">${type === "fresh" ? "Свежая" : "Сублимированная"}</button>`,
      )
      .join(
        "",
      )}</div></div><div class="catalog-caption"><h2>${esc(group().title)}</h2>${opts.length > 1 ? "<span>Выберите оформление</span>" : ""}</div>${resetNotice ? `<p class="form-note" role="status">${esc(resetNotice)}</p>` : ""}<section class="catalog-grid ${opts.length === 1 ? "single" : ""}" aria-label="Оформления">${opts.map(({ a, v, p }, i) => `<article class="product-card ${state.appearance === a.id ? "selected" : ""}">${photo(a, p, i < 2)}<div class="card-body"><h3>${esc(a.label)}</h3><p class="card-type">${esc(v.label)}</p><p class="prep">${esc(v.prepText)}</p><p class="price">${money(v.price)}</p>${a.includedDecoration ? `<p class="form-note">${esc(a.includedDecoration)}</p>` : ""}${reference(a, v)}<button class="button secondary block" data-appearance="${a.id}" data-sku="${v.id}">${state.appearance === a.id ? "✓ Выбрано" : "Выбрать"}</button></div></article>`).join("")}</section>${footer()}</main>${nav()}`;
  }
  function renderProduct() {
    const p = product(),
      v = variant(),
      a = appearance();
    if (!p || !v || !a) {
      state.route = "catalog";
      return renderCatalog();
    }
    const raw = selection(),
      sum = estimated(raw);
    return `${header(true)}<main class="detail-layout page-card"><div class="detail-gallery">${photo(a, p)}${a.photos.length > 1 ? `<div class="gallery">${a.photos.map((src) => `<button data-photo="${esc(src)}"><img src="${esc(src)}" alt="Ракурс ${esc(a.label)}" width="64" height="64"></button>`).join("")}</div>` : ""}${reference(a, v)}</div><section class="detail-content"><h1>${esc(p.title)}</h1>${p.id === "MIX-BANANA" ? '<p class="badges"><span>Ассорти</span><span>12 + 2</span></p>' : ""}<p>${esc(v.label)}</p><p class="prep">${esc(v.prepText)}</p><h2>Оформление</h2><p>${esc(a.label)}</p><p class="muted">${esc(a.packaging)}</p>${a.includedDecoration ? `<p class="notice">${esc(a.includedDecoration)}. Повторной доплаты нет.</p>` : ""}<p>${esc(p.description)}</p>${p.id === "SET-12" && v.type === "fresh" ? '<p class="form-note">Можно выбрать ягодное оформление</p>' : ""}${
      v.addOns
        ? `<section class="form-section"><h2>Дополнения</h2>${
            !v.includedAddOnGroup
              ? `<fieldset><legend>Целая ягода — один вариант</legend>${[
                  ["", "Без дополнения"],
                  ["whole-blueberry", "Целая голубика · +200 ₽"],
                  ["whole-raspberry", "Целая малина · +200 ₽"],
                ]
                  .map(
                    ([id, label]) =>
                      `<label class="option-card"><input type="radio" name="berry" data-bind="berryAddon" value="${id}" ${state.berryAddon === id ? "checked" : ""}><span>${label}</span></label>`,
                  )
                  .join("")}</fieldset>`
              : ""
          }<label class="checkbox-card"><input type="checkbox" data-bind="inscription" ${state.inscription ? "checked" : ""}><span>Шоколадная надпись · +250 ₽</span></label>${state.inscription ? field("inscriptionText", "Текст надписи", state.inscriptionText) + `<p class="form-note">Текст проверит оператор перед оплатой.</p>` : ""}</section>`
        : ""
    }<div class="quantity-row"><span>Количество</span><div class="quantity-control">${button("qty-minus", "−", "qty-button", 'aria-label="Уменьшить количество"')}<span>${state.quantity}</span>${button("qty-plus", "+", "qty-button", 'aria-label="Увеличить количество"')}</div></div><details><summary>Хранение и состав</summary><p>${esc(v.type === "fresh" ? catalog.storage.fresh : catalog.storage.freezeDried)}</p><p>${p.labeling?.composition ? esc(p.labeling.composition) : "Состав и аллергены уточните по телефону перед заказом."}</p>${p.labeling?.allergens ? `<p>${esc(p.labeling.allergens)}</p>` : ""}</details><p class="form-note">Предварительная сумма. Проверим стоимость при добавлении в корзину.</p></section></main><div class="sticky-cta"><p class="form-note">Курьерская доставка оплачивается отдельно</p>${added ? `<p role="status">✓ Товар в корзине</p>${button("to-cart", "Перейти в корзину", "primary block")}` : button("add-cart", `${editing !== null ? "Сохранить" : "В корзину"} · ${money(sum)}`, "primary block", busy ? "disabled" : "")}</div>`;
  }
  function lineCard(line, i, editable = false) {
    const x = line.snapshot || line,
      a = x.appearance;
    return `<article class="cart-line"><img src="${esc(a?.photos?.[0] || x.product?.image)}" alt="${esc(x.product?.title)}" width="88" height="88"><div><h3>${esc(x.product?.title)}</h3><p>${esc(a?.label)}</p><p class="form-note">${esc(x.variant?.label)} · ${x.quantity || line.raw?.quantity} шт.</p>${a ? reference(a, x.variant) : ""}${(x.addOns || []).map((d) => `<p class="form-note">${esc(d.name)}</p>`).join("")}<strong>${money(x.total || 0)}</strong>${editable ? `<div class="line-actions"><button data-edit="${i}">Изменить</button><button data-remove="${i}">Удалить</button></div>` : ""}</div></article>`;
  }
  function renderCart() {
    return `${header(true)}<main class="page-card cart-page"><h1>Корзина</h1>${state.cart.length ? `${state.cart.map((i, n) => lineCard(i, n, true)).join("")}<div class="breakdown-line total"><span>Товары</span><strong>${money(state.cart.reduce((n, i) => n + (i.snapshot?.total || 0), 0))}</strong></div>${button("go-catalog", "Добавить ещё", "ghost block")}${button("checkout", "Перейти к оформлению", "primary block")}` : `<div class="empty-state"><h2>Корзина пока пуста</h2>${button("go-catalog", "Выбрать набор или букет", "primary")}</div>`}</main>${nav()}`;
  }
  function field(
    id,
    label,
    value,
    type = "text",
    required = false,
    extra = "",
  ) {
    return `<div class="field"><label for="${id}">${label}${required ? " *" : ""}</label><input class="input" id="${id}" data-bind="${id}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${errors[id] ? 'aria-invalid="true"' : ""} aria-describedby="${id}-error" ${extra}><span class="field-error" id="${id}-error">${esc(errors[id] || "")}</span></div>`;
  }
  function totals() {
    const sum =
        quote?.total ??
        state.cart.reduce((n, i) => n + (i.snapshot?.total || 0), 0),
      courier = state.checkout.fulfilment === "courier";
    return `<div class="order-breakdown"><div class="breakdown-line"><span>Товары</span><strong>${money(sum)}</strong></div><div class="breakdown-line muted"><span>${courier ? "Доставка" : "Самовывоз"}</span><span>${courier ? "оплачивается отдельно" : "бесплатно"}</span></div><div class="breakdown-line total"><span>${courier ? "К оплате за товары" : "Итого"}</span><strong>${money(sum)}</strong></div></div>`;
  }
  function renderCheckout() {
    if (!state.cart.length) {
      state.route = "cart";
      return renderCart();
    }
    if (
      !config.dataCollectionEnabled ||
      !config.ordersEnabled ||
      !tg?.initData ||
      sessionOwner === "guest"
    )
      return `${header(true)}<main class="page-card"><h1>Оформление заказа</h1><p>${!tg?.initData ? "Откройте приложение в Telegram, чтобы оформить заказ." : sessionOwner === "guest" ? "Не удалось проверить вход. Откройте приложение заново в Telegram, чтобы продолжить." : "Приём заказов в приложении пока не открыт."}</p><p>Поможем с заказом по телефону.</p><a class="button primary" href="tel:+79959014724">+7 (995) 901-47-24</a></main>${nav()}`;
    const c = state.checkout,
      courier = c.fulfilment === "courier";
    return `${header(true)}<main class="checkout-layout"><form class="checkout-card" id="checkoutForm" novalidate><h1>Оформление заказа</h1><h2>Как получить заказ?</h2><div class="segmented">${[
      ["pickup", "Самовывоз"],
      ["courier", "Курьерская доставка"],
    ]
      .map(
        ([id, label]) =>
          `<button type="button" data-fulfilment="${id}" class="segment-button ${c.fulfilment === id ? "active" : ""}" aria-pressed="${c.fulfilment === id}">${label}</button>`,
      )
      .join(
        "",
      )}</div><h2>${courier ? "Точка приготовления" : "Где и когда заберёте?"}</h2><fieldset><legend>Выберите точку</legend>${catalog.stores.map((s) => `<div class="store-option"><label class="option-card"><input type="radio" name="store" data-bind="storeId" value="${s.id}" ${s.id === c.storeId ? "checked" : ""}><span><strong>${esc(s.shortName)}</strong><span class="option-note">${esc(s.address)}<br>${esc(s.hours)}</span></span></label><a class="text-link" href="${esc(s.mapsUrl)}" target="_blank" rel="noopener">На карте →</a></div>`).join("")}</fieldset><h2>${courier ? "Желаемое время доставки" : "Дата и время получения"}</h2><p class="form-note">По московскому времени</p><div class="field-grid two">${field("orderDate", "Дата", c.date, "date", true, `min="${today()}"`)}<div class="field"><label for="orderTime">Время *</label><select class="select" id="orderTime" data-bind="time" required aria-describedby="time-error"><option value="">Выберите</option>${slots.map((t) => `<option value="${t}" ${t === c.time ? "selected" : ""}>${t}</option>`).join("")}</select><span class="field-error" id="time-error">${esc(errors.time || "")}</span></div></div>${slotsLoading ? '<p class="form-note">Проверяем доступное время…</p>' : slotsError ? `<p class="field-error">${esc(slotsError)}</p>${button("refresh-slots", "Повторить")}` : !slots.length ? "<p>На выбранную дату нет доступного времени. Выберите другой день.</p>" : ""}<p class="form-note">Время подтвердит оператор</p>${courier ? '<p class="notice">Доставку выполняет сторонний курьер. Тариф согласуем до вызова; доставка оплачивается отдельно. Время в пути добавляется к приготовлению.</p>' : '<p class="form-note">Храним заказ на точке до 24 часов, но не дольше срока годности</p>'}<h2>Контакты для заказа</h2><div class="field-grid two">${field("customerName", "Имя", c.customerName, "text", true, 'autocomplete="name"')}${field("customerPhone", "Телефон для связи по заказу", c.customerPhone, "tel", true, 'autocomplete="tel" inputmode="tel"')}</div>${courier ? `${field("deliveryAddress", "Адрес доставки", c.deliveryAddress, "text", true)}<label class="checkbox-card"><input type="checkbox" data-bind="sameRecipient" ${c.sameRecipient ? "checked" : ""}><span>Получатель — я</span></label>${!c.sameRecipient ? `<div class="field-grid two">${field("recipientName", "Имя получателя", c.recipientName, "text", true)}${field("recipientPhone", "Телефон получателя", c.recipientPhone, "tel", true, 'inputmode="tel"')}</div>` : ""}` : ""}<div class="field"><label for="comment">Комментарий — необязательно</label><textarea class="textarea" id="comment" data-bind="comment">${esc(c.comment)}</textarea></div><p class="form-note">Пожелания проверит оператор. Изменения состава и цены согласуем до оплаты</p><label class="checkbox-card"><input type="checkbox" data-bind="consent" ${c.consent ? "checked" : ""}><span>Согласен с <a href="${esc(config.termsUrl)}" target="_blank" rel="noopener">условиями заказа</a> и <a href="${esc(config.privacyUrl)}" target="_blank" rel="noopener">обработкой данных для заказа</a></span></label><span class="field-error">${esc(errors.consent || "")}</span>${state.cart.map((i, n) => lineCard(i, n)).join("")}</form><aside class="checkout-card checkout-summary">${totals()}${priceChanged ? `<div class="notice" role="alert">Стоимость изменилась. Проверьте новую сумму.${button("accept-price", "Подтвердить новую стоимость", "secondary block")}</div>` : ""}<p class="form-note">Оператор проверит заказ и свяжется с вами. Оплата — после подтверждения</p><p id="submitError" class="field-error" role="alert">${esc(submitError)}</p><div class="sticky-cta checkout-cta">${button("submit-order", busy ? "Отправляем…" : request ? "Проверить отправку заказа" : "Отправить заказ на подтверждение", "primary block", busy || priceChanged || !quote || quoteBusy ? "disabled" : "")}</div></aside></main>`;
  }
  function orderView(o, success = false) {
    return `${header(true)}<main class="page-card ${success ? "success-card" : ""}"><h1>Заказ №${esc(o.id)} ${success ? "получен" : ""}</h1><p class="status-pill">${esc(statuses[o.status] || o.status)}</p>${(
      o.items || [o]
    )
      .filter((i) => i.product)
      .map((i, n) => lineCard(i, n))
      .join(
        "",
      )}<p><strong>${money(o.total)}</strong></p><p>${esc(o.store?.name)} · ${esc(o.fulfilment?.label || "Самовывоз")}<br>${esc(o.schedule?.date?.split("-").reverse().join("."))} ${esc(o.schedule?.time)} (МСК)</p><p>${esc(o.fulfilment?.deliveryAddress)}</p><p>${esc(o.customer?.phone)}</p>${o.pendingRevision ? `<section class="notice"><h2>Изменения на согласование</h2><p>${esc(o.pendingRevision.reason)}</p>${(o.pendingRevision.items || []).map((i, n) => lineCard(i, n)).join("")}<p>${esc(o.pendingRevision.store?.name)} · ${esc(o.pendingRevision.schedule?.date)} ${esc(o.pendingRevision.schedule?.time)}</p><p>${money(o.pendingRevision.total)}</p>${button("accept-revision", "Подтвердить изменения", "primary")}</section>` : ""}${config.paymentEnabled && o.status === "PAYMENT_PENDING" && o.payment?.url ? button("pay", "Оплатить через Яндекс Пэй", "primary block") : ""}${o.status === "PAYMENT_PENDING" && o.payment?.expired ? '<p class="notice">Срок ссылки оплаты истёк. Оператор проверит платёж и свяжется с вами.</p>' : ""}${location.search.includes("payment_return") && o.status === "PAYMENT_PENDING" ? '<p role="status">Проверяем оплату</p>' : ""}${button("refresh-orders", "Обновить статус", "secondary")}<ol class="history">${(o.history || []).map((h) => `<li>${esc(statuses[h.status] || h.status)} · ${esc(new Date(h.at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }))}</li>`).join("")}</ol>${button("orders", "Мои заказы", "ghost")}</main>`;
  }
  function renderOrders() {
    return `${header()}<main class="page-card"><h1>Мои заказы</h1>${ordersError ? `<p role="alert">${esc(ordersError)}</p>` : !tg?.initData ? "<p>Откройте приложение в Telegram, чтобы увидеть свои заказы</p>" : !orders.length ? `<div class="empty-state"><h2>Здесь появятся ваши заказы</h2>${button("go-catalog", "Открыть каталог", "primary")}</div>` : orders.map((o) => `<button class="order-card" data-order="${o.id}"><strong>№${esc(o.id)}</strong><span>${esc(statuses[o.status] || o.status)}</span><span>${money(o.total)}</span></button>`).join("")}${nextBefore ? button("more-orders", "Показать ещё") : ""}</main>${nav()}`;
  }
  function renderContacts() {
    return `${header()}<main class="contacts-layout"><h1>Контакты</h1><a class="phone-link" href="tel:+79959014724">+7 (995) 901-47-24</a>${catalog.stores.map((s) => `<section class="page-card"><h2>${esc(s.shortName)}</h2><p>${esc(s.address)}</p><p>${esc(s.hours)}</p><a class="button secondary" href="${esc(s.mapsUrl)}" target="_blank" rel="noopener">Открыть маршрут</a></section>`).join("")}${footer()}</main>${nav()}`;
  }
  function render() {
    document.body.dataset.route = state.route;
    app.innerHTML =
      state.route === "catalog"
        ? renderCatalog()
        : state.route === "product"
          ? renderProduct()
          : state.route === "cart"
            ? renderCart()
            : state.route === "checkout"
              ? renderCheckout()
              : state.route === "orders"
                ? renderOrders()
                : state.route === "contacts"
                  ? renderContacts()
                  : orderView(state.currentOrder, state.route === "success");
    tg?.MainButton?.hide();
    if (state.route === "catalog") tg?.BackButton?.hide();
    else tg?.BackButton?.show();
  }
  async function refreshQuote() {
    if (request) {
      quote = {
        totalKopecks: request.body.expectedTotalKopecks,
        total: request.body.expectedTotalKopecks / 100,
        items: state.cart.map((i) => i.snapshot),
      };
      priceChanged = false;
      if (["cart", "checkout"].includes(state.route)) render();
      return;
    }
    if (!state.cart.length) return;
    quoteBusy = true;
    const key = JSON.stringify(state.cart.map((i) => i.raw));
    try {
      const q = await api("/api/quote", {
        method: "POST",
        body: JSON.stringify({ items: JSON.parse(key) }),
      });
      if (key !== JSON.stringify(state.cart.map((i) => i.raw))) return;
      const old = state.cart.reduce(
        (n, i) => n + (i.snapshot?.totalKopecks ?? estimated(i.raw) * 100),
        0,
      );
      quote = q;
      priceChanged = old !== q.totalKopecks;
    } catch (e) {
      quote = null;
      submitError = e.message;
    } finally {
      quoteBusy = false;
      if (["cart", "checkout"].includes(state.route)) render();
    }
  }
  async function refreshSlots() {
    slotsLoading = true;
    slots = [];
    slotsError = "";
    const c = state.checkout,
      key = [
        c.storeId,
        c.date,
        state.cart.map((i) => i.raw.sku).join(","),
      ].join("|");
    try {
      const d = await api(
        "/api/slots?" +
          new URLSearchParams({
            variants: state.cart.map((i) => i.raw.sku).join(","),
            store: c.storeId,
            date: c.date,
          }),
      );
      if (
        key !==
        [c.storeId, c.date, state.cart.map((i) => i.raw.sku).join(",")].join(
          "|",
        )
      )
        return;
      slots = d.slots;
      if (!slots.includes(c.time)) c.time = "";
    } catch (e) {
      slotsError = e.message;
    } finally {
      slotsLoading = false;
      if (state.route === "checkout") render();
    }
  }
  async function refreshCheckout() {
    await Promise.allSettled([refreshQuote(), refreshSlots()]);
  }
  async function addCart() {
    if (busy) return;
    if (request) {
      toast("Сначала проверьте отправленный заказ");
      return;
    }
    if (state.inscription && !state.inscriptionText.trim()) {
      toast("Укажите текст надписи");
      document.getElementById("inscriptionText")?.focus();
      return;
    }
    busy = true;
    render();
    try {
      const raw = selection(),
        q = await api("/api/quote", {
          method: "POST",
          body: JSON.stringify({ items: [raw] }),
        });
      const identity = (x) => JSON.stringify({ ...x, quantity: 1 });
      const nextCart = state.cart.slice();
      if (editing !== null) nextCart.splice(editing, 1);
      const i = nextCart.findIndex((i) => identity(i.raw) === identity(raw));
      if (i >= 0) {
        const qty = nextCart[i].raw.quantity + raw.quantity;
        if (qty > 10) throw new Error("Для большего количества позвоните нам.");
        raw.quantity = qty;
        const merged = await api("/api/quote", {
          method: "POST",
          body: JSON.stringify({ items: [raw] }),
        });
        nextCart[i] = { raw, snapshot: merged.items[0] };
      } else nextCart.push({ raw, snapshot: q.items[0] });
      state.cart = nextCart;
      editing = null;
      added = true;
      quote = null;
      saveLocal();
      toast("Товар в корзине");
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
      render();
    }
  }
  function validateForm() {
    const c = state.checkout;
    errors = {};
    if (!c.customerName.trim()) errors.customerName = "Укажите имя";
    if (!/^(?:\+?7|8)?\d{10}$/.test(c.customerPhone.replace(/[\s()-]/g, "")))
      errors.customerPhone = "Укажите телефон в формате +7 и 10 цифр";
    if (!c.time) errors.time = "Выберите время";
    if (c.fulfilment === "courier") {
      if (!c.deliveryAddress.trim()) errors.deliveryAddress = "Укажите адрес";
      if (!c.sameRecipient) {
        if (!c.recipientName.trim()) errors.recipientName = "Укажите имя";
        if (
          !/^(?:\+?7|8)?\d{10}$/.test(c.recipientPhone.replace(/[\s()-]/g, ""))
        )
          errors.recipientPhone = "Укажите телефон получателя";
      }
    }
    if (!c.consent)
      errors.consent = "Необходимо согласие для оформления заказа";
    return !Object.keys(errors).length;
  }
  async function submit() {
    if (
      busy ||
      !config.ordersEnabled ||
      !config.dataCollectionEnabled ||
      !tg?.initData ||
      sessionOwner === "guest"
    )
      return;
    if (!request && !validateForm()) {
      render();
      document.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    busy = true;
    submitError = "";
    render();
    try {
      if (!request) {
        await refreshQuote();
        if (!quote || priceChanged) return;
        const c = state.checkout;
        request = {
          key: crypto.randomUUID(),
          until: Date.now() + 1800000,
          owner: sessionOwner,
          form: { ...c },
          cart: structuredClone(state.cart),
          body: {
            items: state.cart.map((i) => i.raw),
            expectedTotalKopecks: quote.totalKopecks,
            store: { id: c.storeId },
            schedule: { date: c.date, time: c.time },
            customer: { name: c.customerName, phone: c.customerPhone },
            fulfilment: {
              type: c.fulfilment,
              deliveryAddress: c.deliveryAddress,
            },
            recipient: {
              sameAsCustomer: c.sameRecipient,
              name: c.recipientName,
              phone: c.recipientPhone,
            },
            comment: c.comment,
            consent: c.consent,
          },
        };
        try {
          sessionStorage.setItem(
            "deliBerry.pending.v2",
            JSON.stringify(request),
          );
        } catch {}
      }
      const d = await api("/api/orders", {
        method: "POST",
        headers: { "Idempotency-Key": request.key },
        body: JSON.stringify(request.body),
      });
      if (!d.order?.id) throw new Error("missing order");
      state.currentOrder = d.order;
      orders = [d.order, ...orders.filter((o) => o.id !== d.order.id)];
      request = null;
      state.cart = [];
      state.checkout = {
        ...state.checkout,
        customerName: "",
        customerPhone: "",
        deliveryAddress: "",
        recipientName: "",
        recipientPhone: "",
        comment: "",
        consent: false,
      };
      sessionStorage.removeItem("deliBerry.pending.v2");
      sessionStorage.removeItem("deliBerry.cart.v2");
      state.route = "success";
    } catch (e) {
      const definitive = new Set([
        "INVALID_FIELD",
        "INVALID_PHONE",
        "INVALID_SELECTION",
        "INVALID_PRODUCT",
        "INVALID_APPEARANCE",
        "INVALID_QUANTITY",
        "INVALID_ADDONS",
        "INVALID_INSCRIPTION",
        "INVALID_CART",
        "APPEARANCE_REQUIRED",
        "INVALID_TOTAL",
        "PRICE_CHANGED",
        "SLOT_UNAVAILABLE",
        "CONSENT_REQUIRED",
        "INVALID_FULFILMENT",
      ]);
      if (definitive.has(e.code)) {
        request = null;
        sessionStorage.removeItem("deliBerry.pending.v2");
        submitError = e.message;
        if (e.code === "PRICE_CHANGED") await refreshQuote();
      } else if (e.status === 401 || e.status === 403) {
        submitError =
          "Откройте приложение заново в Telegram, чтобы проверить статус заказа.";
      } else
        submitError =
          "Не удалось подтвердить отправку. Повторим проверку без создания второго заказа";
    } finally {
      busy = false;
      render();
    }
  }
  async function refreshOrders(more = false) {
    if (!tg?.initData) return;
    try {
      const d = await api(
        "/api/orders" +
          (more && nextBefore
            ? "?before=" + encodeURIComponent(nextBefore)
            : ""),
      );
      orders = more ? [...orders, ...d.orders] : d.orders;
      nextBefore = d.nextBefore;
      ordersError = "";
      if (state.currentOrder) {
        const r = await api("/api/orders/" + state.currentOrder.id);
        state.currentOrder = r.order;
      }
    } catch (e) {
      ordersError = e.message;
    }
    if (["orders", "order", "success"].includes(state.route)) render();
  }
  function handleInput(e) {
    const k = e.target.dataset.bind;
    if (!k) return;
    const value =
      e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (["inscription", "inscriptionText", "berryAddon"].includes(k)) {
      state[k] = value;
      added = false;
      if (k !== "inscriptionText") render();
    } else {
      const name = k === "orderDate" ? "date" : k;
      state.checkout[name] = value;
      if (e.type === "change" && ["date", "storeId"].includes(name))
        refreshSlots();
      if (k === "sameRecipient" && e.type === "change") render();
    }
  }
  app.addEventListener("input", (e) => {
    if (
      e.target.type !== "checkbox" &&
      e.target.type !== "radio" &&
      e.target.tagName !== "SELECT"
    )
      handleInput(e);
  });
  app.addEventListener("change", handleInput);
  app.addEventListener("submit", (e) => e.preventDefault());
  app.addEventListener("click", async (e) => {
    const el = e.target.closest("button,a[data-route]");
    if (!el) return;
    if (el.dataset.route) {
      e.preventDefault();
      go(el.dataset.route);
      return;
    }
    if (el.dataset.category) {
      if (state.category === el.dataset.category) return;
      const hadSelection = state.appearance;
      state.category = el.dataset.category;
      state.group = catalog.groups.find((g) => g.kind === state.category).id;
      state.type = "fresh";
      clearSelection();
      resetNotice = hadSelection
        ? "Выберите оформление для нового размера"
        : "";
      render();
      return;
    }
    if (el.dataset.group) {
      if (state.group === el.dataset.group) return;
      const hadSelection = state.appearance;
      state.group = el.dataset.group;
      if (!typeOptions().includes(state.type)) state.type = typeOptions()[0];
      clearSelection();
      resetNotice = hadSelection
        ? "Выберите оформление для нового размера"
        : "";
      render();
      return;
    }
    if (el.dataset.type) {
      if (state.type === el.dataset.type) return;
      state.type = el.dataset.type;
      const old = state.appearance;
      clearSelection();
      resetNotice = old
        ? "Выберите оформление: прежний выбор сброшен при смене клубники"
        : "Выберите оформление";
      render();
      return;
    }
    if (el.dataset.appearance) {
      select(el.dataset.sku, el.dataset.appearance);
      go("product");
      return;
    }
    if (el.dataset.photo) {
      document.querySelector(".detail-gallery > img").src = el.dataset.photo;
      return;
    }
    if (el.dataset.fulfilment) {
      state.checkout.fulfilment = el.dataset.fulfilment;
      render();
      return;
    }
    if (el.dataset.remove !== undefined) {
      if (request) {
        toast("Сначала проверьте отправленный заказ");
        return;
      }
      state.cart.splice(Number(el.dataset.remove), 1);
      saveLocal();
      render();
      refreshQuote();
      return;
    }
    if (el.dataset.edit !== undefined) {
      if (request) {
        toast("Сначала проверьте отправленный заказ");
        return;
      }
      const i = Number(el.dataset.edit),
        r = state.cart[i].raw;
      select(r.sku, r.appearanceId);
      state.quantity = r.quantity;
      state.berryAddon =
        r.addOns.find((a) => a.id.startsWith("whole-"))?.id || "";
      state.inscription = r.addOns.some(
        (a) => a.id === "chocolate-inscription",
      );
      state.inscriptionText = r.inscriptionText;
      editing = i;
      go("product");
      return;
    }
    if (el.dataset.order) {
      state.currentOrder = orders.find((o) => o.id === el.dataset.order);
      go("order");
      return;
    }
    switch (el.dataset.action) {
      case "back":
        back();
        break;
      case "go-catalog":
        go("catalog");
        break;
      case "qty-minus":
      case "qty-plus":
        state.quantity = Math.min(
          10,
          Math.max(
            1,
            state.quantity + (el.dataset.action === "qty-plus" ? 1 : -1),
          ),
        );
        added = false;
        render();
        break;
      case "add-cart":
        await addCart();
        break;
      case "to-cart":
        go("cart");
        break;
      case "checkout":
        go("checkout");
        break;
      case "submit-order":
        await submit();
        break;
      case "refresh-slots":
        refreshSlots();
        break;
      case "accept-price":
        state.cart = quote.items.map((snapshot, i) => ({
          raw: state.cart[i].raw,
          snapshot,
        }));
        priceChanged = false;
        saveLocal();
        render();
        break;
      case "refresh-orders":
        refreshOrders();
        break;
      case "more-orders":
        refreshOrders(true);
        break;
      case "orders":
        go("orders");
        break;
      case "accept-revision":
        try {
          const d = await api(
            "/api/orders/" + state.currentOrder.id + "/revision",
            {
              method: "POST",
              body: JSON.stringify({
                expectedVersion: state.currentOrder.version,
              }),
            },
          );
          state.currentOrder = d.order;
          render();
        } catch (err) {
          toast(err.message);
        }
        break;
      case "pay": {
        try {
          const u = new URL(state.currentOrder.payment.url);
          if (
            u.protocol !== "https:" ||
            !["pay.yandex.ru", "sandbox.pay.yandex.ru"].includes(u.hostname) ||
            u.username ||
            u.password
          )
            throw 0;
          tg?.openLink
            ? tg.openLink(u.href)
            : window.open(u.href, "_blank", "noopener");
        } catch {
          toast("Ссылка оплаты недоступна");
        }
        break;
      }
    }
  });
  try {
    [catalog, config] = await Promise.all([
      api("/api/catalog"),
      api("/api/config"),
    ]);
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor?.("#F3EADF");
    tg?.setBackgroundColor?.("#F3EADF");
    tg?.BackButton?.onClick(back);
    if (tg?.initData) {
      try {
        const me = await api("/api/me");
        if (Number.isSafeInteger(me.id)) sessionOwner = String(me.id);
      } catch {}
    }
    loadLocal();
    deepLink();
    if (request && state.route === "catalog") state.route = "checkout";
    render();
    if (state.route === "checkout") refreshCheckout();
    if (state.route === "orders") refreshOrders();
  } catch {
    app.innerHTML =
      '<main class="page-card"><h1>Не удалось загрузить каталог</h1><button class="button primary" id="retryCatalog">Повторить</button><p><a href="tel:+79959014724">+7 (995) 901-47-24</a></p></main>';
    document.getElementById("retryCatalog").onclick = () => location.reload();
  }
  const viewport = () => {
    const gap = window.visualViewport
      ? Math.max(
          0,
          window.innerHeight -
            window.visualViewport.height -
            window.visualViewport.offsetTop,
        )
      : 0;
    document.documentElement.style.setProperty("--keyboard-gap", gap + "px");
    document.body.classList.toggle("keyboard-open", gap > 120);
    if (gap > 120)
      document.activeElement?.scrollIntoView?.({ block: "center" });
  };
  window.visualViewport?.addEventListener("resize", viewport);
  tg?.onEvent?.("viewportChanged", viewport);
  document.addEventListener("focusin", viewport);
  window.addEventListener("hashchange", () => {
    const r = location.hash.slice(1);
    if (
      ["catalog", "orders", "contacts", "cart"].includes(r) &&
      r !== state.route
    )
      go(r);
  });
  setInterval(() => {
    if (
      !document.hidden &&
      ["orders", "order", "success"].includes(state.route)
    )
      refreshOrders();
  }, 15000);
})();
