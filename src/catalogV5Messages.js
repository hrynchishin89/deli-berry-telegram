const { STATUS_LABELS } = require('./telegram/formatters');

function catalogV5StatusSummary(order) {
  return [
    `Дели Берри · заявка ${order.id}`,
    `Статус: ${STATUS_LABELS[order.status] || order.status}`,
    `Самовывоз: ${order.point?.name || order.pointId}`,
    `Желаемое время: ${order.date}, ${order.time} МСК`,
    `Сумма выбранных товаров: ${Number(order.total).toLocaleString('ru-RU')} ₽`,
    `Клиент: ${[order.telegramUser?.first_name, order.telegramUser?.last_name].filter(Boolean).join(' ')}`,
    order.telegramUser?.username ? `Telegram: @${order.telegramUser.username}` : `Telegram ID: ${order.telegramUser?.id}`,
    `Ответ клиенту: /reply ${order.id} текст`,
    'Подтвердите время, оформление и полную стоимость перед оплатой.'
  ].join('\n');
}

function catalogV5Messages(order) {
  const characters = Array.from(order.catalogRequestText || '');
  const prefix = `Дели Берри · ${order.id}\n`;
  const chunks = [];
  let body = '';
  for (const character of characters) {
    if (prefix.length + body.length + character.length > 3900) { chunks.push(prefix + body); body = ''; }
    body += character;
  }
  if (body) chunks.push(prefix + body);
  chunks.push(catalogV5StatusSummary(order));
  return chunks;
}

async function deliverCatalogV5(order, { store, send }) {
  const chunks = catalogV5Messages(order);
  const sent = [...(order.catalogManagerMessages || [])];
  for (let i = sent.length; i < chunks.length; i++) {
    const message = await send(chunks[i], i === chunks.length - 1);
    sent.push(message.message_id);
    await store.updateOrder(order.id, { catalogManagerMessages: [...sent] });
  }
  return { ok: true, messageId: sent.at(-1) };
}

module.exports = { catalogV5Messages, catalogV5StatusSummary, deliverCatalogV5 };
