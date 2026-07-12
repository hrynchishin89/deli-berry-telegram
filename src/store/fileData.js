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

function mergeById(base = [], addons = []) {
  const map = new Map();
  for (const item of Array.isArray(base) ? base : []) {
    if (item && item.id) map.set(String(item.id), item);
  }
  for (const item of Array.isArray(addons) ? addons : []) {
    if (item && item.id) map.set(String(item.id), { ...(map.get(String(item.id)) || {}), ...item });
  }
  return Array.from(map.values()).filter((item) => Array.isArray(item.points) ? !item.points.includes('archive-2026') : true);
}

async function getCatalogBundle() {
  const [catalog, catalogAddons, categories, categoriesAddons, points, legal] = await Promise.all([
    readJson('catalog.json', []),
    readJson('catalog_addons.json', []),
    readJson('categories.json', []),
    readJson('categories_addons.json', []),
    readJson('points.json', []),
    readJson('legal.json', {})
  ]);
  return {
    catalog: mergeById(catalog, catalogAddons),
    categories: mergeById(categories, categoriesAddons),
    points,
    legal
  };
}

async function getPromocodes() {
  return readJson('promocodes.json', []);
}

function csvEscape(value) {
  const text = value === undefined || value === null ? '' : String(value);
  if (/[";\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function ordersToCsv(orders) {
  const headers = [
    'id', 'createdAt', 'status', 'customerId', 'point', 'deliveryType', 'name', 'phone',
    'address', 'date', 'time', 'total', 'bonusesUsed', 'cashTotal', 'bonusesEarned',
    'discount', 'promoCode', 'items', 'comment'
  ];
  const rows = orders.map((order) => [
    order.id,
    order.createdAt,
    order.status,
    order.customerPublicId || '',
    order.point?.name || order.pointId || '',
    order.deliveryType,
    order.customer?.name || '',
    order.customer?.phone || '',
    order.deliveryAddress || '',
    order.date || '',
    order.time || '',
    order.total || 0,
    order.bonusesUsed || 0,
    order.cashTotal ?? order.total ?? 0,
    order.bonusesEarned || order.bonusesEarnedPotential || 0,
    order.discount || 0,
    order.promoCode || '',
    (order.items || []).map((item) => `${item.name} x ${item.qty}`).join(' | '),
    order.comment || ''
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(';')).join('\n');
}

module.exports = {
  DATA_DIR,
  ensureDataDir,
  readJson,
  writeJson,
  mergeById,
  getCatalogBundle,
  getPromocodes,
  ordersToCsv
};
