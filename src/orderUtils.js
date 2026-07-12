function makeOrderId() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `DB-${yy}${mm}${dd}-${random}`;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '').slice(0, 24);
}

function normalizeText(value, limit = 500) {
  return String(value || '').trim().slice(0, limit);
}

function applyPromo(total, promoCode, promocodes, deliveryType, items) {
  const code = String(promoCode || '').trim().toUpperCase();
  if (!code) return { discount: 0, promo: null };
  const promo = promocodes.find((item) => item.enabled && item.code.toUpperCase() === code);
  if (!promo) return { discount: 0, promo: null, error: 'Промокод не найден' };
  if (promo.minTotal && total < promo.minTotal) {
    return { discount: 0, promo: null, error: `Промокод действует от ${promo.minTotal} ₽` };
  }
  if (promo.deliveryType && promo.deliveryType !== deliveryType) {
    return { discount: 0, promo: null, error: 'Промокод не подходит для выбранного способа получения' };
  }
  if (promo.code === 'DUBAI10') {
    const hasDubai = items.some((item) => item.category === 'dubai');
    if (!hasDubai) return { discount: 0, promo: null, error: 'Добавьте дубайский шоколад для этого промокода' };
  }
  let discount = 0;
  if (promo.type === 'percent') discount = Math.round(total * Number(promo.value || 0) / 100);
  if (promo.type === 'amount') discount = Number(promo.value || 0);
  discount = Math.max(0, Math.min(total, discount));
  return { discount, promo };
}

function buildOrderFromPayload(payload, bundle, promocodes) {
  const catalogById = new Map(bundle.catalog.map((item) => [item.id, item]));
  const pointId = normalizeText(payload.pointId, 40);
  const point = bundle.points.find((item) => item.id === pointId) || bundle.points[0] || null;
  const deliveryType = payload.deliveryType === 'delivery' ? 'delivery' : 'pickup';
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = [];
  const itemErrors = [];

  for (const rawItem of rawItems) {
    const product = catalogById.get(String(rawItem.id || ''));
    if (!product) continue;
    const qty = Math.max(1, Math.min(20, Number(rawItem.qty || 1)));
    if (Array.isArray(product.points) && product.points.length === 0) continue;
    if (pointId && Array.isArray(product.points) && product.points.length && !product.points.includes(pointId)) continue;

    const variants = Array.isArray(product.variants) ? product.variants.filter((variant) => variant && variant.id) : [];
    const requestedVariantId = String(rawItem.variantId || '').trim();
    const variant = variants.find((item) => String(item.id) === requestedVariantId) || (variants.length ? variants[0] : null);
    const variantLabel = variant ? String(variant.label || variant.unit || '').trim() : '';
    const optionGroups = Array.isArray(product.options) ? product.options.filter((group) => group && group.id && Array.isArray(group.values)) : [];
    const rawOptions = rawItem.options && typeof rawItem.options === 'object' ? rawItem.options : {};
    const optionSelections = {};
    const optionLabels = [];
    for (const group of optionGroups) {
      const requested = String(rawOptions[group.id] || '');
      const selected = group.values.find((value) => String(value?.id || '') === requested);
      if (!selected && group.required !== false) {
        itemErrors.push(`${product.name}: выберите «${group.label || group.id}»`);
        continue;
      }
      if (selected) {
        optionSelections[group.id] = String(selected.id);
        optionLabels.push(String(selected.label || selected.name || selected.id));
      }
    }
    const unitPrice = Number((variant ? variant.price : product.price) || 0);
    const itemDetails = [variantLabel, ...optionLabels].filter(Boolean);
    const productName = itemDetails.length ? `${product.name} · ${itemDetails.join(' · ')}` : product.name;

    items.push({
      id: product.id,
      variantId: variant ? variant.id : '',
      variantLabel,
      name: productName,
      baseName: product.name,
      category: product.category,
      categoryName: product.categoryName,
      qty,
      unitPrice,
      priceText: variant ? (variant.priceText || '') : (product.priceText || ''),
      unit: variantLabel || product.unit || '',
      options: optionSelections,
      optionLabels,
      subtotal: unitPrice * qty,
      needsConfirmation: Boolean(product.needsConfirmation)
    });
  }

  const totalBeforeDiscount = items.reduce((sum, item) => sum + item.subtotal, 0);
  const promoResult = applyPromo(totalBeforeDiscount, payload.promoCode, promocodes, deliveryType, items);
  const total = Math.max(0, totalBeforeDiscount - promoResult.discount);
  const telegramUser = payload.telegramUser && typeof payload.telegramUser === 'object' ? {
    id: payload.telegramUser.id || '',
    first_name: payload.telegramUser.first_name || '',
    last_name: payload.telegramUser.last_name || '',
    username: payload.telegramUser.username || '',
    language_code: payload.telegramUser.language_code || ''
  } : null;

  return {
    id: makeOrderId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'new',
    source: payload.source || 'telegram-mini-app',
    pointId: point?.id || pointId,
    point,
    deliveryType,
    customer: {
      name: normalizeText(payload.customer?.name || payload.name, 120),
      phone: normalizePhone(payload.customer?.phone || payload.phone)
    },
    deliveryAddress: normalizeText(payload.deliveryAddress || payload.address, 300),
    date: normalizeText(payload.date, 30),
    time: normalizeText(payload.time, 30),
    comment: normalizeText(payload.comment, 1000),
    recipient: {
      name: normalizeText(payload.recipient?.name, 120),
      phone: normalizePhone(payload.recipient?.phone)
    },
    items,
    totalBeforeDiscount,
    discount: promoResult.discount,
    total,
    promoCode: promoResult.promo ? promoResult.promo.code : '',
    promoLabel: promoResult.promo ? promoResult.promo.label : '',
    promoError: promoResult.error || '',
    legalAccepted: Boolean(payload.legalAccepted),
    telegramUser,
    statusHistory: [{ status: 'new', at: new Date().toISOString(), actor: { type: 'system' } }],
    itemErrors
  };
}

function validateOrder(order) {
  const errors = [];
  if (!order.items.length) errors.push('Добавьте хотя бы один товар');
  if (Array.isArray(order.itemErrors) && order.itemErrors.length) errors.push(...order.itemErrors);
  if (!order.customer.name) errors.push('Укажите имя');
  if (!order.customer.phone || order.customer.phone.length < 6) errors.push('Укажите телефон');
  if (order.deliveryType === 'delivery' && !order.deliveryAddress) errors.push('Укажите адрес доставки');
  if (!order.date) errors.push('Выберите дату');
  if (!order.time) errors.push('Укажите время');
  if (!order.legalAccepted) errors.push('Нужно согласие на обработку персональных данных');
  return errors;
}

module.exports = {
  makeOrderId,
  normalizePhone,
  normalizeText,
  buildOrderFromPayload,
  validateOrder
};
