const fileData = require('./fileData');

const { DATA_DIR, readJson, writeJson, getCatalogBundle, getPromocodes, ordersToCsv } = fileData;

function normalizeIdentity(identity = {}) {
  const tg = identity.telegramUser || identity;
  return {
    telegramId: tg?.id ? String(tg.id) : '',
    firstName: String(tg?.first_name || identity.firstName || '').trim(),
    lastName: String(tg?.last_name || identity.lastName || '').trim(),
    username: String(tg?.username || identity.username || '').trim(),
    phone: String(identity.phone || '').trim()
  };
}

function nextPublicId(customers) {
  const max = customers.reduce((current, customer) => {
    const number = Number(String(customer.publicId || '').replace(/^DB-/, ''));
    return Number.isFinite(number) ? Math.max(current, number) : current;
  }, 0);
  return `DB-${String(max + 1).padStart(6, '0')}`;
}

async function init() {
  await Promise.all([
    readJson('orders.json', []),
    readJson('customers.json', []),
    readJson('bonus_transactions.json', []),
    readJson('settings.json', {})
  ]);
  return { mode: 'json', persistent: false };
}

async function getSettings() {
  return readJson('settings.json', {});
}

async function updateSettings(patch) {
  const settings = await getSettings();
  const next = { ...settings, ...patch, updatedAt: new Date().toISOString() };
  await writeJson('settings.json', next);
  return next;
}

async function getOrCreateCustomer(identity = {}) {
  const normalized = normalizeIdentity(identity);
  if (!normalized.telegramId && !normalized.phone) return null;
  const customers = await readJson('customers.json', []);
  let index = customers.findIndex((customer) =>
    (normalized.telegramId && String(customer.telegramId || '') === normalized.telegramId) ||
    (normalized.phone && String(customer.phone || '') === normalized.phone)
  );
  const now = new Date().toISOString();
  if (index < 0) {
    const customer = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      publicId: nextPublicId(customers),
      telegramId: normalized.telegramId,
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      username: normalized.username,
      phone: normalized.phone,
      bonusBalance: 0,
      lifetimeSpend: 0,
      completedOrders: 0,
      createdAt: now,
      updatedAt: now
    };
    customers.push(customer);
    await writeJson('customers.json', customers);
    return customer;
  }
  customers[index] = {
    ...customers[index],
    telegramId: normalized.telegramId || customers[index].telegramId || '',
    firstName: normalized.firstName || customers[index].firstName || '',
    lastName: normalized.lastName || customers[index].lastName || '',
    username: normalized.username || customers[index].username || '',
    phone: normalized.phone || customers[index].phone || '',
    updatedAt: now
  };
  await writeJson('customers.json', customers);
  return customers[index];
}

async function saveCustomer(customer) {
  const customers = await readJson('customers.json', []);
  const index = customers.findIndex((item) => item.id === customer.id);
  if (index < 0) customers.push(customer);
  else customers[index] = customer;
  await writeJson('customers.json', customers);
  return customer;
}

async function addBonusTransaction({ customer, orderId = '', type, amount, note = '' }) {
  const transactions = await readJson('bonus_transactions.json', []);
  if (orderId && transactions.some((item) => item.orderId === orderId && item.type === type)) {
    return transactions.find((item) => item.orderId === orderId && item.type === type);
  }
  const transaction = {
    id: `bt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    customerId: customer.id,
    customerPublicId: customer.publicId,
    orderId,
    type,
    amount,
    balanceAfter: customer.bonusBalance,
    note,
    createdAt: new Date().toISOString()
  };
  transactions.push(transaction);
  await writeJson('bonus_transactions.json', transactions);
  return transaction;
}

async function createOrderWithCustomer(order, identity, bonusRequested = 0, rules = {}) {
  const customer = await getOrCreateCustomer({ ...identity, phone: order.customer?.phone || identity?.phone || '' });
  const earnPercent = Number(rules.earnPercent || 0);
  const maxRedeemPercent = Number(rules.maxRedeemPercent || 0);
  let bonusesUsed = 0;
  if (customer && rules.enabled !== false) {
    const requested = Math.max(0, Math.floor(Number(bonusRequested || 0)));
    const maxByOrder = Math.max(0, Math.floor(Number(order.total || 0) * maxRedeemPercent / 100));
    bonusesUsed = Math.min(requested, Number(customer.bonusBalance || 0), maxByOrder);
    if (bonusesUsed > 0) {
      customer.bonusBalance = Number(customer.bonusBalance || 0) - bonusesUsed;
      customer.updatedAt = new Date().toISOString();
      await saveCustomer(customer);
      await addBonusTransaction({
        customer,
        orderId: order.id,
        type: 'redeem',
        amount: -bonusesUsed,
        note: 'Бонусы зарезервированы для заказа'
      });
    }
  }

  const cashTotal = Math.max(0, Number(order.total || 0) - bonusesUsed);
  const potential = rules.enabled === false ? 0 : Math.max(0, Math.round(cashTotal * earnPercent / 100));
  const enriched = {
    ...order,
    customerDbId: customer?.id || '',
    customerPublicId: customer?.publicId || '',
    bonusBalanceBefore: customer ? Number(customer.bonusBalance || 0) + bonusesUsed : 0,
    bonusBalanceAfterReservation: customer ? Number(customer.bonusBalance || 0) : 0,
    bonusRequested: Math.max(0, Math.floor(Number(bonusRequested || 0))),
    bonusesUsed,
    cashTotal,
    bonusesEarnedPotential: potential,
    bonusesEarned: 0,
    bonusCredited: false,
    bonusRefunded: false
  };
  const orders = await readJson('orders.json', []);
  orders.push(enriched);
  await writeJson('orders.json', orders);
  return { order: enriched, customer };
}

async function listOrders() {
  const orders = await readJson('orders.json', []);
  return orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function addOrder(order) {
  const result = await createOrderWithCustomer(order, { telegramUser: order.telegramUser, phone: order.customer?.phone }, 0, { enabled: false });
  return result.order;
}

async function getOrder(orderId) {
  const orders = await readJson('orders.json', []);
  return orders.find((order) => order.id === orderId) || null;
}

async function updateOrder(orderId, patch) {
  const orders = await readJson('orders.json', []);
  const index = orders.findIndex((order) => order.id === orderId);
  if (index === -1) return null;
  orders[index] = { ...orders[index], ...patch, updatedAt: new Date().toISOString() };
  await writeJson('orders.json', orders);
  return orders[index];
}

async function transitionOrderStatus(orderId, status, actor = {}, rules = {}) {
  const orders = await readJson('orders.json', []);
  const orderIndex = orders.findIndex((order) => order.id === orderId);
  if (orderIndex < 0) return null;
  const order = orders[orderIndex];
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const updated = {
    ...order,
    status,
    statusHistory: [...history, { status, at: new Date().toISOString(), actor }],
    updatedAt: new Date().toISOString()
  };

  if (status === 'paid' && !updated.paidAt) updated.paidAt = new Date().toISOString();

  if (status === 'canceled' && updated.bonusesUsed > 0 && !updated.bonusRefunded && updated.customerDbId) {
    const customers = await readJson('customers.json', []);
    const customerIndex = customers.findIndex((customer) => customer.id === updated.customerDbId);
    if (customerIndex >= 0) {
      customers[customerIndex].bonusBalance = Number(customers[customerIndex].bonusBalance || 0) + Number(updated.bonusesUsed || 0);
      customers[customerIndex].updatedAt = new Date().toISOString();
      await writeJson('customers.json', customers);
      await addBonusTransaction({
        customer: customers[customerIndex],
        orderId,
        type: 'refund',
        amount: Number(updated.bonusesUsed || 0),
        note: 'Возврат бонусов после отмены заказа'
      });
      updated.bonusRefunded = true;
      updated.bonusBalanceAfter = customers[customerIndex].bonusBalance;
    }
  }

  if (status === 'done' && !updated.bonusCredited && updated.customerDbId && rules.enabled !== false) {
    const customers = await readJson('customers.json', []);
    const customerIndex = customers.findIndex((customer) => customer.id === updated.customerDbId);
    if (customerIndex >= 0) {
      const earned = Math.max(0, Number(updated.bonusesEarnedPotential || Math.round(Number(updated.cashTotal || updated.total || 0) * Number(rules.earnPercent || 0) / 100)));
      customers[customerIndex].bonusBalance = Number(customers[customerIndex].bonusBalance || 0) + earned;
      customers[customerIndex].lifetimeSpend = Number(customers[customerIndex].lifetimeSpend || 0) + Number(updated.total || 0);
      customers[customerIndex].completedOrders = Number(customers[customerIndex].completedOrders || 0) + 1;
      customers[customerIndex].updatedAt = new Date().toISOString();
      await writeJson('customers.json', customers);
      if (earned > 0) {
        await addBonusTransaction({
          customer: customers[customerIndex],
          orderId,
          type: 'earn',
          amount: earned,
          note: `Начисление ${Number(rules.earnPercent || 0)}% за завершённый заказ`
        });
      }
      updated.bonusesEarned = earned;
      updated.bonusCredited = true;
      updated.bonusBalanceAfter = customers[customerIndex].bonusBalance;
    }
  }

  orders[orderIndex] = updated;
  await writeJson('orders.json', orders);
  return updated;
}

async function updateOrderStatus(orderId, status, actor = {}) {
  return transitionOrderStatus(orderId, status, actor, { enabled: false, earnPercent: 0 });
}

async function getCustomerProfile(identity = {}) {
  const customer = await getOrCreateCustomer(identity);
  if (!customer) return null;
  const [transactions, orders] = await Promise.all([
    readJson('bonus_transactions.json', []),
    readJson('orders.json', [])
  ]);
  return {
    customer,
    transactions: transactions
      .filter((item) => item.customerId === customer.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 30),
    orders: orders
      .filter((item) => item.customerDbId === customer.id || (customer.telegramId && String(item.telegramUser?.id || '') === customer.telegramId))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 15)
  };
}

async function listCustomers() {
  const customers = await readJson('customers.json', []);
  return customers.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
}

async function adjustCustomerBonus(publicId, amount, note = 'Ручная корректировка') {
  const customers = await readJson('customers.json', []);
  const index = customers.findIndex((customer) => customer.publicId === publicId);
  if (index < 0) return null;
  const delta = Math.trunc(Number(amount || 0));
  customers[index].bonusBalance = Math.max(0, Number(customers[index].bonusBalance || 0) + delta);
  customers[index].updatedAt = new Date().toISOString();
  await writeJson('customers.json', customers);
  await addBonusTransaction({ customer: customers[index], type: 'manual', amount: delta, note });
  return customers[index];
}

module.exports = {
  mode: 'json',
  persistent: false,
  DATA_DIR,
  init,
  getSettings,
  updateSettings,
  getCatalogBundle,
  getPromocodes,
  listOrders,
  addOrder,
  createOrderWithCustomer,
  getOrder,
  updateOrder,
  updateOrderStatus,
  transitionOrderStatus,
  getOrCreateCustomer,
  getCustomerProfile,
  listCustomers,
  adjustCustomerBonus,
  ordersToCsv
};
