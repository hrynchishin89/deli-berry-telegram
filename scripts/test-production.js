const fs = require('fs/promises');
const path = require('path');
const store = require('../src/store/jsonStore');
const { buildOrderFromPayload, validateOrder } = require('../src/orderUtils');
const { canTransition } = require('../src/statusRules');

const DATA_FILES = ['orders.json', 'customers.json', 'bonus_transactions.json'];

async function backup() {
  const saved = {};
  for (const file of DATA_FILES) {
    const full = path.join(store.DATA_DIR, file);
    saved[file] = await fs.readFile(full, 'utf8').catch(() => '[]\n');
  }
  return saved;
}
async function restore(saved) {
  for (const [file, content] of Object.entries(saved)) {
    await fs.writeFile(path.join(store.DATA_DIR, file), content, 'utf8');
  }
}
function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  const saved = await backup();
  try {
    await fs.writeFile(path.join(store.DATA_DIR, 'orders.json'), '[]\n');
    await fs.writeFile(path.join(store.DATA_DIR, 'customers.json'), '[]\n');
    await fs.writeFile(path.join(store.DATA_DIR, 'bonus_transactions.json'), '[]\n');
    await store.init();
    const bundle = await store.getCatalogBundle();
    const promos = await store.getPromocodes();
    assert(bundle.catalog.length > 100, 'Каталог слишком мал');
    assert(bundle.points.some((p) => p.id === 'dybenko'), 'Нет Дыбенко');
    assert(bundle.points.some((p) => p.id === 'rzhavki'), 'Нет Зеленопарка');
    const product = bundle.catalog.find((p) => p.id === 'dyb-classic-lemonade') || bundle.catalog.find((p) => p.points?.includes('dybenko') && p.variants?.length);
    assert(product, 'Нет тестового товара с вариантами');
    const variant = product.variants?.[0];
    const milkshake = bundle.catalog.find((p) => p.id === 'dyb-milkshake');
    assert(milkshake?.variants?.length, 'Нет милкшейка с объёмами');
    assert(milkshake?.options?.[0]?.values?.length, 'Нет выбора вкуса милкшейка');
    const missingChoiceOrder = buildOrderFromPayload({
      telegramUser: { id: '999000111' }, pointId: 'dybenko', deliveryType: 'pickup',
      customer: { name: 'Production Test', phone: '+79990001122' },
      date: new Date().toISOString().slice(0, 10), time: '15:00', legalAccepted: true,
      items: [{ id: milkshake.id, variantId: milkshake.variants[0].id, qty: 1 }]
    }, bundle, promos);
    assert(validateOrder(missingChoiceOrder).some((message) => message.includes('Выберите вкус')), 'Обязательный выбор вкуса не проверяется');
    const choiceOrder = buildOrderFromPayload({
      telegramUser: { id: '999000111' }, pointId: 'dybenko', deliveryType: 'pickup',
      customer: { name: 'Production Test', phone: '+79990001122' },
      date: new Date().toISOString().slice(0, 10), time: '15:00', legalAccepted: true,
      items: [{ id: milkshake.id, variantId: milkshake.variants[1].id, options: { [milkshake.options[0].id]: milkshake.options[0].values[0].id }, qty: 1 }]
    }, bundle, promos);
    assert(validateOrder(choiceOrder).length === 0, 'Заказ с выбранным вкусом не прошёл валидацию');
    assert(choiceOrder.items[0].name.includes(milkshake.options[0].values[0].label), 'Вкус не попал в название позиции');
    const payload = {
      telegramUser: { id: '999000111', first_name: 'Production Test', username: 'db_test' },
      pointId: 'dybenko', deliveryType: 'pickup',
      customer: { name: 'Production Test', phone: '+79990001122' },
      date: new Date().toISOString().slice(0, 10), time: '15:00', legalAccepted: true,
      items: [{ id: product.id, variantId: variant?.id || '', qty: 2 }]
    };
    const baseOrder = buildOrderFromPayload(payload, bundle, promos);
    assert(validateOrder(baseOrder).length === 0, 'Заказ не прошёл валидацию');
    const created = await store.createOrderWithCustomer(baseOrder, { telegramUser: payload.telegramUser }, 0, { enabled: true, earnPercent: 5, maxRedeemPercent: 30 });
    assert(created.order.customerPublicId === 'DB-000001', 'ID клиента не создан');
    assert(created.order.bonusesEarnedPotential > 0, 'Не рассчитано начисление');
    assert(canTransition('accepted', 'ready'), 'После подтверждения менеджер должен иметь возможность поставить «Заказ готов»'); // accepted -> ready
    let order = created.order;
    for (const status of ['accepted', 'paid', 'cooking', 'ready', 'done']) {
      assert(canTransition(order.status, status), `Недопустимый переход ${order.status} -> ${status}`);
      order = await store.transitionOrderStatus(order.id, status, { type: 'test' }, { enabled: true, earnPercent: 5, maxRedeemPercent: 30 });
    }
    let profile = await store.getCustomerProfile({ telegramUser: payload.telegramUser });
    assert(profile.customer.bonusBalance === order.bonusesEarned, 'Бонусы не начислены');
    assert(profile.customer.completedOrders === 1, 'Завершённый заказ не учтён');

    // Проверка списания с ограничением и автоматического возврата при отмене.
    const redeemOrderBase = buildOrderFromPayload(payload, bundle, promos);
    const redeemCreated = await store.createOrderWithCustomer(
      redeemOrderBase,
      { telegramUser: payload.telegramUser },
      999999,
      { enabled: true, earnPercent: 5, maxRedeemPercent: 30 }
    );
    assert(redeemCreated.order.bonusesUsed === profile.customer.bonusBalance, 'Списание не ограничилось балансом клиента');
    assert(redeemCreated.order.cashTotal === redeemCreated.order.total - redeemCreated.order.bonusesUsed, 'Неверная сумма после списания');
    let canceled = await store.transitionOrderStatus(redeemCreated.order.id, 'accepted', { type: 'test' }, { enabled: true, earnPercent: 5, maxRedeemPercent: 30 });
    canceled = await store.transitionOrderStatus(canceled.id, 'canceled', { type: 'test' }, { enabled: true, earnPercent: 5, maxRedeemPercent: 30 });
    assert(canceled.bonusRefunded, 'Бонусы не возвращены после отмены');
    profile = await store.getCustomerProfile({ telegramUser: payload.telegramUser });
    assert(profile.customer.bonusBalance === order.bonusesEarned, 'Баланс после возврата не восстановлен');

    // Проверка прямого сценария: подтверждён -> готов -> завершён.
    const quickOrderBase = buildOrderFromPayload(payload, bundle, promos);
    const quickCreated = await store.createOrderWithCustomer(
      quickOrderBase,
      { telegramUser: payload.telegramUser },
      0,
      { enabled: true, earnPercent: 5, maxRedeemPercent: 30 }
    );
    let quick = await store.transitionOrderStatus(quickCreated.order.id, 'accepted', { type: 'test' }, { enabled: true, earnPercent: 5, maxRedeemPercent: 30 });
    assert(canTransition(quick.status, 'ready'), 'Подтверждённый заказ нельзя сразу отметить готовым');
    quick = await store.transitionOrderStatus(quick.id, 'ready', { type: 'test' }, { enabled: true, earnPercent: 5, maxRedeemPercent: 30 });
    quick = await store.transitionOrderStatus(quick.id, 'done', { type: 'test' }, { enabled: true, earnPercent: 5, maxRedeemPercent: 30 });
    profile = await store.getCustomerProfile({ telegramUser: payload.telegramUser });
    assert(profile.customer.completedOrders === 2, 'Быстрый завершённый заказ не учтён');

    console.log(JSON.stringify({
      ok: true,
      catalog: bundle.catalog.length,
      categories: bundle.categories.length,
      customerId: profile.customer.publicId,
      firstOrderEarned: order.bonusesEarned,
      refundedOnCancel: canceled.bonusRefunded,
      directReadyFlow: quick.status === 'done',
      finalBalance: profile.customer.bonusBalance,
      status: quick.status
    }, null, 2));
  } finally {
    await restore(saved);
  }
})().catch((error) => { console.error(error); process.exit(1); });
