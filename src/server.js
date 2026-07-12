const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const store = require('./store');
const fileData = require('./store/fileData');
const githubCms = require('./githubCms');
const { buildOrderFromPayload, validateOrder } = require('./orderUtils');
const { verifyTelegramInitData } = require('./security/telegramAuth');
const { sendOrderToGoogleSheets } = require('./integrations/googleSheets');
const { startBot, notifyManagers, notifyCustomer, configureTelegram, appUrl, getManagerChatId } = require('./telegramBot');
const { formatOrderForCustomer, formatStatusForCustomer } = require('./telegram/formatters');
const { canTransition, transitionError } = require('./statusRules');
const { printStartupReport } = require('./startupCheck');

const app = express();
app.set('trust proxy', 1);

function cleanUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function requestBaseUrl(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'https';
  return cleanUrl(`${proto}://${req.get('host')}`);
}

function bonusRules() {
  return {
    enabled: config.bonusEnabled,
    earnPercent: config.bonusEarnPercent,
    maxRedeemPercent: config.bonusMaxRedeemPercent,
    rublesPerPoint: config.bonusRublesPerPoint
  };
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  xFrameOptions: false
}));
app.use((_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'webapp'), { extensions: ['html'], etag: true, maxAge: config.nodeEnv === 'production' ? '10m' : 0 }));

const orderLimiter = rateLimit({
  windowMs: config.orderRateLimitWindowMs,
  limit: config.orderRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, errors: ['Слишком много запросов. Подождите минуту и попробуйте снова.'] }
});
const profileLimiter = rateLimit({
  windowMs: 60000,
  limit: config.profileRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});

function requireAdminPin(req, res, next) {
  const pin = req.query.pin || req.headers['x-admin-pin'];
  if (!config.adminPin || config.adminPin === 'change-me') {
    return res.status(403).json({ ok: false, error: 'ADMIN_PIN не настроен. Поменяйте ADMIN_PIN в переменных окружения.' });
  }
  if (String(pin) !== String(config.adminPin)) {
    return res.status(401).json({ ok: false, error: 'Неверный PIN' });
  }
  next();
}

function authenticateMiniApp(payload = {}, { required = config.requireTelegramAuth } = {}) {
  const initData = String(payload.initData || '');
  if (initData) {
    const verification = verifyTelegramInitData(initData, config.botToken, config.telegramAuthMaxAgeSeconds);
    if (verification.ok) return { ok: true, user: verification.user, verification };
    if (required) return { ok: false, error: 'Telegram-сессия не прошла проверку или устарела. Закройте Mini App и откройте заново.' };
  }
  if (required) return { ok: false, error: 'Откройте приложение из Telegram-бота.' };
  return { ok: true, user: payload.telegramUser || null, verification: null, insecureFallback: true };
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'deli-berry-production-1.0',
    version: '1.0.0',
    time: new Date().toISOString(),
    readiness: {
      botToken: Boolean(config.botToken),
      webAppUrl: Boolean(config.webAppUrl),
      managerChatId: Boolean(config.managerChatId),
      database: store.mode,
      persistentDatabase: Boolean(store.persistent),
      bonusEnabled: Boolean(config.bonusEnabled),
      telegramAuthRequired: Boolean(config.requireTelegramAuth)
    }
  });
});

app.get('/api/setup/status', requireAdminPin, async (_req, res, next) => {
  try {
    const settings = await store.getSettings();
    const managerChatId = await getManagerChatId();
    const currentAppUrl = await appUrl();
    res.json({
      ok: true,
      botTokenConfigured: Boolean(config.botToken),
      webAppUrl: currentAppUrl,
      webAppConfigured: Boolean(currentAppUrl),
      managerChatIdConfigured: Boolean(managerChatId),
      managerChatTitle: settings.managerChatTitle || '',
      botUsername: settings.botUsername || '',
      adminPinDefault: config.adminPin === 'change-me',
      databaseMode: store.mode,
      persistentDatabase: Boolean(store.persistent)
    });
  } catch (error) { next(error); }
});

app.post('/api/setup/telegram', requireAdminPin, async (req, res, next) => {
  try {
    const explicit = cleanUrl(req.body?.webAppUrl || req.query.webAppUrl || '');
    const webAppUrl = explicit || requestBaseUrl(req);
    if (!/^https:\/\//i.test(webAppUrl)) {
      return res.status(400).json({ ok: false, error: 'Для Telegram Mini App нужна публичная HTTPS-ссылка.' });
    }
    await store.updateSettings({ webAppUrl, publicUrl: webAppUrl, webAppConfiguredAt: new Date().toISOString() });
    const telegram = await configureTelegram();
    res.json({ ok: true, webAppUrl, telegram });
  } catch (error) { next(error); }
});

app.get('/api/catalog', async (_req, res, next) => {
  try {
    const bundle = await store.getCatalogBundle();
    res.json({ ok: true, ...bundle, bonusRules: bonusRules() });
  } catch (error) { next(error); }
});

app.post('/api/me', profileLimiter, async (req, res, next) => {
  try {
    const auth = authenticateMiniApp(req.body || {});
    if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });
    if (!auth.user?.id) return res.json({ ok: true, guest: true, profile: null, bonusRules: bonusRules() });
    const profile = await store.getCustomerProfile({ telegramUser: auth.user, phone: req.body?.phone || '' });
    res.json({ ok: true, profile, bonusRules: bonusRules(), persistentDatabase: Boolean(store.persistent) });
  } catch (error) { next(error); }
});

app.post('/api/orders', orderLimiter, async (req, res, next) => {
  try {
    const payload = req.body || {};
    const auth = authenticateMiniApp(payload);
    if (!auth.ok) return res.status(401).json({ ok: false, errors: [auth.error] });

    const telegramUser = auth.user || payload.telegramUser || null;
    const bundle = await store.getCatalogBundle();
    const promocodes = await store.getPromocodes();
    const order = buildOrderFromPayload({ ...payload, telegramUser }, bundle, promocodes);
    const errors = validateOrder(order);
    if (errors.length) return res.status(400).json({ ok: false, errors });

    const requestedBonus = Math.max(0, Math.floor(Number(payload.bonusRequested || 0)));
    const created = await store.createOrderWithCustomer(
      order,
      { telegramUser, phone: order.customer?.phone || '' },
      requestedBonus,
      bonusRules()
    );
    const savedOrder = created.order;
    const telegramResult = await notifyManagers(savedOrder);
    const sheetsResult = await sendOrderToGoogleSheets(savedOrder);
    await notifyCustomer(savedOrder, formatOrderForCustomer(savedOrder));

    res.status(201).json({
      ok: true,
      orderId: savedOrder.id,
      status: savedOrder.status,
      total: savedOrder.total,
      bonusesUsed: savedOrder.bonusesUsed || 0,
      cashTotal: savedOrder.cashTotal ?? savedOrder.total,
      bonusesEarnedPotential: savedOrder.bonusesEarnedPotential || 0,
      customerPublicId: savedOrder.customerPublicId || '',
      bonusBalance: savedOrder.bonusBalanceAfterReservation || 0,
      discount: savedOrder.discount,
      promoError: savedOrder.promoError,
      telegramResult,
      sheetsResult
    });
  } catch (error) { next(error); }
});

app.get('/api/orders/:id', async (req, res, next) => {
  try {
    const order = await store.getOrder(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'Заказ не найден' });
    res.json({
      ok: true,
      order: {
        id: order.id,
        status: order.status,
        total: order.total,
        cashTotal: order.cashTotal,
        bonusesUsed: order.bonusesUsed,
        bonusesEarned: order.bonusesEarned,
        createdAt: order.createdAt
      }
    });
  } catch (error) { next(error); }
});


function normalizeProductPatch(raw = {}) {
  const product = { ...raw };
  for (const field of ['id','name','priceText','unit','category','categoryName','description','composition','allergens','shelfLife','badge','emoji','image','cutout','stageImage']) {
    if (product[field] !== undefined) product[field] = String(product[field] || '').trim();
  }
  if (product.price !== undefined) product.price = Number(product.price || 0);
  if (product.points !== undefined) product.points = Array.isArray(product.points) ? product.points.map(String) : [];
  if (product.isHit !== undefined) product.isHit = Boolean(product.isHit);
  if (product.needsConfirmation !== undefined) product.needsConfirmation = Boolean(product.needsConfirmation);
  if (product.variants !== undefined) product.variants = Array.isArray(product.variants) ? product.variants : [];
  product.updatedAt = new Date().toISOString();
  return product;
}

function slugify(value) {
  const translit = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ы:'y',э:'e',ю:'yu',я:'ya',ь:'',ъ:''};
  return String(value || '').toLowerCase().split('').map((ch) => translit[ch] || ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || `product-${Date.now()}`;
}

async function persistCatalogAddons(addons, message) {
  await fileData.writeJson('catalog_addons.json', addons);
  return githubCms.commitJsonFile('data/catalog_addons.json', addons, message);
}

app.get('/api/admin/catalog', requireAdminPin, async (_req, res, next) => {
  try {
    const bundle = await store.getCatalogBundle();
    res.json({ ok: true, ...bundle, cms: githubCms.status() });
  } catch (error) { next(error); }
});

app.post('/api/admin/catalog/products', requireAdminPin, async (req, res, next) => {
  try {
    const addons = await fileData.readJson('catalog_addons.json', []);
    const bundle = await store.getCatalogBundle();
    const product = normalizeProductPatch(req.body.product || req.body || {});
    product.id = product.id || slugify(product.name || `product-${Date.now()}`);
    if (!product.name) return res.status(400).json({ ok: false, error: 'Название товара обязательно' });
    if (bundle.catalog.some((item) => item.id === product.id)) product.id = `${product.id}-${Date.now().toString(36)}`;
    if (!Array.isArray(product.points) || !product.points.length) product.points = ['dybenko', 'rzhavki'];
    product.source = product.source || 'catalog-admin';
    product.createdAt = new Date().toISOString();
    addons.unshift(product);
    const sync = await persistCatalogAddons(addons, `catalog: add ${product.name}`);
    res.status(201).json({ ok: true, product, sync });
  } catch (error) { next(error); }
});

app.put('/api/admin/catalog/products/:id', requireAdminPin, async (req, res, next) => {
  try {
    const addons = await fileData.readJson('catalog_addons.json', []);
    const bundle = await store.getCatalogBundle();
    const current = bundle.catalog.find((item) => item.id === req.params.id);
    if (!current) return res.status(404).json({ ok: false, error: 'Товар не найден' });
    const patch = normalizeProductPatch(req.body.product || req.body || {});
    delete patch.id;
    const override = { ...current, ...patch, id: current.id };
    const index = addons.findIndex((item) => item.id === current.id);
    if (index >= 0) addons[index] = override; else addons.unshift(override);
    const sync = await persistCatalogAddons(addons, `catalog: update ${override.name}`);
    res.json({ ok: true, product: override, sync });
  } catch (error) { next(error); }
});

app.delete('/api/admin/catalog/products/:id', requireAdminPin, async (req, res, next) => {
  try {
    const addons = await fileData.readJson('catalog_addons.json', []);
    const bundle = await store.getCatalogBundle();
    const current = bundle.catalog.find((item) => item.id === req.params.id);
    if (!current) return res.status(404).json({ ok: false, error: 'Товар не найден' });
    const override = { ...current, points: [], hiddenAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const index = addons.findIndex((item) => item.id === current.id);
    if (index >= 0) addons[index] = override; else addons.unshift(override);
    const sync = await persistCatalogAddons(addons, `catalog: hide ${override.name}`);
    res.json({ ok: true, product: override, sync });
  } catch (error) { next(error); }
});

app.post('/api/admin/catalog/products/:id/photo', requireAdminPin, async (req, res, next) => {
  try {
    const { dataUrl } = req.body || {};
    if (!dataUrl || !/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) {
      return res.status(400).json({ ok: false, error: 'Загрузите фото JPG, PNG или WEBP' });
    }
    const bundle = await store.getCatalogBundle();
    const current = bundle.catalog.find((item) => item.id === req.params.id);
    if (!current) return res.status(404).json({ ok: false, error: 'Товар не найден' });
    const extMatch = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,/i);
    const ext = extMatch[1].toLowerCase().includes('png') ? 'png' : extMatch[1].toLowerCase().includes('webp') ? 'webp' : 'jpg';
    const filename = `${slugify(req.body.filename?.replace(/\.[^.]+$/, '') || current.id)}.${ext}`;
    const buffer = Buffer.from(dataUrl.replace(/^data:image\/(png|jpe?g|webp);base64,/i, ''), 'base64');
    if (buffer.length > 6 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'Фото больше 6 МБ. Сожмите файл.' });
    const repoPath = `webapp/assets/products/${filename}`;
    const publicPath = `/assets/products/${filename}`;
    const imageSync = await githubCms.commitBinaryFile(repoPath, buffer, `photo: ${filename}`);
    if (!imageSync.configured) {
      const fs = require('fs/promises');
      const localPath = path.join(__dirname, '..', repoPath);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, buffer);
    }
    const addons = await fileData.readJson('catalog_addons.json', []);
    const override = { ...current, image: publicPath, updatedAt: new Date().toISOString() };
    const index = addons.findIndex((item) => item.id === current.id);
    if (index >= 0) addons[index] = override; else addons.unshift(override);
    const catalogSync = await persistCatalogAddons(addons, `catalog: photo ${override.name}`);
    res.json({ ok: true, product: override, image: publicPath, sync: { image: imageSync, catalog: catalogSync } });
  } catch (error) { next(error); }
});

app.get('/api/admin/orders', requireAdminPin, async (_req, res, next) => {
  try { res.json({ ok: true, orders: await store.listOrders() }); }
  catch (error) { next(error); }
});

app.post('/api/admin/orders/:id/status', requireAdminPin, async (req, res, next) => {
  try {
    const status = String(req.body.status || '').trim();
    const current = await store.getOrder(req.params.id);
    if (!current) return res.status(404).json({ ok: false, error: 'Заказ не найден' });
    if (!canTransition(current.status, status)) {
      return res.status(400).json({ ok: false, error: transitionError(current.status, status) });
    }
    const order = await store.transitionOrderStatus(req.params.id, status, { type: 'web-admin' }, bonusRules());
    await notifyCustomer(order, formatStatusForCustomer(order));
    res.json({ ok: true, order });
  } catch (error) { next(error); }
});

app.get('/api/admin/customers', requireAdminPin, async (_req, res, next) => {
  try { res.json({ ok: true, customers: await store.listCustomers() }); }
  catch (error) { next(error); }
});

app.post('/api/admin/customers/:publicId/bonus', requireAdminPin, async (req, res, next) => {
  try {
    const customer = await store.adjustCustomerBonus(req.params.publicId, req.body.amount, String(req.body.note || 'Ручная корректировка'));
    if (!customer) return res.status(404).json({ ok: false, error: 'Клиент не найден' });
    res.json({ ok: true, customer });
  } catch (error) { next(error); }
});

app.get('/api/admin/export.csv', requireAdminPin, async (_req, res, next) => {
  try {
    const orders = await store.listOrders();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="deli-berry-orders.csv"');
    res.send(`\uFEFF${store.ordersToCsv(orders)}`);
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    ok: false,
    error: 'Внутренняя ошибка сервера',
    details: config.nodeEnv === 'development' ? error.message : undefined
  });
});

async function main() {
  const storage = await store.init();
  console.log(`Storage initialized: ${storage.mode}; persistent=${storage.persistent}`);
  app.listen(config.port, async () => {
    console.log(`Deli Berry Production 1.0 listening on port ${config.port}`);
    console.log(`Web App URL: ${config.webAppUrl || '(set WEBAPP_URL after deploy)'}`);
    printStartupReport();
    await startBot();
  });
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
