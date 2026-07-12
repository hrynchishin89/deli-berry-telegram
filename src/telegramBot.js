const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');
const config = require('./config');
const store = require('./store');
const {
  STATUS_LABELS,
  formatOrderForManager,
  formatOrderForCustomer,
  formatStatusForCustomer,
  statusKeyboard,
  escapeHtml
} = require('./telegram/formatters');
const { canTransition, transitionError } = require('./statusRules');

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

async function sendPhoto(chatId, photo, options = {}) {
  return callApi('sendPhoto', { chat_id: chatId, photo, ...options });
}

async function sendPhotoBuffer(chatId, buffer, filename = 'payment-qr.png', options = {}) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('photo', new Blob([buffer], { type: 'image/png' }), filename);
  for (const [key, value] of Object.entries(options || {})) {
    if (value === undefined || value === null) continue;
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const response = await fetch(apiUrl('sendPhoto'), { method: 'POST', body: form });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(json.description || 'sendPhoto failed');
  return json.result;
}

async function qrImageBuffer(value) {
  return QRCode.toBuffer(String(value || ''), {
    type: 'png', width: 900, margin: 2,
    color: { dark: '#2E1C16', light: '#FFF8F1' },
    errorCorrectionLevel: 'M'
  });
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

async function sendWelcome(chatId, telegramUser = null) {
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
  let customerLine = '';
  if (telegramUser?.id) {
    const customer = await store.getOrCreateCustomer({ telegramUser }).catch(() => null);
    if (customer) customerLine = `

🪪 Ваш ID: <code>${escapeHtml(customer.publicId)}</code>
🍓 Бонусы: <b>${Number(customer.bonusBalance || 0).toLocaleString('ru-RU')}</b>`;
  }
  const replyMarkup = await buildOpenAppMarkup();
  await sendMessage(chatId, `${text}${customerLine}`, {
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

async function findOrderByManagerMessageId(messageId) {
  if (!messageId) return null;
  const orders = await store.listOrders();
  return orders.find((order) => String(order.managerMessageId || '') === String(messageId)) || null;
}

async function sendPaymentLink(order, paymentLink, mode = 'link') {
  if (!order?.telegramUser?.id) {
    return { skipped: true, reason: 'Order has no Telegram customer id' };
  }

  const caption = [
    `🍓 Оплата по заказу <b>${escapeHtml(order.id)}</b>`,
    `К оплате: <b>${escapeHtml(order.cashTotal ?? order.total)} ₽</b>`,
    '',
    'Оплачивайте только после подтверждения менеджера.'
  ].join('\n');

  const reply_markup = {
    inline_keyboard: [[{ text: 'Оплатить', url: paymentLink }]]
  };

  if (mode === 'qr') {
    const qr = await qrImageBuffer(paymentLink);
    await sendPhotoBuffer(order.telegramUser.id, qr, `deli-berry-${order.id}-qr.png`, {
      caption,
      parse_mode: 'HTML',
      reply_markup
    });
    return { ok: true, type: 'qr' };
  }

  await sendMessage(order.telegramUser.id, `${caption}\n\n${escapeHtml(paymentLink)}`, {
    parse_mode: 'HTML',
    reply_markup,
    disable_web_page_preview: true
  });
  return { ok: true, type: 'link' };
}

async function handleManagerReplyToOrder(message) {
  const chatId = message.chat?.id;
  if (!(await isManagerChat(chatId))) return false;

  const repliedMessageId = message.reply_to_message?.message_id;
  if (!repliedMessageId) return false;

  const order = await findOrderByManagerMessageId(repliedMessageId);
  if (!order) return false;

  if (!order.telegramUser?.id) {
    await sendMessage(chatId, `Не могу отправить клиенту по заказу ${order.id}: в заказе нет Telegram ID клиента. Такое бывает, если заказ сделан не из Telegram Mini App.`);
    return true;
  }

  const text = String(message.text || message.caption || '').trim();
  const photo = Array.isArray(message.photo) && message.photo.length ? message.photo[message.photo.length - 1].file_id : '';

  if (photo) {
    const caption = text
      ? `🍓 Сообщение от менеджера по заказу <b>${escapeHtml(order.id)}</b>\n\n${escapeHtml(text)}`
      : `🍓 QR / фото от менеджера по заказу <b>${escapeHtml(order.id)}</b>`;
    await sendPhoto(order.telegramUser.id, photo, { caption, parse_mode: 'HTML' });
    await sendMessage(chatId, `✅ Фото/QR отправлен клиенту по заказу ${order.id}.`);
    return true;
  }

  if (text) {
    await notifyCustomer(order, `🍓 Сообщение от менеджера по заказу <b>${escapeHtml(order.id)}</b>\n\n${escapeHtml(text)}`);
    await sendMessage(chatId, `✅ Ответ отправлен клиенту по заказу ${order.id}.`);
    return true;
  }

  return false;
}

async function forwardCustomerMessageToManagers(message) {
  const managerChatId = await getManagerChatId();
  if (!managerChatId || message.chat?.type !== 'private') return false;

  const from = message.from || {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'клиент';
  const username = from.username ? `@${from.username}` : '';
  const userId = from.id;
  const text = String(message.text || '').trim();
  if (!text) return false;

  await sendMessage(managerChatId, [
    '💬 <b>Сообщение клиента в бот</b>',
    `Клиент: ${escapeHtml(name)} ${escapeHtml(username)}`.trim(),
    `Telegram ID: <code>${escapeHtml(userId)}</code>`,
    '',
    escapeHtml(text),
    '',
    `Ответить: <code>/replyuser ${escapeHtml(userId)} текст ответа</code>`
  ].join('\n'), { parse_mode: 'HTML' });
  await sendMessage(message.chat.id, 'Спасибо! Сообщение передано менеджеру Deli Berry 🍓');
  return true;
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
      { command: 'profile', description: 'ID, бонусы и история заказов' },
      { command: 'bonus', description: 'Проверить бонусный баланс' },
      { command: 'myid', description: 'Узнать свой Telegram ID' },
      { command: 'groupid', description: 'Узнать ID группы' },
      { command: 'manager', description: 'Назначить этот чат группой заказов' },
      { command: 'help', description: 'Помощь' },
      { command: 'pay', description: 'Менеджер: отправить ссылку оплаты' },
      { command: 'qr', description: 'Менеджер: отправить QR оплаты' },
      { command: 'reply', description: 'Менеджер: ответить по заказу' }
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
    'Команды менеджера: /today, /export, /pay НОМЕР ССЫЛКА, /qr НОМЕР ССЫЛКА, /reply НОМЕР ТЕКСТ.'
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
  if (!chatId) return;

  if (await handleManagerReplyToOrder(message)) return;

  const text = String(message.text || message.caption || '').trim();
  if (!text.startsWith('/')) {
    await forwardCustomerMessageToManagers(message);
    return;
  }

  if (/^\/start(?:\s|$)/.test(text) || /^\/(order|catalog)(?:\s|$)/.test(text)) {
    await sendWelcome(chatId, message.from || null);
    return;
  }

  if (/^\/help/.test(text)) {
    const help = [
      '<b>Команды Deli Berry</b>',
      '/start — открыть главное меню',
      '/order — открыть каталог',
      '/catalog — открыть каталог',
      '/status НОМЕР — проверить статус заказа',
      '/profile — ID, бонусы и история',
      '/bonus — бонусный баланс',
      '/myid — узнать свой Telegram ID',
      '/groupid — узнать ID группы',
      '/manager — назначить текущий чат группой заказов',
      '',
      'Для менеджеров:',
      '/today — список заказов за сегодня',
      '/export — выгрузить заказы CSV',
      '/pay НОМЕР ССЫЛКА — отправить клиенту ссылку на оплату',
      '/qr НОМЕР ССЫЛКА — отправить клиенту QR на оплату',
      '/reply НОМЕР ТЕКСТ — ответить клиенту по заказу',
      '/replyuser TELEGRAM_ID ТЕКСТ — ответить клиенту, который написал в бот',
      '',
      'Можно проще: ответьте текстом или фото/QR прямо на сообщение заказа в группе — бот перешлёт это клиенту.'
    ].join('\n');
    await sendMessage(chatId, help, { parse_mode: 'HTML' });
    return;
  }

  if (/^\/(profile|bonus)(?:\s|$)/.test(text)) {
    const profile = await store.getCustomerProfile({ telegramUser: message.from || {} }).catch(() => null);
    if (!profile?.customer) {
      await sendMessage(chatId, 'Профиль пока не создан. Откройте Mini App или оформите первый заказ.');
      return;
    }
    const customer = profile.customer;
    const url = await appUrl();
    const body = [
      '🍓 <b>Профиль Deli Berry</b>',
      `ID: <code>${escapeHtml(customer.publicId)}</code>`,
      `Бонусы: <b>${Number(customer.bonusBalance || 0).toLocaleString('ru-RU')}</b>`,
      `Завершённых заказов: <b>${Number(customer.completedOrders || 0)}</b>`,
      `Сумма покупок: <b>${Number(customer.lifetimeSpend || 0).toLocaleString('ru-RU')} ₽</b>`,
      '',
      'Начисляем 5% после завершения заказа. Бонусами можно оплатить до 30% стоимости товаров.'
    ].join('\n');
    await sendMessage(chatId, body, {
      parse_mode: 'HTML',
      ...(url ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть профиль', web_app: { url } }]] } } : {})
    });
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
    const sent = await sendPaymentLink(order, paymentLink, 'link');
    if (sent.skipped) return sendMessage(chatId, `Не могу отправить ссылку клиенту по заказу ${order.id}: у заказа нет Telegram ID клиента.`);
    await sendMessage(chatId, `✅ Ссылка на оплату отправлена клиенту по заказу ${order.id}.`);
    return;
  }

  const qrMatch = text.match(/^\/qr\s+(\S+)\s+(https?:\/\/\S+)/);
  if (qrMatch) {
    if (!(await isManagerChat(chatId))) return;
    const orderId = qrMatch[1];
    const paymentLink = qrMatch[2];
    const order = await store.updateOrder(orderId, { paymentLink });
    if (!order) return sendMessage(chatId, 'Заказ не найден.');
    const sent = await sendPaymentLink(order, paymentLink, 'qr');
    if (sent.skipped) return sendMessage(chatId, `Не могу отправить QR клиенту по заказу ${order.id}: у заказа нет Telegram ID клиента.`);
    await sendMessage(chatId, `✅ QR на оплату отправлен клиенту по заказу ${order.id}.`);
    return;
  }

  const qrHereMatch = text.match(/^\/qrhere\s+(https?:\/\/\S+)/);
  if (qrHereMatch) {
    if (!(await isManagerChat(chatId))) return;
    const paymentLink = qrHereMatch[1];
    const qr = await qrImageBuffer(paymentLink);
    await sendPhotoBuffer(chatId, qr, 'deli-berry-payment-qr.png', {
      caption: `QR на оплату
${escapeHtml(paymentLink)}`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть оплату', url: paymentLink }]] }
    });
    return;
  }

  const replyMatch = text.match(/^\/reply\s+(\S+)\s+([\s\S]+)/);
  if (replyMatch) {
    if (!(await isManagerChat(chatId))) return;
    const orderId = replyMatch[1];
    const replyText = String(replyMatch[2] || '').trim();
    const order = await store.getOrder(orderId);
    if (!order) return sendMessage(chatId, 'Заказ не найден.');
    const sent = await notifyCustomer(order, `🍓 Сообщение от менеджера по заказу <b>${escapeHtml(order.id)}</b>\n\n${escapeHtml(replyText)}`);
    if (sent.skipped) return sendMessage(chatId, `Не могу отправить ответ клиенту по заказу ${order.id}: у заказа нет Telegram ID клиента.`);
    await sendMessage(chatId, `✅ Ответ отправлен клиенту по заказу ${order.id}.`);
    return;
  }

  const replyUserMatch = text.match(/^\/replyuser\s+(\d+)\s+([\s\S]+)/);
  if (replyUserMatch) {
    if (!(await isManagerChat(chatId))) return;
    const userId = replyUserMatch[1];
    const replyText = String(replyUserMatch[2] || '').trim();
    await sendMessage(userId, `🍓 Сообщение от менеджера Deli Berry\n\n${escapeHtml(replyText)}`, { parse_mode: 'HTML' });
    await sendMessage(chatId, `✅ Ответ отправлен клиенту ${userId}.`);
    return;
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
  const current = await store.getOrder(orderId);
  if (!current) {
    await answerCallbackQuery(query.id, { text: 'Заказ не найден', show_alert: true });
    return;
  }
  if (!canTransition(current.status, status)) {
    await answerCallbackQuery(query.id, {
      text: transitionError(current.status, status),
      show_alert: true
    });
    return;
  }
  const updated = await store.transitionOrderStatus(orderId, status, {
    type: 'telegram-manager',
    id: query.from?.id,
    username: query.from?.username || ''
  }, {
    enabled: config.bonusEnabled,
    earnPercent: config.bonusEarnPercent,
    maxRedeemPercent: config.bonusMaxRedeemPercent
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

  bot = { callApi, sendMessage, sendPhoto };
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
  sendPhoto,
  appUrl,
  getManagerChatId
};
