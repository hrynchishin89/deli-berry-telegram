import {
  fail,
  normalizeOrder,
  allowedTransitions,
  validateTransition,
  slots,
  cartSlots,
  orderItems,
  validDate,
  text,
  STATUS,
} from "./domain.mjs";
import { paymentBody, amountKopecks } from "./yandex-pay.mjs";
import { sha256, encode64, decode64 } from "./crypto.mjs";
const j = JSON.stringify;
const canonical = (v) =>
  v && typeof v === "object"
    ? Array.isArray(v)
      ? v.map(canonical)
      : Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
    : v;
const parseRow = (r) => (r ? { ...r, data: JSON.parse(r.data) } : null);
const paymentExpiry = (p) =>
  Date.parse(p.created_at) +
  Number(JSON.parse(p.request_body).ttl || 1800) * 1000;
export class OrderService {
  constructor(db, catalog, config, provider, clock = () => new Date()) {
    Object.assign(this, { db, catalog, config, provider, clock });
  }
  async getCatalog() {
    const rows = await this.db.all(
      "SELECT id,settings,version FROM stores ORDER BY id",
    );
    return {
      ...this.catalog,
      stores: this.catalog.stores.map((s) => {
        const r = rows.find((r) => r.id === s.id);
        if (!r) fail(503, "MIGRATIONS_REQUIRED", "Сервис ещё не настроен.");
        return { ...JSON.parse(r.settings), settingsVersion: r.version };
      }),
    };
  }
  async row(id) {
    const row = parseRow(
      await this.db.first("SELECT * FROM orders WHERE id=?", [id]),
    );
    if (!row) fail(404, "NOT_FOUND", "Заказ не найден.");
    return row;
  }
  hydrate(row, operator = false) {
    const data = JSON.parse(row.data),
      events = JSON.parse(row.events || "[]");
    const expired =
      row.payment_status &&
      paymentExpiry({
        created_at: row.payment_created_at,
        request_body: row.payment_request_body,
      }) <= this.clock().getTime();
    const order = {
      ...data,
      status: row.status,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payment: row.payment_status
        ? {
            provider: "YANDEX_PAY",
            status: row.payment_status,
            expired: Boolean(expired),
            url:
              !expired &&
              row.status === "PAYMENT_PENDING" &&
              row.payment_status === "PENDING"
                ? row.payment_url
                : "",
          }
        : data.payment,
      historyPaginated: true,
      history: events.map((e) => ({
        at: e.created_at,
        previousStatus: e.previous_status,
        status: e.status,
        note: e.note,
        ...(operator ? { actor: e.actor } : {}),
      })),
    };
    if (operator)
      order.allowedTransitions = allowedTransitions(order).filter(
        (s) => !(s === "CONFIRMED" && order.pendingRevision),
      );
    else {
      delete order.operatorNote;
      delete order.telegramUser;
      order.history = order.history.filter(
        (e) => e.note !== "Комментарий оператора обновлён.",
      );
    }
    return order;
  }
  select(limit) {
    return `SELECT o.*,p.status payment_status,p.url payment_url,p.created_at payment_created_at,p.request_body payment_request_body,(SELECT json_group_array(json(event)) FROM (SELECT json_object('id',e.id,'created_at',e.created_at,'previous_status',e.previous_status,'status',e.status,'note',e.note,'actor',e.actor) event FROM order_events e WHERE e.order_id=o.id ORDER BY e.id DESC LIMIT ${limit})) events FROM orders o LEFT JOIN payments p ON p.order_id=o.id`;
  }
  async read(id, user, operator = false) {
    const row = await this.db.first(
      this.select(50) + " WHERE o.id=?" + (operator ? "" : " AND o.user_id=?"),
      operator ? [id] : [id, String(user.id)],
    );
    if (!row) fail(404, "NOT_FOUND", "Заказ не найден.");
    const value = this.hydrate(row, operator);
    value.history.reverse();
    return value;
  }
  async list(user, operator = false, before = null) {
    const params = operator ? [] : [String(user.id)],
      filters = operator ? [] : ["o.user_id=?"];
    if (before) {
      let cursor;
      try {
        if (before.length > 300) throw 0;
        cursor = JSON.parse(decode64(before));
      } catch {}
      if (
        !cursor ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(cursor.at) ||
        !Number.isFinite(Date.parse(cursor.at)) ||
        !/^DB-[A-F0-9]{16}$/.test(cursor.id)
      )
        fail(400, "INVALID_CURSOR", "Обновите список заказов.");
      filters.push("(o.created_at,o.id)<(?,?)");
      params.push(cursor.at, cursor.id);
    }
    const rows = await this.db.all(
      this.select(5) +
        (filters.length ? " WHERE " + filters.join(" AND ") : "") +
        " ORDER BY o.created_at DESC,o.id DESC LIMIT 20",
      params,
    );
    return {
      orders: rows.map((r) => {
        const o = this.hydrate(r, operator);
        o.history.reverse();
        return o;
      }),
      nextBefore:
        rows.length === 20
          ? encode64(j({ at: rows.at(-1).created_at, id: rows.at(-1).id }))
          : null,
    };
  }
  async history(id, user, operator, before) {
    await this.read(id, user, operator);
    const cursor = before ? Number(before) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(cursor) || cursor <= 0)
      fail(400, "INVALID_CURSOR", "Некорректный курсор.");
    const rows = await this.db.all(
      "SELECT * FROM order_events WHERE order_id=? AND id<? ORDER BY id DESC LIMIT 50",
      [id, cursor],
    );
    return {
      history: rows
        .filter((e) => operator || e.note !== "Комментарий оператора обновлён.")
        .map((e) => ({
          id: e.id,
          at: e.created_at,
          previousStatus: e.previous_status,
          status: e.status,
          note: e.note,
          ...(operator ? { actor: e.actor } : {}),
        })),
      nextBefore: rows.length === 50 ? rows.at(-1).id : null,
    };
  }
  enqueue(key, chatId, message, url = "") {
    if (!chatId || !this.config.telegramEnabled) return [];
    const body = {
      chat_id: String(chatId),
      text: message + "\n" + this.catalog.brand.phone,
      ...(url
        ? {
            reply_markup: {
              inline_keyboard: [[{ text: "Открыть заказ", web_app: { url } }]],
            },
          }
        : {}),
    };
    return [
      [
        "INSERT INTO notifications(dedupe_key,chat_id,body) VALUES(?,?,?) ON CONFLICT(dedupe_key) DO NOTHING",
        [key, String(chatId), j(body)],
      ],
    ];
  }
  changes(row, next, actor, note, proof = null) {
    const now = this.clock().toISOString(),
      event = crypto.randomUUID(),
      previous = row.status;
    row.data.status = next;
    const statements = [
      [
        "UPDATE orders SET status=?,data=?,version=version+1,updated_at=?,hold_until=?,paid_event_key=COALESCE(?,paid_event_key) WHERE id=?",
        [next, j(row.data), now, row.data.holdUntil || null, proof, row.id],
      ],
      [
        "INSERT INTO order_events(order_id,actor,previous_status,status,note,created_at) VALUES(?,?,?,?,?,?)",
        [row.id, actor, previous, next, note, now],
      ],
    ];
    if (previous !== next) {
      statements.push(
        ...this.enqueue(
          `event:${event}:customer`,
          row.user_id,
          `Заказ ${row.id}: ${STATUS[next]}.`,
          this.config.origin + "/#orders",
        ),
      );
      if (
        [
          "PAID",
          "CANCELLED",
          "REFUND_PENDING",
          "REFUNDED",
          "EXPIRED_UNCLAIMED",
        ].includes(next)
      )
        statements.push(
          ...this.enqueue(
            `event:${event}:operator`,
            this.config.operatorId,
            `Заказ ${row.id}: ${STATUS[next]}.`,
            this.config.origin + "/operator.html",
          ),
        );
    }
    return statements;
  }
  async create(raw, user, requestKey) {
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestKey || ""))
      fail(400, "IDEMPOTENCY_REQUIRED", "Повторите отправку формы.");
    const requestHash = await sha256(j(canonical(raw)));
    const existing = () =>
      this.db.first(
        "SELECT id,request_hash FROM orders WHERE user_id=? AND request_key=?",
        [String(user.id), requestKey],
      );
    const repeat = async (r) => {
      if (r.request_hash !== requestHash)
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Заказ уже отправлен с другой комплектацией. Обновите форму.",
        );
      return this.read(r.id, user);
    };
    let old = await existing();
    if (old) return repeat(old);
    const catalog = await this.getCatalog(),
      o = normalizeOrder(catalog, raw, user, this.clock()),
      store = catalog.stores.find((s) => s.id === o.store.id);
    o.consent = {
      ...o.consent,
      version: this.config.legalVersion,
      termsUrl: this.config.termsUrl,
      privacyUrl: this.config.privacyUrl,
    };
    try {
      await this.db.atomic(
        "EXISTS(SELECT 1 FROM stores WHERE id=? AND version=?)",
        [store.id, store.settingsVersion],
        [
          [
            "INSERT INTO users(telegram_id) VALUES(?) ON CONFLICT DO NOTHING",
            [String(user.id)],
          ],
          [
            "INSERT INTO orders(id,user_id,request_key,request_hash,store_id,status,total_kopecks,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            [
              o.id,
              String(user.id),
              requestKey,
              requestHash,
              store.id,
              o.status,
              o.total * 100,
              j(o),
              o.createdAt,
              o.updatedAt,
            ],
          ],
          [
            "INSERT INTO order_events(order_id,actor,status,note,created_at) VALUES(?,?,?,?,?)",
            [
              o.id,
              `customer:${user.id}`,
              o.status,
              "Заказ создан клиентом.",
              o.createdAt,
            ],
          ],
          ...this.enqueue(
            `new:${o.id}:operator`,
            this.config.operatorId,
            `Новый заказ ${o.id}. ${o.store.name}. ${o.total} ₽.`,
            this.config.origin + "/operator.html",
          ),
          ...this.enqueue(
            `new:${o.id}:customer`,
            user.id,
            `Заказ ${o.id} принят. Время подтвердит оператор.`,
            this.config.origin + "/#orders",
          ),
        ],
      );
    } catch (e) {
      old = await existing();
      if (old) return repeat(old);
      throw e;
    }
    return this.read(o.id, user);
  }
  checkVersion(row, expected) {
    if (!Number.isInteger(expected) || row.version !== expected)
      fail(409, "STALE_ORDER", "Заказ изменился. Обновите карточку.");
  }
  async availability(row) {
    const catalog = await this.getCatalog();
    if (
      !cartSlots(
        catalog,
        orderItems(row.data),
        row.store_id,
        row.data.schedule.date,
        this.clock(),
      ).includes(row.data.schedule.time)
    )
      fail(
        409,
        "SLOT_UNAVAILABLE",
        "Время или товар уже недоступны. Согласуйте новый заказ с клиентом.",
      );
    return catalog.stores.find((s) => s.id === row.store_id).settingsVersion;
  }
  async transition(id, patch, user) {
    const row = await this.row(id);
    this.checkVersion(row, patch.expectedVersion);
    const note = text(patch.note, 1000);
    if (patch.status === "CONFIRMED" && row.data.pendingRevision)
      fail(
        409,
        "REVISION_PENDING",
        "Сначала дождитесь согласия покупателя на изменения.",
      );
    const storeVersion =
      patch.status === "CONFIRMED" ? await this.availability(row) : null;
    row.data.status = row.status;
    validateTransition(row.data, patch.status, patch, this.clock());
    await this.db.atomic(
      "EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?)" +
        (storeVersion
          ? " AND EXISTS(SELECT 1 FROM stores WHERE id=? AND version=?)"
          : ""),
      [id, row.version, ...(storeVersion ? [row.store_id, storeVersion] : [])],
      this.changes(
        row,
        patch.status,
        `operator:${user.id}`,
        note || STATUS[patch.status],
      ),
    );
    return this.read(id, user, true);
  }
  async note(id, patch, user) {
    const row = await this.row(id);
    this.checkVersion(row, patch.expectedVersion);
    row.data.operatorNote = text(patch.note, 2000);
    await this.db.atomic(
      "EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?)",
      [id, row.version],
      this.changes(
        row,
        row.status,
        `operator:${user.id}`,
        "Комментарий оператора обновлён.",
      ),
    );
    return this.read(id, user, true);
  }
  async proposeRevision(id, patch, user) {
    const row = await this.row(id);
    this.checkVersion(row, patch.expectedVersion);
    if (
      (await this.db.first("SELECT order_id FROM payments WHERE order_id=?", [
        id,
      ])) ||
      !["WAITING_CONFIRMATION", "CONFIRMED"].includes(row.status)
    )
      fail(
        409,
        "PAYMENT_LOCKED",
        "После открытия оплаты состав не меняется. Сначала требуется безопасно завершить платёжный сценарий.",
      );
    const reason = text(patch.note, 1000, true),
      catalog = await this.getCatalog();
    const proposed = normalizeOrder(
      catalog,
      {
        ...patch.order,
        customer: row.data.customer,
        recipient: patch.order?.recipient || row.data.recipient,
        consent: true,
      },
      { id: Number(row.user_id) },
      this.clock(),
    );
    row.data.pendingRevision = {
      items: proposed.items,
      total: proposed.total,
      totalKopecks: proposed.totalKopecks,
      store: proposed.store,
      schedule: proposed.schedule,
      fulfilment: proposed.fulfilment,
      recipient: proposed.recipient,
      reason,
      proposedAt: this.clock().toISOString(),
    };
    await this.db.atomic(
      "EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?) AND NOT EXISTS(SELECT 1 FROM payments WHERE order_id=?)",
      [id, row.version, id],
      [
        ...this.changes(
          row,
          row.status,
          `operator:${user.id}`,
          "Предложены изменения заказа; ожидается согласие клиента.",
        ),
        ...this.enqueue(
          `revision:${id}:${row.version}`,
          row.user_id,
          `Заказ ${id}: оператор предложил изменения. Проверьте состав и стоимость в приложении.`,
          this.config.origin + "/#orders",
        ),
      ],
    );
    return this.read(id, user, true);
  }
  async acceptRevision(id, patch, user) {
    const row = await this.row(id);
    if (row.user_id !== String(user.id))
      fail(404, "NOT_FOUND", "Заказ не найден.");
    this.checkVersion(row, patch.expectedVersion);
    if (
      !row.data.pendingRevision ||
      !["WAITING_CONFIRMATION", "CONFIRMED"].includes(row.status)
    )
      fail(409, "NO_REVISION", "Изменения отсутствуют.");
    if (
      await this.db.first("SELECT order_id FROM payments WHERE order_id=?", [
        id,
      ])
    )
      fail(409, "PAYMENT_LOCKED", "Платёж уже создан.");
    const pending = row.data.pendingRevision,
      previous = {
        items: orderItems(row.data),
        total: row.data.total,
        schedule: row.data.schedule,
        store: row.data.store,
        revision: row.data.revision || 1,
        at: this.clock().toISOString(),
      };
    row.data = {
      ...row.data,
      ...pending,
      ...pending.items[0],
      items: pending.items,
      total: pending.total,
      totalKopecks: pending.totalKopecks,
      revision: (row.data.revision || 1) + 1,
      revisionHistory: [...(row.data.revisionHistory || []), previous],
    };
    delete row.data.pendingRevision;
    delete row.data.reason;
    delete row.data.proposedAt;
    row.store_id = row.data.store.id;
    const sv = await this.availability(row);
    await this.db.atomic(
      "EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?) AND NOT EXISTS(SELECT 1 FROM payments WHERE order_id=?) AND EXISTS(SELECT 1 FROM stores WHERE id=? AND version=?)",
      [id, row.version, id, row.store_id, sv],
      [
        [
          "UPDATE orders SET total_kopecks=?,store_id=? WHERE id=?",
          [pending.totalKopecks, row.store_id, id],
        ],
        ...this.changes(
          row,
          "WAITING_CONFIRMATION",
          `customer:${user.id}`,
          "Клиент согласовал состав, стоимость и получение. Ожидается подтверждение оператора.",
        ),
      ],
    );
    return this.read(id, user);
  }
  async resendPayment(id, user) {
    const row = await this.row(id),
      payment = await this.db.first("SELECT * FROM payments WHERE order_id=?", [
        id,
      ]);
    if (
      row.status !== "PAYMENT_PENDING" ||
      payment?.status !== "PENDING" ||
      !payment.url
    )
      fail(409, "NO_PAYMENT", "Ссылка оплаты недоступна.");
    await this.checkPayable(row, payment); // Verified webhook remains the only source of PAID.
    await this.db.atomic(
      "EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?)",
      [id, row.version],
      this.enqueue(
        `resend:${id}:${crypto.randomUUID()}`,
        row.user_id,
        `Заказ ${id}: ссылка на оплату доступна в приложении.`,
        this.config.origin + "/#orders",
      ),
    );
    return this.read(id, user, true);
  }
  async createPayment(id, user) {
    if (!this.provider.enabled())
      fail(503, "PAYMENT_NOT_CONFIGURED", "Яндекс Пэй ещё не подключён.");
    let row = await this.row(id),
      payment = await this.db.first("SELECT * FROM payments WHERE order_id=?", [
        id,
      ]);
    if (row.data.pendingRevision)
      fail(
        409,
        "REVISION_PENDING",
        "Сначала дождитесь согласия покупателя на изменения.",
      );
    if (!payment) {
      if (row.status !== "CONFIRMED")
        fail(409, "CONFIRM_FIRST", "Сначала подтвердите заказ.");
      const sv = await this.availability(row);
      payment = {
        order_id: id,
        request_id: crypto.randomUUID(),
        request_body: j(paymentBody(row.data, this.config)),
        status: "CREATING",
        url: "",
        created_at: this.clock().toISOString(),
      };
      try {
        await this.db.atomic(
          "EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM stores WHERE id=? AND version=?)",
          [id, row.version, row.store_id, sv],
          [
            [
              "INSERT INTO payments(order_id,request_id,status,request_body,created_at) VALUES(?,?,?,?,?)",
              [
                id,
                payment.request_id,
                payment.status,
                payment.request_body,
                payment.created_at,
              ],
            ],
            ...this.changes(
              row,
              "PAYMENT_PENDING",
              `operator:${user.id}`,
              "Запрошена оплата через Яндекс Пэй.",
            ),
          ],
        );
      } catch (e) {
        const concurrent = await this.db.first(
          "SELECT * FROM payments WHERE order_id=?",
          [id],
        );
        row = await this.row(id);
        if (
          !concurrent ||
          row.status !== "PAYMENT_PENDING" ||
          !["CREATING", "PENDING"].includes(concurrent.status)
        )
          throw e;
        payment = concurrent;
      }
    } else if (
      row.status !== "PAYMENT_PENDING" ||
      !["CREATING", "PENDING"].includes(payment.status)
    )
      fail(409, "PAYMENT_EXISTS", "Повторный платёж запрещён.");
    if (paymentExpiry(payment) <= this.clock().getTime())
      await this.checkPayable(row, payment);
    if (payment.url) return this.read(id, user, true);
    const url = await this.provider.create(
      JSON.parse(payment.request_body),
      payment.request_id,
    );
    row = await this.row(id);
    const current = await this.db.first(
      "SELECT status FROM payments WHERE order_id=?",
      [id],
    );
    if (row.status === "PAYMENT_PENDING" && current.status === "CREATING") {
      try {
        await this.db.atomic(
          "EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM payments WHERE order_id=? AND status='CREATING')",
          [id, row.version, id],
          [
            [
              "UPDATE payments SET url=?,status='PENDING',updated_at=? WHERE order_id=?",
              [url, this.clock().toISOString(), id],
            ],
            [
              "UPDATE orders SET version=version+1,updated_at=? WHERE id=?",
              [this.clock().toISOString(), id],
            ],
            ...this.enqueue(
              `payment-link:${id}`,
              row.user_id,
              `Заказ ${id} подтверждён. Сумма ${row.data.total} ₽. Оплата доступна в приложении.`,
              this.config.origin + "/#orders",
            ),
          ],
        );
      } catch (e) {
        const settled = await this.db.first(
          "SELECT request_id,status FROM payments WHERE order_id=?",
          [id],
        );
        if (
          settled?.request_id !== payment.request_id ||
          settled.status === "CREATING"
        )
          throw e;
      }
    }
    return this.read(id, user, true);
  }
  async checkPayable(row, payment) {
    const remote = await this.remote(row.id, row);
    if (!["PENDING", "NEW"].includes(remote.paymentStatus))
      fail(
        409,
        "PAYMENT_RECONCILING",
        "Состояние оплаты изменилось. Ожидается подтверждённое уведомление Яндекс Пэй.",
      );
    if (paymentExpiry(payment) <= this.clock().getTime())
      fail(
        409,
        "PAYMENT_LINK_EXPIRED",
        "Срок ссылки истёк. Платёж проверен; сначала завершите прежний платёжный сценарий в Яндекс Пэй. Новое списание автоматически не создаётся.",
      );
  }
  async remote(id, row) {
    const remote = await this.provider.get(id);
    if (
      typeof remote?.paymentStatus !== "string" ||
      remote.orderId !== id ||
      remote.merchantId !== this.config.merchantId ||
      remote.currencyCode !== "RUB" ||
      amountKopecks(remote.orderAmount) !== row.total_kopecks
    )
      fail(409, "PAYMENT_MISMATCH", "Данные платежа не совпадают с заказом.");
    return remote;
  }
  // Operator polling is deliberately read-only. It cannot turn a payment into PAID.
  async reconcile(id) {
    const row = await this.row(id);
    if (
      !(await this.db.first("SELECT order_id FROM payments WHERE order_id=?", [
        id,
      ]))
    )
      fail(409, "NO_PAYMENT", "Платёж не создан.");
    return {
      providerStatus: (await this.remote(id, row)).paymentStatus,
      awaitingVerifiedWebhook: true,
    };
  }
  async webhook(token) {
    const { event, proofHash } = await this.provider.verify(token);
    if (
      !["ORDER_STATUS_UPDATED", "OPERATION_STATUS_UPDATED"].includes(
        event.event,
      )
    )
      return;
    const id = event.order?.orderId || event.operation?.orderId;
    if (!/^DB-[A-F0-9]{16}$/.test(id || ""))
      fail(400, "INVALID_EVENT", "Некорректное уведомление.");
    if (
      event.order?.orderId &&
      event.operation?.orderId &&
      event.order.orderId !== event.operation.orderId
    )
      fail(400, "INVALID_EVENT", "Некорректное уведомление.");
    const identity = event.operation
      ? {
          merchantId: event.merchantId,
          event: event.event,
          orderId: id,
          operationId: event.operation.operationId,
          status: event.operation.status,
          operationType: event.operation.operationType,
        }
      : {
          merchantId: event.merchantId,
          event: event.event,
          orderId: id,
          status: event.order?.paymentStatus,
          eventTime: event.eventTime,
        };
    const key = "yandex:" + (await sha256(j(canonical(identity))));
    if (
      await this.db.first(
        "SELECT event_key FROM webhook_events WHERE event_key=?",
        [key],
      )
    )
      return;
    const row = await this.row(id),
      payment = await this.db.first("SELECT * FROM payments WHERE order_id=?", [
        id,
      ]);
    if (!payment) fail(409, "NO_PAYMENT", "Платёж не создан.");
    const remote = await this.remote(id, row),
      status = remote.paymentStatus;
    if (
      event.order?.orderAmount !== undefined &&
      amountKopecks(event.order.orderAmount) !== row.total_kopecks
    )
      fail(409, "PAYMENT_MISMATCH", "Сумма уведомления не совпадает.");
    const proof = [
      "INSERT INTO webhook_events(event_key,provider,order_id,payment_status,amount_kopecks,proof_hash) VALUES(?,?,?,?,?,?)",
      [key, "yandex-pay", id, status, row.total_kopecks, proofHash],
    ];
    const statements = [proof];
    const downgrade =
      payment.status === "REFUNDED" ||
      (payment.status === "CAPTURED" &&
        !["REFUNDED", "PARTIALLY_REFUNDED"].includes(status)) ||
      (payment.status === "PARTIALLY_REFUNDED" && status !== "REFUNDED");
    const capturedEvent =
      event.event === "ORDER_STATUS_UPDATED" &&
      event.order?.paymentStatus === "CAPTURED";
    if (
      !downgrade &&
      payment.status !== status &&
      (status !== "CAPTURED" || capturedEvent)
    ) {
      statements.push([
        "UPDATE payments SET status=?,updated_at=? WHERE order_id=?",
        [status, this.clock().toISOString(), id],
      ]);
      let next = null,
        note = "";
      if (status === "CAPTURED" && row.status === "PAYMENT_PENDING") {
        next = "PAID";
        note = "Оплата подтверждена Яндекс Пэй.";
      } else if (
        status === "CAPTURED" &&
        ["CANCELLED", "EXPIRED_UNCLAIMED"].includes(row.status)
      ) {
        next = "REFUND_PENDING";
        note = "Получена оплата отменённого заказа; требуется сверка.";
      } else if (status === "REFUNDED") {
        next = "REFUNDED";
        note = "Яндекс Пэй подтвердил полный возврат.";
      } else if (
        ["FAILED", "VOIDED"].includes(status) &&
        row.status === "PAYMENT_PENDING"
      ) {
        next = "CANCELLED";
        note = "Платёж не завершён.";
      } else if (status === "PARTIALLY_REFUNDED") {
        next = "REFUND_PENDING";
        note = "Подтверждён частичный возврат; требуется сверка.";
      }
      if (next)
        statements.push(
          ...this.changes(
            row,
            next,
            "yandex-pay",
            note,
            next === "PAID" ? key : null,
          ),
        );
      else
        statements.push([
          "UPDATE orders SET version=version+1,updated_at=? WHERE id=?",
          [this.clock().toISOString(), id],
        ]);
    }
    try {
      await this.db.atomic(
        "EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?) AND NOT EXISTS(SELECT 1 FROM webhook_events WHERE event_key=?)",
        [id, row.version, key],
        statements,
      );
    } catch (e) {
      if (
        await this.db.first(
          "SELECT event_key FROM webhook_events WHERE event_key=?",
          [key],
        )
      )
        return;
      throw e;
    }
  }
  async expire() {
    const rows = await this.db.all(
      "SELECT * FROM orders WHERE status IN ('READY','COURIER_ORDERED') AND hold_until<=? ORDER BY hold_until LIMIT 2",
      [this.clock().toISOString()],
    );
    for (const r of rows) {
      const row = parseRow(r);
      try {
        await this.db.atomic(
          "EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?)",
          [row.id, row.version],
          this.changes(
            row,
            "EXPIRED_UNCLAIMED",
            "system",
            "Срок хранения истёк.",
          ),
        );
      } catch (e) {
        if (e.code !== "STALE_ORDER") throw e;
      }
    }
    return rows.length;
  }
  async updateStore(id, patch, user) {
    const row = await this.db.first("SELECT * FROM stores WHERE id=?", [id]);
    if (!row) fail(404, "NOT_FOUND", "Точка не найдена.");
    this.checkVersion(row, patch.expectedVersion);
    const old = JSON.parse(row.settings),
      next = { ...old };
    for (const field of ["name", "shortName", "address", "hours"])
      if (patch[field] !== undefined)
        next[field] = text(
          patch[field],
          field === "address" || field === "note" ? 500 : 120,
          true,
        );
    for (const field of ["openTime", "closeTime"])
      if (patch[field] !== undefined) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch[field]))
          fail(400, "INVALID_HOURS", "Проверьте время работы.");
        next[field] = patch[field];
      }
    if (patch.mapsUrl !== undefined) {
      let u;
      try {
        u = new URL(patch.mapsUrl);
      } catch {}
      if (
        !u ||
        u.protocol !== "https:" ||
        ![
          "yandex.ru",
          "yandex.com",
          "yandex.eu",
          "yandex.by",
          "yandex.kz",
          "yandex.uz",
          "maps.yandex.ru",
        ].includes(u.hostname)
      )
        fail(400, "INVALID_MAP", "Укажите подтверждённую ссылку на карту.");
      next.mapsUrl = u.href;
    }
    if (patch.dateOverrides !== undefined) {
      if (
        !patch.dateOverrides ||
        typeof patch.dateOverrides !== "object" ||
        Array.isArray(patch.dateOverrides) ||
        Object.keys(patch.dateOverrides).length > 366
      )
        fail(400, "INVALID_HOURS", "Проверьте праздничное расписание.");
      for (const [d, v] of Object.entries(patch.dateOverrides)) {
        if (
          !validDate(d) ||
          !v ||
          typeof v !== "object" ||
          (!v.closed &&
            (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.openTime || "") ||
              !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.closeTime || "") ||
              v.openTime >= v.closeTime))
        )
          fail(400, "INVALID_HOURS", "Проверьте праздничное расписание.");
      }
      next.dateOverrides = patch.dateOverrides;
    }
    if (next.openTime >= next.closeTime)
      fail(400, "INVALID_HOURS", "Время закрытия должно быть позже открытия.");
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== "boolean")
        fail(400, "INVALID_ENABLED", "Некорректное состояние точки.");
      next.enabled = patch.enabled;
    }
    if (patch.stopList !== undefined) {
      const variants = new Set(
        this.catalog.products.flatMap((p) => p.variants.map((v) => v.id)),
      );
      if (
        !Array.isArray(patch.stopList) ||
        patch.stopList.length > variants.size ||
        patch.stopList.some((id) => !variants.has(id))
      )
        fail(400, "INVALID_STOP_LIST", "Проверьте стоп-лист.");
      next.stopList = [...new Set(patch.stopList)];
    }
    await this.db.atomic(
      "EXISTS(SELECT 1 FROM stores WHERE id=? AND version=?)",
      [id, row.version],
      [
        [
          "UPDATE stores SET settings=?,version=version+1 WHERE id=?",
          [j(next), id],
        ],
        [
          "INSERT INTO audit_events(actor,action,data) VALUES(?,?,?)",
          [
            `operator:${user.id}`,
            "store.update",
            j({ id, previous: old, next }),
          ],
        ],
      ],
    );
    return { ...next, settingsVersion: row.version + 1 };
  }
}
