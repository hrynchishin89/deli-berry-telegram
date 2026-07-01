const STATUS_LABELS = {
  new: '🆕 Новый',
  accepted: '✅ Принят',
  cooking: '👩‍🍳 Готовится',
  ready: '🎁 Готов',
  delivering: '🚗 В доставке',
  done: '🏁 Доставлен/выдан',
  canceled: '❌ Отменён'
};

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return `${Number(value || 0).toLocaleString('ru-RU')} ₽`;
}

function deliveryLabel(type) {
  return type === 'delivery' ? 'Доставка' : 'Самовывоз';
}

function formatItems(items) {
  return (items || [])
    .map((item) => `• ${escapeHtml(item.name)} × ${item.qty} — ${money(item.subtotal)}`)
    .join('\n');
}

function formatOrderForManager(order) {
  const status = STATUS_LABELS[order.status] || order.status;
  const point = order.point?.name || order.pointId || 'точка не выбрана';
  return [
    `🍓 <b>Deli Berry — новый заказ ${escapeHtml(order.id)}</b>`,
    `Статус: <b>${escapeHtml(status)}</b>`,
    '',
    `📍 Точка: <b>${escapeHtml(point)}</b>`,
    `🚚 Способ: <b>${escapeHtml(deliveryLabel(order.deliveryType))}</b>`,
    order.deliveryAddress ? `🏠 Адрес: ${escapeHtml(order.deliveryAddress)}` : '',
    `🗓 Дата/время: ${escapeHtml(order.date || 'не указано')} ${escapeHtml(order.time || '')}`,
    '',
    `👤 Клиент: <b>${escapeHtml(order.customer?.name || '')}</b>`,
    `☎️ Телефон: <code>${escapeHtml(order.customer?.phone || '')}</code>`,
    order.telegramUser?.username ? `Telegram: @${escapeHtml(order.telegramUser.username)}` : '',
    '',
    '<b>Состав заказа:</b>',
    formatItems(order.items),
    '',
    order.discount ? `Промокод: ${escapeHtml(order.promoCode)} / скидка ${money(order.discount)}` : '',
    `💰 Итого ориентировочно: <b>${money(order.total)}</b>`,
    '',
    order.comment ? `💬 Комментарий: ${escapeHtml(order.comment)}` : '',
    '',
    '⚠️ Цена, наличие и время приготовления подтверждаются менеджером.'
  ].filter(Boolean).join('\n');
}

function formatOrderForCustomer(order) {
  return [
    `🍓 Заказ <b>${escapeHtml(order.id)}</b> получен!`,
    '',
    `Статус: <b>${escapeHtml(STATUS_LABELS[order.status] || order.status)}</b>`,
    `Сумма ориентировочно: <b>${money(order.total)}</b>`,
    '',
    'Менеджер подтвердит наличие, цену и время приготовления. Если нужно — пришлёт ссылку на оплату.'
  ].join('\n');
}

function formatStatusForCustomer(order) {
  return `🍓 Заказ <b>${escapeHtml(order.id)}</b>: <b>${escapeHtml(STATUS_LABELS[order.status] || order.status)}</b>`;
}

function statusKeyboard(orderId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Принят', callback_data: `status|${orderId}|accepted` },
        { text: '👩‍🍳 Готовится', callback_data: `status|${orderId}|cooking` }
      ],
      [
        { text: '🎁 Готов', callback_data: `status|${orderId}|ready` },
        { text: '🚗 В доставке', callback_data: `status|${orderId}|delivering` }
      ],
      [
        { text: '🏁 Завершён', callback_data: `status|${orderId}|done` },
        { text: '❌ Отмена', callback_data: `status|${orderId}|canceled` }
      ]
    ]
  };
}

module.exports = {
  STATUS_LABELS,
  escapeHtml,
  money,
  deliveryLabel,
  formatOrderForManager,
  formatOrderForCustomer,
  formatStatusForCustomer,
  statusKeyboard
};
