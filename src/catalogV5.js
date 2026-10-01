const crypto = require('node:crypto');
const { verifyTelegramInitData } = require('./security/telegramAuth');
const shared = import('../miniapp/shared/order.mjs');
const catalog = import('../miniapp/shared/catalog.mjs');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function createCatalogV5Service({ store, config, notifyManagers, notifyCustomer, ready, bonusRules = () => ({ enabled: false }) }) {
  // The existing JSON store requires one server process. Serialize this route's writes.
  let queue = Promise.resolve();
  async function submit(payload) {
    const initData = typeof payload?.initData === 'string' ? payload.initData : '';
    if (initData.length > 16384) return unauthorized();
    const auth = verifyTelegramInitData(initData, config.botToken, config.telegramAuthMaxAgeSeconds);
    if (!auth.ok || !Number.isSafeInteger(auth.user?.id) || auth.user.id <= 0) return unauthorized();
    const run = queue.then(() => processOrder(payload, auth.user));
    queue = run.catch(() => {});
    return run;
  }

  async function processOrder(payload, user) {
    const { validateOrder, orderText } = await shared;
    const { catalogVersion, typeLabel } = await catalog;
    let priced;
    try { priced = validateOrder(payload); }
    catch (error) { return { status: 400, body: { ok: false, error: error.message } }; }
    const id = `DB5-${digest(`${user.id}:${priced.requestId}`).slice(0, 24).toUpperCase()}`;
    const requestHash = digest(JSON.stringify({ version: catalogVersion, items: priced.lines.map(l => ({ variantId: l.variantId, quantity: l.quantity, design: l.design, berry: l.berry, inscription: l.inscription })), point: priced.point.id, date: priced.date, time: priced.time, comment: priced.comment }));
    let saved = await store.getOrder(id);
    if (saved && saved.catalogRequestHash !== requestHash) {
      return { status: 409, body: { ok: false, error: 'Эта заявка уже отправлялась с другими данными. Сформируйте новую заявку.' } };
    }
    if (saved?.catalogDeliveredAt) return receipt(saved, 200);
    if (!(await ready())) return { status: 503, body: { ok: false, delivered: false, error: 'Приём заявок временно недоступен. Скопируйте заявку и свяжитесь с менеджером.' } };
    if (!saved) {
      const now = new Date().toISOString();
      const order = {
        id, createdAt: now, updatedAt: now, status: 'new', source: 'telegram-catalog-v5',
        catalogVersion, catalogRequestId: priced.requestId, catalogRequestHash: requestHash,
        catalogRequestText: orderText(priced),
        pointId: priced.point.id === 'discovery' ? 'dybenko' : 'rzhavki', point: priced.point,
        deliveryType: 'pickup', deliveryAddress: '', date: priced.date, time: priced.time, comment: priced.comment,
        telegramUser: { id: user.id, first_name: user.first_name || '', last_name: user.last_name || '', username: user.username || '' },
        customer: { name: [user.first_name, user.last_name].filter(Boolean).join(' ').slice(0, 120), phone: '' },
        items: priced.lines.map(l => ({
          id: l.family.id, variantId: l.variantId, variantLabel: typeLabel(l.variant.type), baseName: l.family.name,
          name: [l.family.name, typeLabel(l.variant.type), l.design ? `оформление ${l.design}` : 'крафтовая коробка',
            l.berry === 'included' ? 'ягодное украшение включено' : l.berry === 'blueberry' ? 'голубика +200 ₽' : l.berry === 'raspberry' ? 'малина +200 ₽' : '',
            l.inscription ? `надпись «${l.inscription}» +250 ₽` : ''].filter(Boolean).join(' · '),
          category: l.family.category, qty: l.quantity, unitPrice: l.unitPrice, subtotal: l.total,
          design: l.design, berry: l.berry, inscription: l.inscription, needsConfirmation: true
        })),
        totalBeforeDiscount: priced.total, discount: 0, total: priced.total,
        statusHistory: [{ status: 'new', at: now, actor: { type: 'telegram-mini-app' } }]
      };
      saved = (await store.createOrderWithCustomer(order, { telegramUser: order.telegramUser }, 0, bonusRules())).order;
    }
    const delivery = await notifyManagers(saved);
    if (!delivery?.ok) return { status: 503, body: { ok: false, delivered: false, orderId: saved.id, error: 'Передача менеджеру пока не подтверждена. Повторите отправку этой заявки.' } };
    saved = await store.updateOrder(saved.id, { catalogDeliveredAt: new Date().toISOString(), managerMessageId: delivery.messageId });
    // Bot notifications can be disabled by the customer. The HTTP receipt remains authoritative.
    void Promise.resolve().then(() => notifyCustomer(saved, `Дели Берри · заявка <b>${saved.id}</b> передана менеджеру.\nСумма выбранных товаров и дополнений: ${saved.total.toLocaleString('ru-RU')} ₽.\nВремя, оформление и полную стоимость согласуем перед оплатой.`)).catch(() => {});
    return receipt(saved, 201);
  }
  return { submit };
}

function unauthorized() {
  return { status: 401, body: { ok: false, error: 'Откройте каталог из Telegram-бота заново: сессия отсутствует или устарела.' } };
}
function receipt(order, status) {
  return { status, body: { ok: true, delivered: true, orderId: order.id, total: order.total, status: order.status } };
}

module.exports = { createCatalogV5Service };
