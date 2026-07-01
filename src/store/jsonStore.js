const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(fileName, fallback) {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, fileName);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw || JSON.stringify(fallback));
  } catch (error) {
    if (error.code === 'ENOENT') {
      await writeJson(fileName, fallback);
      return fallback;
    }
    throw error;
  }
}

async function writeJson(fileName, data) {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, fileName);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

async function getCatalogBundle() {
  const [catalog, categories, points, legal] = await Promise.all([
    readJson('catalog.json', []),
    readJson('categories.json', []),
    readJson('points.json', []),
    readJson('legal.json', {})
  ]);
  return { catalog, categories, points, legal };
}

async function getPromocodes() {
  return readJson('promocodes.json', []);
}

async function listOrders() {
  const orders = await readJson('orders.json', []);
  return orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function addOrder(order) {
  const orders = await readJson('orders.json', []);
  orders.push(order);
  await writeJson('orders.json', orders);
  await upsertCustomerFromOrder(order);
  return order;
}

async function getOrder(orderId) {
  const orders = await readJson('orders.json', []);
  return orders.find((order) => order.id === orderId) || null;
}

async function updateOrder(orderId, patch) {
  const orders = await readJson('orders.json', []);
  const index = orders.findIndex((order) => order.id === orderId);
  if (index === -1) return null;
  orders[index] = {
    ...orders[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await writeJson('orders.json', orders);
  return orders[index];
}

async function updateOrderStatus(orderId, status, actor = {}) {
  const order = await getOrder(orderId);
  if (!order) return null;
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  history.push({ status, at: new Date().toISOString(), actor });
  return updateOrder(orderId, { status, statusHistory: history });
}

async function upsertCustomerFromOrder(order) {
  const customers = await readJson('customers.json', []);
  const phone = order.customer && order.customer.phone ? String(order.customer.phone).trim() : '';
  const telegramId = order.telegramUser && order.telegramUser.id ? String(order.telegramUser.id) : '';
  if (!phone && !telegramId) return;
  const index = customers.findIndex((customer) =>
    (phone && customer.phone === phone) || (telegramId && String(customer.telegramId) === telegramId)
  );
  const base = {
    name: order.customer?.name || '',
    phone,
    telegramId,
    username: order.telegramUser?.username || '',
    lastOrderId: order.id,
    lastOrderAt: order.createdAt,
    ordersCount: 1
  };
  if (index === -1) {
    customers.push({ ...base, createdAt: new Date().toISOString() });
  } else {
    customers[index] = {
      ...customers[index],
      ...base,
      ordersCount: Number(customers[index].ordersCount || 0) + 1,
      updatedAt: new Date().toISOString()
    };
  }
  await writeJson('customers.json', customers);
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

function csvEscape(value) {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function ordersToCsv(orders) {
  const headers = [
    'id', 'createdAt', 'status', 'point', 'deliveryType', 'name', 'phone',
    'address', 'date', 'time', 'total', 'discount', 'promoCode', 'items', 'comment'
  ];
  const rows = orders.map((order) => [
    order.id,
    order.createdAt,
    order.status,
    order.point?.name || order.pointId || '',
    order.deliveryType,
    order.customer?.name || '',
    order.customer?.phone || '',
    order.deliveryAddress || '',
    order.date || '',
    order.time || '',
    order.total || 0,
    order.discount || 0,
    order.promoCode || '',
    (order.items || []).map((item) => `${item.name} x ${item.qty}`).join(' | '),
    order.comment || ''
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(';')).join('\n');
}

module.exports = {
  DATA_DIR,
  readJson,
  writeJson,
  getSettings,
  updateSettings,
  getCatalogBundle,
  getPromocodes,
  listOrders,
  addOrder,
  getOrder,
  updateOrder,
  updateOrderStatus,
  ordersToCsv
};
