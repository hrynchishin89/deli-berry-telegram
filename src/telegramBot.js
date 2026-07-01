const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const store = require('./store/jsonStore');
const {
  STATUS_LABELS,
  formatOrderForManager,
  formatOrderForCustomer,
  formatStatusForCustomer,
  statusKeyboard,
  escapeHtml
} = require('./telegram/formatters');

let bot = null;
let polling = false;
let updateOffset = 0;

async function runtimeSettings() {
  return store.getSettings().catch(() => ({}));
}

function cleanUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

async function appUrl() {
  const settings = await runtimeSettings();
  return cleanUrl(config.webAppUrl || config.publicUrl || settings.webAppUrl || settings.publicUrl || '');
}

async function getManagerChatId() {
  const settings = await runtimeSettings();
  return String(config.managerChatId || settings.managerChatId || '').trim();
}

function adminPinMatches(value) {
  if (!config.adminPin || config.adminPin === 'change-me') return true;
  return String(value || '').trim() === String(config.adminPin);
}

function apiUrl(method) {
  return `https://api.telegram.org/bot${config.botToken}/${method}`;
}

async function callApi(method, payload = {}) {
  if (!config.botToken) return null;
  const response = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }
  return data.result;
}

async function sendMessage(chatId, text, options = {}) {
  return callApi('sendMessage', { chat_id: chatId, text, ...options });
}

async function editMessageText(chatId, messageId, text, options = {}) {
  return callApi('editMessageText', { chat_id: chatId, message_id: messageId, text, ...options });
}

async function answerCallbackQuery(callbackQueryId, options = {}) {
  return callApi('answerCallbackQuery', { callback_query_id: callbackQueryId, ...options });
}

async function getUpdates() {
  return callApi('getUpdates', {
    offset: updateOffset,
    timeout: 25,
    allowed_updates: ['message', 'callback_query']
  });
}

async function sendDocument(chatId, filePath, filename) {
  const data = await fs.readFile(filePath);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([data], { type: 'text/csv' }), filename || path.basename(filePath));
  const response = await fetch(apiUrl('sendDocument'), { method: 'POST', body: form });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(json.description || 'sendDocument failed');
  return json.result;
}

async function buildOpenAppMarkup() {
  const url = await appUrl();
  const rows = [];
  if (url) rows.push([{ text: 'Открыть каталог 🍓', web_app: { url } }]);
  if (config.managerPublicUrl) rows.push([{ text: 'Связаться с менеджером', url: config.managerPublicUrl }]);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

async function sendWelcome(chatId) {
  const url = await appUrl();
  const text = [
    '🍓 <b>Deli Berry</b>',
    'Клубника в шоколаде, сладкие подарки, дубайский шоколад и десерты.',
    '',
    url
      ? 'Нажмите кнопку ниже, выберите точку, соберите корзину и отправьте заказ менеджеру.'
      : 'Каталог уже установлен на сервере. Осталось один раз открыть /setup.html после деплоя, чтобы привязать кнопку Telegram.',
    '',
    '⚠️ Наличие, цена и время приготовления подтверждаются менеджером.'
  ].join('\n');
  const replyMarkup = await buildOpenAppMarkup();
  await sendMessage(chatId, text, {
    parse_mode: 'HTML',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

async function isManagerChat(chatId) {
  const managerChatId = await getManagerChatId();
  return managerChatId && String(chatId) === String(managerChatId);
}

async function notifyManagers(order) {
  const managerChatId = await getManagerChatId();
  if (!bot || !managerChatId) return { skipped: true, reason: 'No bot or manager chat id' };
  try {
    const message = await sendMessage(managerChatId, formatOrderForManager(order), {
      parse_mode: 'HTML',
      reply_markup: statusKeyboard(order.id),
      disable_web_page_preview: true
    });
    await store.updateOrder(order.id, { managerMessageId: message.message_id });
    return { ok: true, messageId: message.message_id };
  } catch (error) {
    console.error('Telegram manager notify error:', error.message);
    return { ok: false, error: error.message };
  }
}

async function notifyCustomer(order, text) {
  if (!bot || !order.telegramUser?.id) return { skipped: true };
  try {
    await sendMessage(order.telegramUser.id, text, { parse_mode: 'HTML' });
    return { ok: true };
  } catch (error) {
    console.error('Telegram customer notify error:', error.message);
    return { ok: false, error: error.message };
  }
}

async function exportOrders(chatId) {
  const orders = await store.listOrders();
  const csv = store.ordersToCsv(orders);
  const filePath = path.join(store.DATA_DIR, `orders-export-${Date.now()}.csv`);
  await fs.writeFile(filePath, csv, 'utf8');
  await sendDocument(chatId, filePath, 'deli-berry-orders.csv');
  await fs.unlink(filePath).catch(() => null);
}

async function configureTelegram() {
  await callApi('deleteWebhook', { drop_pending_updates: false }).catch((error) => console.warn('deleteWebhook:', error.message));
  await callApi('setMyName', { name: config.businessName || 'Deli Berry' }).catch((error) => console.warn('setMyName:', error.message));
  await callApi('setMyDescription', {
    description: 'Deli Berry — клубника в шоколаде, сладкие подарки, десерты и напитки. Откройте каталог, выберите точку и отправьте заказ менеджеру.'
  }).catch((error) => console.warn('setMyDescription:', error.message));
  await callApi('setMyShortDescription', {
    short_description: 'Клубника в шоколаде и сладкие подарки в Telegram.'
  }).catch((error) => console.warn('setMyShortDescription:', error.message));
  await callApi('setMyCommands', {
    commands: [
      { command: 'start', description: 'Открыть главное меню' },
      { command: 'order', description: 'Открыть каталог' },
      { command: 'catalog', description: 'Открыть каталог' },
      { command: 'status', description: 'Проверить статус заказа' },
      { command: 'myid', description: 'Узнать свой Telegram ID' },
      { command: 'groupid', description: 'Узнать ID группы' },
      { command: 'manager', description: 'Назначить этот чат группой заказов' },
      { command: 'help', description: 'Помощь' }
    ]
  }).catch((error) => console.warn('setMyCommands:', error.message));

  const url = await appUrl();
  if (url && /^https:\/\//i.test(url)) {
    await callApi('setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Заказать 🍓', web_app: { url } }
    }).catch((error) => console.warn('setChatMenuButton:', error.message));
  }

  const me = await callApi('getMe').catch(() => null);
  if (me?.username) await store.updateSettings({ botUsername: me.username });
  return { url, username: me?.username || '' };
}

async function saveManagerChat(message) {
  const chatId = message.chat?.id;
  const existing = await getManagerChatId();
  const parts = String(message.text || '').trim().split(/\s+/);
  const possiblePin = parts[1];
  if (existing && String(existing) !== String(chatId) && !adminPinMatches(possiblePin)) {
    await sendMessage(chatId, 'Группа заказов уже назначена. Чтобы сменить её, напишите: /manager PIN_ИЗ_ФАЙЛА_ENV');
    return;
  }
  const title = message.chat?.title || message.from?.first_name || 'manager chat';
  await store.updateSettings({
    managerChatId: String(chatId),
    managerChatTitle: title,
    managerConfiguredAt: new Date().toISOString()
  });
  await sendMessage(chatId, [
    '✅ Готово: этот чат назначен группой заказов Deli Berry.',
    '',
    'Теперь новые заказы будут приходить сюда.',
    'Команды менеджера: /today, /export, /pay НОМЕР ССЫЛКА.'
  ].join('\n'));
}

async function saveSetupUrlCommand(message) {
  const chatId = message.chat?.id;
  const parts = String(message.text || '').trim().split(/\s+/).filter(Boolean);
  let url = '';

  if (config.adminPin && config.adminPin !== 'change-me') {
    const pin = parts[1];
    url = parts[2] || '';
    if (!adminPinMatches(pin)) {
      await sendMessage(chatId, 'PIN не подошёл. Проще: после деплоя откройте /setup.html и нажмите кнопку настройки.');
      return;
    }
  } else {
    url = parts[1] || '';
  }

  url = cleanUrl(url);
  if (!/^https:\/\//i.test(url)) {
    await sendMessage(chatId, 'Нужна HTTPS-ссылка. Формат: /setupurl PIN https://ваш-адрес');
    return;
  }
  await store.updateSettings({ webAppUrl: url, publicUrl: url, webAppConfiguredAt: new Date().toISOString() });
  await configureTelegram();
  await sendMessage(chatId, `✅ Кнопка Telegram Mini App настроена на:\n${escapeHtml(url)}`, { parse_mode: 'HTML' });
}

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const text = String(message.text || '').trim();
  if (!chatId || !text.startsWith('/')) return;

  if (/^\/start(?:\s|$)/.test(text) || /^\/(order|catalog)(?:\s|$)/.test(text)) {
    await sendWelcome(chatId);
    return;
  }

  if (/^\/help/.test(text)) {
    const help = [
      '<b>Команды Deli Berry</b>',
      '/start — открыть главное меню',
      '/order — открыть каталог',
      '/catalog — открыть каталог',
      '/status НОМЕР — проверить статус заказа',
      '/myid — узнать свой Telegram ID',
      '/groupid — узнать ID группы',
      '/manager — назначить текущий чат группой заказов',
      '',
      'Для менеджеров:',
      '/today — список заказов за сегодня',
      '/export — выгрузить заказы CSV',
      '/pay НОМЕР ССЫЛКА — отправить клиенту ссылку на оплату'
    ].join('\n');
    await sendMessage(chatId, help, { parse_mode: 'HTML' });
    return;
  }

  if (/^\/myid/.test(text)) {
    await sendMessage(chatId, `Ваш chat_id: <code>${chatId}</code>`, { parse_mode: 'HTML' });
    return;
  }

  if (/^\/groupid/.test(text)) {
    await sendMessage(chatId, `ID этого чата: <code>${chatId}</code>\nЧтобы назначить этот чат группой заказов, напишите /manager`, { parse_mode: 'HTML' });
    return;
  }

  if (/^\/manager(?:\s|$)/.test(text) || /^\/setmanager(?:\s|$)/.test(text)) {
    await saveManagerChat(message);
    return;
  }

  if (/^\/setupurl(?:\s|$)/.test(text)) {
    await saveSetupUrlCommand(message);
    return;
  }

  const statusMatch = text.match(/^\/status(?:\s+(.+))?/);
  if (statusMatch) {
    const orderId = String(statusMatch[1] || '').trim();
    if (!orderId) return sendMessage(chatId, 'Напишите так: /status DB-260629-ABCD');
    const order = await store.getOrder(orderId);
    if (!order) return sendMessage(chatId, 'Заказ не найден. Проверьте номер.');
    await sendMessage(chatId, formatStatusForCustomer(order), { parse_mode: 'HTML' });
    return;
  }

  if (/^\/today/.test(text)) {
    if (!(await isManagerChat(chatId))) return;
    const orders = await store.listOrders();
    const today = new Date().toISOString().slice(0, 10);
    const todayOrders = orders.filter((order) => String(order.createdAt).startsWith(today));
    const lines = todayOrders.slice(0, 20).map((order) => `${order.id} — ${STATUS_LABELS[order.status] || order.status} — ${order.customer?.name || ''} — ${order.total} ₽`);
    await sendMessage(chatId, lines.length ? lines.join('\n') : 'Сегодня заказов пока нет.');
    return;
  }

  if (/^\/export/.test(text)) {
    if (!(await isManagerChat(chatId))) return;
    await exportOrders(chatId);
    return;
  }

  const payMatch = text.match(/^\/pay\s+(\S+)\s+(https?:\/\/\S+)/);
  if (payMatch) {
    if (!(await isManagerChat(chatId))) return;
    const orderId = payMatch[1];
    const paymentLink = payMatch[2];
    const order = await store.updateOrder(orderId, { paymentLink });
    if (!order) return sendMessage(chatId, 'Заказ не найден.');
    await notifyCustomer(order, `🍓 По заказу <b>${escapeHtml(order.id)}</b> ссылка на оплату:\n${escapeHtml(paymentLink)}\n\nОплачивайте только после подтверждения менеджера.`);
    await sendMessage(chatId, `Ссылка отправлена клиенту по заказу ${order.id}.`);
  }
}

async function handleCallbackQuery(query) {
  const data = String(query.data || '');
  if (!data.startsWith('status|')) return;
  if (!(await isManagerChat(query.message?.chat?.id))) {
    await answerCallbackQuery(query.id, { text: 'Статусы может менять только группа заказов', show_alert: true });
    return;
  }
  const [, orderId, status] = data.split('|');
  const updated = await store.updateOrderStatus(orderId, status, {
    type: 'telegram-manager',
    id: query.from?.id,
    username: query.from?.username || ''
  });
  if (!updated) {
    await answerCallbackQuery(query.id, { text: 'Заказ не найден', show_alert: true });
    return;
  }
  await answerCallbackQuery(query.id, { text: STATUS_LABELS[status] || status });
  if (query.message) {
    await editMessageText(query.message.chat.id, query.message.message_id, formatOrderForManager(updated), {
      parse_mode: 'HTML',
      reply_markup: statusKeyboard(updated.id),
      disable_web_page_preview: true
    }).catch(() => null);
  }
  await notifyCustomer(updated, formatStatusForCustomer(updated));
}

async function handleUpdate(update) {
  try {
    if (update.message) await handleMessage(update.message);
    if (update.callback_query) await handleCallbackQuery(update.callback_query);
  } catch (error) {
    console.error('Telegram update error:', error.message);
  }
}

async function pollingLoop() {
  while (polling) {
    try {
      const updates = await getUpdates();
      for (const update of updates || []) {
        updateOffset = Math.max(updateOffset, Number(update.update_id || 0) + 1);
        await handleUpdate(update);
      }
    } catch (error) {
      console.error('Telegram polling error:', error.message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function startBot() {
  if (!config.botToken) {
    console.warn('BOT_TOKEN is empty. Telegram bot is not started.');
    return null;
  }

  bot = { callApi, sendMessage };
  await callApi('deleteWebhook', { drop_pending_updates: false }).catch((error) => console.warn('deleteWebhook:', error.message));
  if (config.setupTelegramOnStart) await configureTelegram();
  const me = await callApi('getMe').catch(() => null);
  console.log(me ? `Telegram bot started: @${me.username}` : 'Telegram bot started');
  polling = true;
  pollingLoop();
  return bot;
}

module.exports = {
  startBot,
  notifyManagers,
  notifyCustomer,
  buildOpenAppMarkup,
  configureTelegram,
  callApi,
  appUrl,
  getManagerChatId
};
