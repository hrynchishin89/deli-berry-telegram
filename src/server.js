const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const store = require('./store/jsonStore');
const { buildOrderFromPayload, validateOrder } = require('./orderUtils');
const { validateTelegramInitData, parseTelegramUserFromInitData } = require('./security/telegramAuth');
const { sendOrderToGoogleSheets } = require('./integrations/googleSheets');
const { startBot, notifyManagers, notifyCustomer, configureTelegram, appUrl, getManagerChatId } = require('./telegramBot');
const { formatOrderForCustomer, formatStatusForCustomer } = require('./telegram/formatters');
const { printStartupReport } = require('./startupCheck');

const app = express();
app.set('trust proxy', true);

function cleanUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function requestBaseUrl(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'https';
  return cleanUrl(`${proto}://${req.get('host')}`);
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'webapp'), { extensions: ['html'] }));

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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'deli-berry-telegram-ready',
    time: new Date().toISOString(),
    readiness: {
      botToken: Boolean(config.botToken),
      webAppUrl: Boolean(config.webAppUrl),
      managerChatId: Boolean(config.managerChatId),
      googleSheets: Boolean(config.googleSheetsWebhookUrl),
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
      adminPinDefault: config.adminPin === 'change-me'
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/setup/telegram', requireAdminPin, async (req, res, next) => {
  try {
    const explicit = cleanUrl(req.body?.webAppUrl || req.query.webAppUrl || '');
    const webAppUrl = explicit || requestBaseUrl(req);
    if (!/^https:\/\//i.test(webAppUrl)) {
      return res.status(400).json({ ok: false, error: 'Для Telegram Mini App нужна публичная HTTPS-ссылка. Загрузите проект на хостинг с HTTPS и откройте /setup.html там.' });
    }
    await store.updateSettings({
      webAppUrl,
      publicUrl: webAppUrl,
      webAppConfiguredAt: new Date().toISOString()
    });
    const telegram = await configureTelegram();
    res.json({ ok: true, webAppUrl, telegram });
  } catch (error) {
    next(error);
  }
});

app.get('/api/catalog', async (_req, res, next) => {
  try {
    const bundle = await store.getCatalogBundle();
    res.json({ ok: true, ...bundle });
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', async (req, res, next) => {
  try {
    const payload = req.body || {};
    const initData = String(payload.initData || '');
    let telegramUser = payload.telegramUser || null;

    if (initData) {
      const isValid = validateTelegramInitData(initData, config.botToken);
      if (!isValid && config.requireTelegramAuth) {
        return res.status(401).json({ ok: false, errors: ['Telegram-сессия не прошла проверку. Откройте заказ из Telegram-бота.'] });
      }
      if (isValid) telegramUser = parseTelegramUserFromInitData(initData) || telegramUser;
    } else if (config.requireTelegramAuth) {
      return res.status(401).json({ ok: false, errors: ['Откройте приложение из Telegram-бота.'] });
    }

    const bundle = await store.getCatalogBundle();
    const promocodes = await store.getPromocodes();
    const order = buildOrderFromPayload({ ...payload, telegramUser }, bundle, promocodes);
    const errors = validateOrder(order);
    if (errors.length) return res.status(400).json({ ok: false, errors });

    await store.addOrder(order);
    const telegramResult = await notifyManagers(order);
    const sheetsResult = await sendOrderToGoogleSheets(order);
    await notifyCustomer(order, formatOrderForCustomer(order));

    res.status(201).json({
      ok: true,
      orderId: order.id,
      status: order.status,
      total: order.total,
      discount: order.discount,
      promoError: order.promoError,
      telegramResult,
      sheetsResult
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders/:id', async (req, res, next) => {
  try {
    const order = await store.getOrder(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'Заказ не найден' });
    res.json({ ok: true, order: { id: order.id, status: order.status, total: order.total, createdAt: order.createdAt } });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/orders', requireAdminPin, async (_req, res, next) => {
  try {
    const orders = await store.listOrders();
    res.json({ ok: true, orders });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/orders/:id/status', requireAdminPin, async (req, res, next) => {
  try {
    const status = String(req.body.status || '').trim();
    const order = await store.updateOrderStatus(req.params.id, status, { type: 'web-admin' });
    if (!order) return res.status(404).json({ ok: false, error: 'Заказ не найден' });
    await notifyCustomer(order, formatStatusForCustomer(order));
    res.json({ ok: true, order });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/export.csv', requireAdminPin, async (_req, res, next) => {
  try {
    const orders = await store.listOrders();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="deli-berry-orders.csv"');
    res.send(`\uFEFF${store.ordersToCsv(orders)}`);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера', details: config.nodeEnv === 'development' ? error.message : undefined });
});

app.listen(config.port, async () => {
  console.log(`Deli Berry app listening on port ${config.port}`);
  console.log(`Web App URL: ${config.webAppUrl || '(set WEBAPP_URL after deploy)'}`);
  printStartupReport();
  await startBot();
});
