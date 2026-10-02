(async () => {
  "use strict";
  let catalog, appConfig;
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();
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
    if (!r.ok) throw new Error(d.message || "Не удалось выполнить запрос.");
    return d;
  }
  const ordersList = document.getElementById("ordersList");
  const orderDetail = document.getElementById("orderDetail");
  const statusFilters = document.getElementById("statusFilters");
  const searchInput = document.getElementById("searchOrders");
  const toastEl = document.getElementById("toast");
  const money = new Intl.NumberFormat("ru-RU");

  const STATUS = {
    ALL: { label: "Все" },
    WAITING_CONFIRMATION: { label: "Новые", tone: "warning" },
    CONFIRMED: { label: "Подтверждены" },
    PAYMENT_PENDING: { label: "Ждут оплату", tone: "warning" },
    PAID: { label: "Оплачены", tone: "success" },
    SENT_TO_STORE: { label: "Переданы в точку" },
    IN_PRODUCTION: { label: "Готовятся" },
    READY: { label: "Готовы", tone: "success" },
    COURIER_ORDERED: { label: "Курьер вызван" },
    COURIER_PICKED_UP: { label: "У курьера" },
    DELIVERED: { label: "Доставлены", tone: "success" },
    EXPIRED_UNCLAIMED: { label: "Срок хранения истёк", tone: "danger" },
    REFUND_PENDING: { label: "Возврат согласуется", tone: "warning" },
    REFUNDED: { label: "Возвращены" },
    COMPLETED: { label: "Завершены", tone: "success" },
    CANCELLED: { label: "Отменены", tone: "danger" },
  };

  let orders = [],
    nextBefore = null,
    loadingOrders = false,
    ordersInitialized = false;
  let activeId = null;
  let filter = "ALL";
  let search = "";
  let revision = null,
    revisionQuote = null;
  const items = (o) => o.items || [o];
  const photo = (i) => i.appearance?.photos?.[0] || i.product?.image || "";
  const safePhoto = (i) =>
    /^\/?assets\/[a-zA-Z0-9_./-]+\.(webp|png|jpg)$/.test(photo(i)) &&
    !photo(i).includes("..")
      ? photo(i)
      : "";

  document
    .getElementById("refreshOrders")
    .addEventListener("click", () => loadOrders());
  document
    .getElementById("moreOrders")
    .addEventListener("click", () => loadOrders(true));
  searchInput.addEventListener("input", () => {
    search = searchInput.value.trim().toLowerCase();
    renderList();
  });
  statusFilters.addEventListener("click", (e) => {
    const button = e.target.closest("[data-status]");
    if (!button) return;
    filter = button.dataset.status;
    renderFilters();
    renderList();
  });
  ordersList.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.target.closest("[data-order-id]")?.click();
    }
  });
  ordersList.addEventListener("click", async (e) => {
    const item = e.target.closest("[data-order-id]");
    if (!item) return;
    activeId = item.dataset.orderId;
    revision = null;
    revisionQuote = null;
    await loadSelectedHistory();
    renderList();
    renderDetail();
    if (window.innerWidth < 680)
      orderDetail.scrollIntoView({ behavior: "smooth" });
  });
  orderDetail.addEventListener("click", handleDetailAction);
  orderDetail.addEventListener("input", revisionInput);
  orderDetail.addEventListener("change", revisionInput);
  document
    .getElementById("storeSettings")
    .addEventListener("click", (event) => {
      const b = event.target.closest("[data-holiday]");
      if (!b) return;
      if (b.dataset.holiday === "remove") b.closest(".holiday-row").remove();
      else
        b.closest("form")
          .querySelector(".holiday-rows")
          .insertAdjacentHTML("beforeend", holidayRow());
    });
  document
    .getElementById("storeSettings")
    .addEventListener("submit", saveStore);
  try {
    const me = await api("/api/me");
    if (!me.operator) throw new Error("Доступ разрешён только оператору.");
    [catalog, appConfig] = await Promise.all([
      api("/api/catalog"),
      api("/api/config"),
    ]);
    document.getElementById("operatorSession").textContent =
      "Оператор авторизован через Telegram" +
      (appConfig.paymentMode === "sandbox"
        ? " · ТЕСТОВАЯ ОПЛАТА"
        : appConfig.paymentEnabled
          ? ""
          : " · Оплата отключена");
    renderStores();
  } catch (error) {
    document.getElementById("operatorError").textContent = error.message;
    return;
  }
  setInterval(() => {
    if (
      !document.hidden &&
      !revision &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
    )
      loadOrders();
  }, 15000);

  renderFilters();
  loadOrders();

  async function loadOrders(more = false) {
    if (loadingOrders || (more && !nextBefore)) return;
    loadingOrders = true;
    try {
      const result = await api(
        "/api/operator/orders" +
          (more ? "?before=" + encodeURIComponent(nextBefore) : ""),
      );
      const merged = new Map(orders.map((o) => [o.id, o]));
      for (const order of result.orders) merged.set(order.id, order);
      orders = [...merged.values()];
      if (more || !ordersInitialized) nextBefore = result.nextBefore;
      ordersInitialized = true;
      if (activeId && !result.orders.some((o) => o.id === activeId)) {
        const current = await api("/api/operator/orders/" + activeId);
        orders = orders.map((o) =>
          o.id === current.order.id ? current.order : o,
        );
      }
      document.getElementById("moreOrders").hidden = !nextBefore;
      const delivery = await api("/api/operator/notifications");
      document.getElementById("operatorError").textContent = delivery
        .notifications.length
        ? `Уведомления: ${delivery.notifications.length} ожидают отправки или требуют проверки.`
        : "";
      if (activeId && !orders.some((o) => o.id === activeId)) activeId = null;
      if (!activeId && orders.length) activeId = orders[0].id;
      await loadSelectedHistory();
      renderList();
      renderDetail();
    } catch (error) {
      document.getElementById("operatorError").textContent = error.message;
    } finally {
      loadingOrders = false;
    }
  }
  async function loadSelectedHistory() {
    const selected = orders.find((o) => o.id === activeId);
    if (!selected?.historyPaginated) return;
    const id = selected.id,
      history = [];
    let before = null;
    try {
      do {
        const page = await api(
          "/api/operator/orders/" +
            id +
            "/history" +
            (before ? "?before=" + before : ""),
        );
        history.push(...page.history);
        before = page.nextBefore;
      } while (before && activeId === id);
      if (activeId === id) {
        selected.history = history.reverse();
        selected.historyPaginated = false;
      }
    } catch (error) {
      document.getElementById("operatorError").textContent = error.message;
    }
  }
  function renderStores() {
    document.getElementById("storeSettings").innerHTML = catalog.stores
      .map(
        (store) => `
      <form data-store="${store.id}" class="form-section">
      <h3>${esc(store.shortName)}</h3><div class="field-grid two">
      ${[
        ["name", "Название"],
        ["shortName", "Короткое название"],
        ["address", "Адрес"],
        ["hours", "Режим работы"],
      ]
        .map(
          ([key, label]) =>
            `<div class="field"><label>${label}<input class="input" name="${key}" value="${esc(store[key])}" required></label></div>`,
        )
        .join("")}
      <div class="field"><label>Открытие (МСК)<input class="input" type="time" name="openTime" value="${store.openTime}" required></label></div>
      <div class="field"><label>Закрытие (МСК)<input class="input" type="time" name="closeTime" value="${store.closeTime}" required></label></div></div>
      <label class="checkbox-card"><input name="enabled" type="checkbox" ${store.enabled ? "checked" : ""}> Принимать заказы в эту точку</label>
      <h4>Праздничное расписание</h4><p class="form-note">Только для этой точки. В остальные дни действует обычный график.</p><div class="holiday-rows">${Object.entries(
        store.dateOverrides || {},
      )
        .map(([d, v]) => holidayRow(d, v))
        .join(
          "",
        )}</div><button type="button" class="button ghost" data-holiday="add">Добавить дату</button><h4>Недоступные варианты</h4><div class="field-grid two">${catalog.products.flatMap((p) => p.variants.map((v) => `<label class="checkbox-card"><input name="stopList" type="checkbox" value="${v.id}" ${(store.stopList || []).includes(v.id) ? "checked" : ""}>${esc(p.title)} — ${esc(v.label)}</label>`)).join("")}</div>
      <button class="button secondary" type="submit">Сохранить точку</button></form>`,
      )
      .join("");
  }
  async function saveStore(event) {
    event.preventDefault();
    const form = event.target,
      store = catalog.stores.find((s) => s.id === form.dataset.store);
    if (!store) return;
    const data = new FormData(form),
      patch = {
        expectedVersion: store.settingsVersion,
        enabled: data.has("enabled"),
        stopList: data.getAll("stopList"),
      };
    for (const key of [
      "name",
      "shortName",
      "address",
      "hours",
      "openTime",
      "closeTime",
    ])
      patch[key] = data.get(key);
    const overrides = {};
    for (const row of form.querySelectorAll(".holiday-row")) {
      const d = row.querySelector("[name=holidayDate]").value;
      if (!d || overrides[d])
        return toast("Укажите разные даты праздничного расписания.");
      overrides[d] = {
        closed: row.querySelector("[name=holidayClosed]").checked,
        openTime: row.querySelector("[name=holidayOpen]").value,
        closeTime: row.querySelector("[name=holidayClose]").value,
      };
    }
    patch.dateOverrides = overrides;
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      await api("/api/operator/stores/" + store.id, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      catalog = await api("/api/catalog");
      renderStores();
      toast("Настройки сохранены.");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function renderFilters() {
    const preferred = Object.keys(STATUS);
    statusFilters.innerHTML = preferred
      .map(
        (status) =>
          `<button class="filter-chip ${status === filter ? "active" : ""}" data-status="${status}" type="button">${STATUS[status].label}</button>`,
      )
      .join("");
  }

  function renderList() {
    const visible = orders.filter((order) => {
      if (filter !== "ALL" && order.status !== filter) return false;
      if (!search) return true;
      const haystack = [
        order.id,
        order.customer?.name,
        order.customer?.phone,
        items(order)
          .map((i) =>
            [i.product?.title, i.variant?.id, i.appearance?.id].join(" "),
          )
          .join(" "),
        order.store?.name,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
    if (!visible.length) {
      ordersList.innerHTML = `<div class="empty-state">Заказов по этому фильтру нет.</div>`;
      return;
    }
    ordersList.innerHTML = visible
      .map((order) => {
        const status = STATUS[order.status] || { label: order.status };
        return `<article tabindex="0" role="button" class="operator-order ${order.id === activeId ? "active" : ""}" data-order-id="${order.id}">
        <div class="order-card-head"><div><div class="order-card-number">${esc(order.id)}</div><div class="order-card-date">${formatDateTime(order.createdAt)}</div></div><span class="status-pill ${status.tone || ""}">${status.label}</span></div>
        <div class="order-card-product">${esc(
          items(order)
            .map((i) => i.product?.title)
            .join(" + "),
        )}</div>
        <div class="order-card-meta">${esc(order.customer?.name || "")} · ${esc(order.customer?.phone || "")}<br>${esc(order.store?.name || "")} · ${esc(order.schedule?.date || "")} ${esc(order.schedule?.time || "")}</div>
      </article>`;
      })
      .join("");
  }

  function renderDetail() {
    const order = orders.find((o) => o.id === activeId);
    if (!order) {
      orderDetail.innerHTML = `<div class="empty-state">Выберите заказ слева.</div>`;
      return;
    }
    const status = STATUS[order.status] || { label: order.status };
    const lines = items(order);
    const delivery =
      order.fulfilment?.type === "courier"
        ? `${esc(order.fulfilment.label)}<br>${esc(order.fulfilment.deliveryAddress || "")}<br><small>Стоимость оплачивается клиентом отдельно.</small>`
        : esc(order.fulfilment?.label || "Самовывоз");

    orderDetail.innerHTML = `
      <div class="order-card-head">
        <div><div class="detail-kicker">${esc(order.id)}</div><h2>Заказ · ${lines.length} поз.</h2></div>
        <span class="status-pill ${status.tone || ""}">${status.label}</span>
      </div>
      ${lines.map((i, n) => operatorItem(i, n)).join("")}
      <dl class="detail-table">
        <div class="detail-table-row"><dt>Клиент</dt><dd>${esc(order.customer?.name || "")}<br><a href="tel:${phoneDigits(order.customer?.phone)}">${esc(order.customer?.phone || "")}</a></dd></div>
        <div class="detail-table-row"><dt>Сумма</dt><dd>${fmt(order.total)} ₽${order.fulfilment?.type === "courier" ? "<br><small>без доставки</small>" : ""}</dd></div>
        <div class="detail-table-row"><dt>Точка</dt><dd>${esc(order.store?.name || "")}<br>${esc(order.store?.address || "")}</dd></div>
        <div class="detail-table-row"><dt>Дата и время</dt><dd>${esc(order.schedule?.date?.split("-").reverse().join(".") || "")}, ${esc(order.schedule?.time || "")} (МСК)</dd></div>
        <div class="detail-table-row"><dt>Получение</dt><dd>${delivery}</dd></div>
        ${order.recipient?.name || order.recipient?.phone ? `<div class="detail-table-row"><dt>Получатель</dt><dd>${esc(order.recipient.name || "")}<br>${esc(order.recipient.phone || "")}</dd></div>` : ""}

        <div class="detail-table-row"><dt>Комментарий</dt><dd>${esc(order.comment || "Нет")}</dd></div>
        <div class="detail-table-row"><dt>Оплата</dt><dd>${esc(order.payment?.provider || "YANDEX_PAY")} · ${paymentLabel(order.payment?.status)}</dd></div>
      </dl>

      <div class="notice berry"><span>Все действия выполняет один оператор: проверяет заказ, связывается с клиентом и передаёт информацию выбранной точке.</span></div>

      ${order.status === "IN_PRODUCTION" ? lines.map((i, n) => `<fieldset class="batch-fields"><legend>Позиция ${n + 1} · ${esc(i.variant.id)}</legend><div class="field-grid two"><label class="field">Изготовлено (МСК)<input data-manufactured="${n}" type="datetime-local" class="input"></label>${i.variant.type === "freeze_dried" ? `<label class="field">Годно до (МСК, по маркировке партии)<input data-expires="${n}" type="datetime-local" class="input"></label>` : '<p class="form-note">Срок свежего изделия вычисляется сервером: 24 часа с изготовления.</p>'}</div></fieldset>`).join("") : ""}
      ${order.holdUntil ? `<div class="notice warning">Хранить на точке до ${formatDateTime(order.holdUntil)} (МСК).</div>` : ""}
      <div class="operator-actions">
        <a class="button primary" href="tel:${phoneDigits(order.customer?.phone)}">Позвонить клиенту</a>
        <button class="button secondary" data-action="copy-order" type="button">Скопировать заказ</button>
        ${actionButtons(order)}
      </div>
      ${order.pendingRevision ? `<section class="notice"><strong>Изменения ожидают согласия покупателя</strong><p>${esc(order.pendingRevision.reason)} · ${fmt(order.pendingRevision.total)} ₽</p>${order.pendingRevision.items.map(operatorItem).join("")}</section>` : ""}${revision ? revisionForm(order) : ""}
      <div class="field" style="margin-top:14px"><label for="operatorNote">Комментарий оператора</label><textarea id="operatorNote" class="textarea" placeholder="Причина изменения времени, детали доставки…">${esc(order.operatorNote || "")}</textarea></div>
      <button class="button ghost" data-action="save-note" type="button" style="margin-top:8px">Сохранить комментарий</button>
      <div class="form-section"><h3 class="form-title">История</h3>${renderHistory(order)}</div>`;
  }

  function actionButtons(order) {
    const labels = {
      CONFIRMED: "Подтвердить",
      CANCELLED: "Отменить",
      SENT_TO_STORE: "Передать в точку",
      IN_PRODUCTION: "Начать приготовление",
      READY: "Готов",
      COMPLETED: "Выдан",
      COURIER_ORDERED: "Курьер вызван",
      COURIER_PICKED_UP: "Передан курьеру",
      DELIVERED: "Доставлен",
      REFUND_PENDING: "Согласовать возврат",
    };
    const buttons = (order.allowedTransitions || []).map(
      (status) =>
        `<button class="button secondary" data-action="status" data-next="${status}">${labels[status] || esc(status)}</button>`,
    );
    if (
      ["WAITING_CONFIRMATION", "CONFIRMED"].includes(order.status) &&
      (!order.payment || order.payment.status === "NOT_CREATED")
    )
      buttons.push(
        '<button class="button secondary" data-action="edit-revision">Предложить изменения</button>',
      );
    if (order.status === "PAYMENT_PENDING" && order.payment?.url)
      buttons.push(
        '<button class="button secondary" data-action="resend-payment">Повторить уведомление об оплате</button>',
      );
    if (order.status === "PAYMENT_PENDING" && order.payment?.expired)
      buttons.push(
        '<p class="notice">Срок ссылки истёк. Сначала проверьте платёж в Яндекс Пэй. Новый платёж автоматически не создаётся.</p>',
      );
    if (order.status === "CONFIRMED" && appConfig.paymentEnabled)
      buttons.push(
        '<button class="button primary" data-action="payment">Открыть оплату Яндекс Пэй</button>',
      );
    if (
      order.status === "PAYMENT_PENDING" &&
      order.payment.status === "CREATING" &&
      !order.payment.expired
    )
      buttons.push(
        '<button class="button primary" data-action="payment">Повторить запрос ссылки</button>',
      );
    if (order.payment?.status !== "NOT_CREATED")
      buttons.push(
        '<button class="button ghost" data-action="sync-payment">Проверить платёж</button>',
      );
    if (order.status === "REFUND_PENDING")
      buttons.push(
        '<p class="form-note">Возврат выполняется в кабинете продавца по согласованной кассовой схеме. Статус обновится после подтверждения Яндекс Пэй.</p>',
      );
    return buttons.join("");
  }
  async function handleDetailAction(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const order = orders.find((o) => o.id === activeId);
    if (!order) return;
    const action = button.dataset.action;
    if (action === "copy-order") return copyOrder(order);
    if (action === "edit-revision") {
      revision = {
        items: items(order).map((i) => ({
          sku: i.variant.id,
          appearanceId:
            i.appearance?.id ||
            catalog.products
              .flatMap((p) => p.variants)
              .find((v) => v.id === i.variant.id)?.defaultAppearanceId,
          quantity: i.quantity,
          addOns: (i.addOns || []).map((a) => ({ id: a.id })),
          inscriptionText: i.inscriptionText || "",
        })),
        storeId: order.store.id,
        date: order.schedule.date,
        time: order.schedule.time,
        note: "",
      };
      revisionQuote = null;
      renderDetail();
      return;
    }
    if (action === "cancel-revision") {
      revision = null;
      revisionQuote = null;
      renderDetail();
      return;
    }
    if (action === "add-revision-line") {
      revision.items.push({
        sku: "SET-09-FRESH",
        appearanceId: "B04",
        quantity: 1,
        addOns: [],
        inscriptionText: "",
      });
      revisionQuote = null;
      renderDetail();
      return;
    }
    if (action === "remove-revision-line") {
      if (revision.items.length > 1)
        revision.items.splice(Number(button.dataset.line), 1);
      revisionQuote = null;
      renderDetail();
      return;
    }
    if (action === "quote-revision" || action === "send-revision") {
      button.disabled = true;
      try {
        if (action === "quote-revision") {
          revisionQuote = await api("/api/quote", {
            method: "POST",
            body: JSON.stringify({ items: revision.items }),
          });
          renderDetail();
        } else {
          if (!revision.note.trim()) return toast("Укажите причину изменений.");
          await api("/api/operator/orders/" + order.id + "/revision", {
            method: "POST",
            body: JSON.stringify({
              expectedVersion: order.version,
              note: revision.note,
              order: {
                items: revision.items,
                expectedTotalKopecks: revisionQuote.totalKopecks,
                store: { id: revision.storeId },
                schedule: { date: revision.date, time: revision.time },
                fulfilment: order.fulfilment,
                recipient: order.recipient,
                comment: order.comment,
              },
            }),
          });
          revision = null;
          revisionQuote = null;
          await loadOrders();
          toast("Предложение отправлено покупателю.");
        }
      } catch (e) {
        toast(e.message);
      } finally {
        button.disabled = false;
      }
      return;
    }
    let endpoint = action,
      payload = {
        expectedVersion: order.version,
        note: document.getElementById("operatorNote").value.trim(),
      };
    if (action === "save-note") endpoint = "note";
    if (action === "status") {
      payload.status = button.dataset.next;
      if (payload.status === "READY") {
        payload.batches = [];
        for (const [n, item] of items(order).entries()) {
          const manufactured = document.querySelector(
              `[data-manufactured="${n}"]`,
            ).value,
            expires = document.querySelector(`[data-expires="${n}"]`)?.value;
          if (
            !manufactured ||
            (item.variant.type === "freeze_dried" && !expires)
          )
            return toast("Укажите фактические даты для каждой позиции.");
          payload.batches.push({
            manufacturedAt: manufactured + ":00+03:00",
            ...(expires ? { expiresAt: expires + ":00+03:00" } : {}),
          });
        }
      }
      if (
        ["CANCELLED", "REFUND_PENDING"].includes(payload.status) &&
        !payload.note
      )
        return toast("Укажите причину в комментарии.");
    }
    if (
      !["note", "status", "payment", "sync-payment", "resend-payment"].includes(
        endpoint,
      )
    )
      return;
    button.disabled = true;
    try {
      await api(`/api/operator/orders/${order.id}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadOrders();
      toast("Сохранено.");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function copyOrder(order) {
    const lines = [
      `Заказ ${order.id} · ${STATUS[order.status]?.label || order.status}`,
      ...items(order).flatMap((i, n) => [
        `${n + 1}. ${i.product.title} · ${i.variant.label} · ${i.quantity} шт.`,
        `SKU: ${i.variant.id} · оформление: ${i.appearance?.id || "из старого заказа"} · ${i.appearance?.label || ""}`,
        safePhoto(i)
          ? `Фото: ${new URL(safePhoto(i), location.origin).href}`
          : "",
        i.addOns?.length
          ? `Дополнения: ${i.addOns.map((a) => a.name).join(", ")}`
          : "",
        i.inscriptionText ? `Надпись: ${i.inscriptionText}` : "",
        `Позиция: ${fmt(i.total)} ₽`,
      ]),
      `Всего за товары: ${fmt(order.total)} ₽`,
      `Точка: ${order.store.name}, ${order.store.address}`,
      `Получение: ${order.fulfilment.label} · ${order.schedule.date} ${order.schedule.time} МСК`,
      order.fulfilment.type === "courier"
        ? `Адрес: ${order.fulfilment.deliveryAddress}. Тариф доставки согласовать отдельно.`
        : "",
      order.recipient?.name
        ? `Получатель: ${order.recipient.name}, ${order.recipient.phone}`
        : "",
      `Заказчик: ${order.customer.name}, ${order.customer.phone}`,
      order.comment ? `Комментарий: ${order.comment}` : "",
      order.operatorNote ? `Оператор: ${order.operatorNote}` : "",
    ];
    const text = lines.filter(Boolean).join("\n");
    if (navigator.clipboard)
      navigator.clipboard
        .writeText(text)
        .then(() => toast("Заказ скопирован"))
        .catch(() => showCopy(text));
    else showCopy(text);
  }
  function showCopy(text) {
    const area = document.createElement("textarea");
    area.className = "textarea";
    area.value = text;
    area.setAttribute("aria-label", "Данные заказа для копирования");
    orderDetail.append(area);
    area.focus();
    area.select();
    toast("Выделите и скопируйте данные заказа.");
  }
  function operatorItem(i, n) {
    return `<section class="operator-item">${safePhoto(i) ? `<img src="${esc(safePhoto(i))}" alt="${esc(i.appearance?.label || i.product?.title)}" width="112" height="112">` : ""}<div><strong>${n + 1}. ${esc(i.product?.title)} · ${i.quantity} шт.</strong><p>${esc(i.variant?.label)} · ${esc(i.appearance?.label)}<br>SKU: ${esc(i.variant?.id)} · оформление ${esc(i.appearance?.id || "из старого заказа")}</p>${i.appearance?.referenceForTypes?.includes(i.variant?.type) ? "<p>Референс оформления: на фото свежая клубника. В заказе — сублимированная.</p>" : ""}${i.appearance?.note ? `<p>${esc(i.appearance.note)}</p>` : ""}${(i.addOns || []).map((a) => `<p>${esc(a.name)} · ${fmt(a.unitPrice)} ₽ / шт.</p>`).join("")}${i.inscriptionText ? `<p>Надпись: «${esc(i.inscriptionText)}»</p>` : ""}<strong>${fmt(i.total)} ₽</strong></div></section>`;
  }
  function holidayRow(date = "", v = {}) {
    return `<div class="holiday-row field-grid two"><label class="field">Дата<input class="input" name="holidayDate" type="date" value="${esc(date)}" required></label><label class="checkbox-card"><input name="holidayClosed" type="checkbox" ${v.closed ? "checked" : ""}>Закрыто</label><label class="field">Открытие<input class="input" name="holidayOpen" type="time" value="${esc(v.openTime || "10:00")}" required></label><label class="field">Закрытие<input class="input" name="holidayClose" type="time" value="${esc(v.closeTime || "22:00")}" required></label><button class="button ghost" type="button" data-holiday="remove">Убрать дату</button></div>`;
  }
  function revisionForm(order) {
    return `<section class="form-section" id="revisionForm"><h3>Изменения на согласование</h3><p class="form-note">Существующий заказ сохраняется до согласия покупателя. После согласия его нужно подтвердить заново.</p>${revision.items
      .map((i, n) => {
        const v = catalog.products
            .flatMap((p) => p.variants)
            .find((v) => v.id === i.sku),
          allow = [
            "SET-09-FRESH",
            "SET-12-FRESH",
            "SET-12-A06",
            "SET-16-FRESH",
            "SET-25-FRESH",
          ].includes(i.sku);
        return `<fieldset><legend>Позиция ${n + 1}</legend><label class="field">Товар и оформление<select class="select" data-rline="${n}" data-rfield="choice">${catalog.appearances
          .flatMap((a) =>
            a.allowedSkus.map((sku) => {
              const p = catalog.products.find((p) =>
                  p.variants.some((v) => v.id === sku),
                ),
                v = p.variants.find((v) => v.id === sku);
              return `<option value="${sku}|${a.id}" ${sku === i.sku && a.id === i.appearanceId ? "selected" : ""}>${esc(p.title)} · ${esc(v.label)} · ${esc(a.label)} · ${fmt(v.price)} ₽</option>`;
            }),
          )
          .join(
            "",
          )}</select></label><label class="field">Количество<input class="input" data-rline="${n}" data-rfield="quantity" type="number" min="1" max="10" value="${i.quantity}"></label>${allow ? `<label class="field">Цельные ягоды<select class="select" data-rline="${n}" data-rfield="berry" ${v.includedAddOnGroup === "whole-berry" ? "disabled" : ""}><option value="">${v.includedAddOnGroup === "whole-berry" ? "Декор включён" : "Без дополнения"}</option>${["whole-blueberry", "whole-raspberry"].map((id) => `<option value="${id}" ${i.addOns.some((a) => a.id === id) ? "selected" : ""}>${id === "whole-blueberry" ? "Голубика" : "Малина"} +200 ₽</option>`).join("")}</select></label><label class="checkbox-card"><input type="checkbox" data-rline="${n}" data-rfield="inscription" ${i.addOns.some((a) => a.id === "chocolate-inscription") ? "checked" : ""}>Шоколадная надпись +250 ₽</label>${i.addOns.some((a) => a.id === "chocolate-inscription") ? `<label class="field">Текст надписи<textarea class="textarea" data-rline="${n}" data-rfield="inscriptionText">${esc(i.inscriptionText)}</textarea></label>` : ""}` : ""}<button class="button ghost" data-action="remove-revision-line" data-line="${n}">Удалить позицию</button></fieldset>`;
      })
      .join(
        "",
      )}<button class="button secondary" data-action="add-revision-line">Добавить позицию</button><div class="field-grid two"><label class="field">Точка<select class="select" data-revision="storeId">${catalog.stores.map((s) => `<option value="${s.id}" ${s.id === revision.storeId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label><label class="field">Дата<input class="input" type="date" data-revision="date" value="${esc(revision.date)}"></label><label class="field">Время МСК<input class="input" type="time" min="10:00" max="22:00" step="900" data-revision="time" value="${esc(revision.time)}"></label></div><label class="field">Причина изменений<textarea class="textarea" data-revision="note">${esc(revision.note)}</textarea></label><p id="revisionTotal">${revisionQuote ? `Новая стоимость: ${fmt(revisionQuote.total)} ₽` : "Проверьте стоимость на сервере"}</p><button class="button secondary" data-action="quote-revision">Проверить стоимость</button><button class="button primary" data-action="send-revision" ${!revisionQuote ? "disabled" : ""}>Отправить на согласование</button><button class="button ghost" data-action="cancel-revision">Закрыть без отправки</button></section>`;
  }
  function revisionInput(event) {
    if (!revision) return;
    const el = event.target;
    if (el.dataset.revision) {
      revision[el.dataset.revision] = el.value;
    } else if (el.dataset.rline !== undefined) {
      const i = revision.items[Number(el.dataset.rline)],
        key = el.dataset.rfield;
      if (key === "choice") {
        [i.sku, i.appearanceId] = el.value.split("|");
        i.addOns = [];
        i.inscriptionText = "";
      } else if (key === "quantity") i.quantity = Number(el.value);
      else if (key === "berry") {
        i.addOns = i.addOns.filter((a) => !a.id.startsWith("whole-"));
        if (el.value) i.addOns.push({ id: el.value });
      } else if (key === "inscription") {
        i.addOns = i.addOns.filter((a) => a.id !== "chocolate-inscription");
        if (el.checked) i.addOns.push({ id: "chocolate-inscription" });
      } else i[key] = el.value;
      if (key === "choice" || key === "inscription") {
        revisionQuote = null;
        renderDetail();
        return;
      }
    } else return;
    revisionQuote = null;
    const b = document.querySelector('[data-action="send-revision"]');
    if (b) b.disabled = true;
    document.getElementById("revisionTotal").textContent =
      "Проверьте стоимость на сервере";
  }

  function renderHistory(order) {
    const history = [...(order.history || [])].reverse();
    return history.length
      ? history
          .map(
            (item) =>
              `<div class="info-row"><div class="info-icon">•</div><div><div class="info-label">${formatDateTime(item.at)}</div><div class="info-value">${esc(item.note || item.status)}</div></div></div>`,
          )
          .join("")
      : '<p class="form-note">История пока пуста.</p>';
  }

  function paymentLabel(status) {
    const labels = {
      NOT_CREATED: "не создана",
      CREATING: "ссылка запрашивается",
      PENDING: "ожидает оплаты",
      CAPTURED: "оплачено",
      FAILED: "не выполнена",
      REFUNDED: "полный возврат",
      PARTIALLY_REFUNDED: "частичный возврат",
      AUTHORIZED: "средства заблокированы",
      VOIDED: "отменена",
    };
    return labels[status] || status || "не создана";
  }

  function fmt(v) {
    return money.format(Number(v || 0));
  }
  function phoneDigits(v = "") {
    return String(v).replace(/[^+\d]/g, "");
  }
  function formatDateTime(value) {
    try {
      return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow",
      }).format(new Date(value));
    } catch (_) {
      return value;
    }
  }
  function esc(value = "") {
    return String(value).replace(
      /[&<>'"]/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[c],
    );
  }
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toastEl.classList.remove("show"), 2400);
  }
})();
