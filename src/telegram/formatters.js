const STATUS_LABELS = {
  new: '🆕 Новый',
  accepted: '✅ Подтверждён менеджером',
  paid: '💳 Оплачен',
  cooking: '👩‍🍳 Готовится',
  ready: '🎁 Заказ готов',
  delivering: '🚗 В доставке',
  done: '🏁 Завершён',
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

function bonusLines(order) {
  const lines = [];
  if (order.customerPublicId) lines.push(`🪪 ID клиента: <code>${escapeHtml(order.customerPublicId)}</code>`);
  if (Number(order.bonusesUsed || 0) > 0) lines.push(`🍓 Списано бонусов: <b>${Number(order.bonusesUsed).toLocaleString('ru-RU')}</b>`);
  if (Number(order.cashTotal ?? order.total ?? 0) !== Number(order.total || 0)) {
    lines.push(`💳 К оплате деньгами: <b>${money(order.cashTotal)}</b>`);
  }
  if (Number(order.bonusesEarnedPotential || 0) > 0 && !order.bonusCredited) {
    lines.push(`🎁 Начислится после завершения: <b>${Number(order.bonusesEarnedPotential).toLocaleString('ru-RU')} бонусов</b>`);
  }
  if (Number(order.bonusesEarned || 0) > 0) {
    lines.push(`🎁 Начислено: <b>${Number(order.bonusesEarned).toLocaleString('ru-RU')} бонусов</b>`);
  }
  return lines;
}

function formatOrderForManager(order) {
  const status = STATUS_LABELS[order.status] || order.status;
  const point = order.point?.name || order.pointId || 'точка не выбрана';
  return [
    `🍓 <b>Deli Berry — заказ ${escapeHtml(order.id)}</b>`,
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
    ...bonusLines(order),
    '',
    '<b>Состав заказа:</b>',
    formatItems(order.items),
    '',
    order.discount ? `Промокод: ${escapeHtml(order.promoCode)} / скидка ${money(order.discount)}` : '',
    `💰 Стоимость товаров: <b>${money(order.total)}</b>`,
    Number(order.bonusesUsed || 0) > 0 ? `💳 К оплате: <b>${money(order.cashTotal)}</b>` : '',
    '',
    order.comment ? `💬 Комментарий: ${escapeHtml(order.comment)}` : '',
    '',
    'Порядок: подтвердить → оплатить (если требуется) → готовится → заказ готов → завершён. Бонусы 5% начисляются только после «Завершён».'
  ].filter(Boolean).join('\n');
}

function formatOrderForCustomer(order) {
  return [
    `🍓 Заказ <b>${escapeHtml(order.id)}</b> получен!`,
    order.customerPublicId ? `Ваш ID: <code>${escapeHtml(order.customerPublicId)}</code>` : '',
    '',
    `Статус: <b>${escapeHtml(STATUS_LABELS[order.status] || order.status)}</b>`,
    `Стоимость товаров: <b>${money(order.total)}</b>`,
    Number(order.bonusesUsed || 0) > 0 ? `Списано: <b>${order.bonusesUsed} бонусов</b>` : '',
    Number(order.bonusesUsed || 0) > 0 ? `К оплате: <b>${money(order.cashTotal)}</b>` : '',
    Number(order.bonusesEarnedPotential || 0) > 0 ? `После завершения начислится: <b>${order.bonusesEarnedPotential} бонусов</b>` : '',
    '',
    'Менеджер подтвердит наличие, цену и время приготовления. При необходимости пришлёт ссылку или QR на оплату.'
  ].filter(Boolean).join('\n');
}

function formatStatusForCustomer(order) {
  const label = STATUS_LABELS[order.status] || order.status;
  if (order.status === 'accepted') {
    return `✅ Заказ <b>${escapeHtml(order.id)}</b> подтверждён менеджером.`;
  }
  if (order.status === 'paid') {
    return `💳 Оплата заказа <b>${escapeHtml(order.id)}</b> отмечена менеджером. Спасибо!`;
  }
  if (order.status === 'cooking') {
    return `👩‍🍳 Заказ <b>${escapeHtml(order.id)}</b> готовится.`;
  }
  if (order.status === 'ready') {
    return `🎁 Заказ <b>${escapeHtml(order.id)}</b> готов! Менеджер уточнит выдачу или доставку.`;
  }
  if (order.status === 'done') {
    return [
      `🏁 Заказ <b>${escapeHtml(order.id)}</b> завершён. Спасибо за заказ!`,
      Number(order.bonusesEarned || 0) > 0 ? `🍓 Начислено <b>${order.bonusesEarned} бонусов</b>.` : '',
      Number(order.bonusBalanceAfter || 0) >= 0 ? `Баланс: <b>${Number(order.bonusBalanceAfter || 0).toLocaleString('ru-RU')} бонусов</b>.` : ''
    ].filter(Boolean).join('\n');
  }
  if (order.status === 'canceled' && Number(order.bonusesUsed || 0) > 0 && order.bonusRefunded) {
    return `❌ Заказ <b>${escapeHtml(order.id)}</b> отменён. Зарезервированные бонусы возвращены на счёт.`;
  }
  return `🍓 Заказ <b>${escapeHtml(order.id)}</b>: <b>${escapeHtml(label)}</b>`;
}

function statusKeyboard(orderId) {
  return {
    inline_keyboard: [
      [{ text: '✅ Подтвердить', callback_data: `status|${orderId}|accepted` }],
      [
        { text: '💳 Оплачен', callback_data: `status|${orderId}|paid` },
        { text: '👩‍🍳 Готовится', callback_data: `status|${orderId}|cooking` }
      ],
      [{ text: '🎁 Заказ готов', callback_data: `status|${orderId}|ready` }],
      [
        { text: '🚗 В доставке', callback_data: `status|${orderId}|delivering` },
        { text: '🏁 Завершён', callback_data: `status|${orderId}|done` }
      ],
      [{ text: '❌ Отмена', callback_data: `status|${orderId}|canceled` }]
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
