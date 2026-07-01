const tg = window.Telegram?.WebApp;
const state = {
  catalog: [],
  categories: [],
  points: [],
  legal: {},
  selectedPoint: localStorage.getItem('db_selected_point') || 'dybenko',
  selectedCategory: 'hits',
  search: '',
  cart: JSON.parse(localStorage.getItem('db_cart') || '{}'),
  promoCode: localStorage.getItem('db_promo') || ''
};

const el = (selector) => document.querySelector(selector);
const els = (selector) => Array.from(document.querySelectorAll(selector));
const money = (value) => `${Number(value || 0).toLocaleString('ru-RU')} ₽`;

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  document.documentElement.style.setProperty('--tg-bg-color', tg.themeParams?.bg_color || '#fff8f2');
  tg.MainButton.setText('Оформить заказ');
  tg.MainButton.onClick(openCheckout);
}

function vibrate(type = 'light') {
  try { tg?.HapticFeedback?.impactOccurred(type); } catch (_error) {}
}

function showToast(message) {
  const toast = el('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2300);
}

async function loadData() {
  try {
    const response = await fetch('/api/catalog');
    if (!response.ok) throw new Error('api error');
    const data = await response.json();
    state.catalog = data.catalog || [];
    state.categories = data.categories || [];
    state.points = data.points || [];
    state.legal = data.legal || {};
  } catch (_error) {
    showToast('Не удалось загрузить каталог. Обновите страницу.');
  }
}

function currentPoint() {
  return state.points.find((point) => point.id === state.selectedPoint) || state.points[0];
}

function filteredProducts() {
  const pointId = state.selectedPoint;
  const query = state.search.toLowerCase().trim();
  return state.catalog.filter((product) => {
    const byPoint = !pointId || !Array.isArray(product.points) || product.points.includes(pointId);
    const byCategory = state.selectedCategory === 'hits' ? product.isHit : product.category === state.selectedCategory;
    const bySearch = !query || [product.name, product.description, product.categoryName, product.unit]
      .join(' ')
      .toLowerCase()
      .includes(query);
    return byPoint && byCategory && bySearch;
  });
}

function renderPoints() {
  const grid = el('#point-grid');
  grid.innerHTML = state.points.map((point) => `
    <button type="button" class="point-card ${point.id === state.selectedPoint ? 'active' : ''}" data-point="${point.id}">
      <h3>${point.name}</h3>
      <p>${point.address}</p>
      <p>График: ${point.schedule}</p>
    </button>
  `).join('');
  grid.querySelectorAll('[data-point]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedPoint = button.dataset.point;
      localStorage.setItem('db_selected_point', state.selectedPoint);
      vibrate();
      renderAll();
    });
  });
}

function renderCategories() {
  const strip = el('#category-strip');
  strip.innerHTML = state.categories.map((category) => `
    <button type="button" class="category-chip ${category.id === state.selectedCategory ? 'active' : ''}" data-category="${category.id}">
      ${category.emoji || ''} ${category.name}
    </button>
  `).join('');
  strip.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedCategory = button.dataset.category;
      vibrate();
      renderAll();
    });
  });
}

function productCard(product) {
  return `
    <article class="product-card">
      <div class="product-art">
        ${(product.badge || product.badges?.[0]) ? `<span class="product-badge">${product.badge || product.badges[0]}</span>` : ''}
        <span>${product.emoji || '🍓'}</span>
      </div>
      <div class="product-title">${product.name}</div>
      <div class="product-meta">${product.unit || ''}</div>
      <div class="product-meta">${product.description || ''}</div>
      <div class="product-bottom">
        <div class="price">${product.priceText || money(product.price)}</div>
        <div class="product-actions">
          <button type="button" class="small-btn" data-add="${product.id}">Добавить</button>
          <button type="button" class="small-btn info-btn" data-info="${product.id}">i</button>
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  const grid = el('#product-grid');
  const products = filteredProducts();
  el('#items-total-label').textContent = `${products.length} позиций`;
  grid.innerHTML = products.length ? products.map(productCard).join('') : '<div class="empty">Ничего не найдено. Попробуйте другую категорию или точку.</div>';
  grid.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => addToCart(button.dataset.add)));
  grid.querySelectorAll('[data-info]').forEach((button) => button.addEventListener('click', () => openProduct(button.dataset.info)));
}

function saveCart() {
  localStorage.setItem('db_cart', JSON.stringify(state.cart));
  localStorage.setItem('db_promo', state.promoCode || '');
}

function cartItems() {
  return Object.entries(state.cart)
    .map(([id, qty]) => ({ product: state.catalog.find((item) => item.id === id), qty }))
    .filter((item) => item.product && item.qty > 0);
}

function cartTotal() {
  return cartItems().reduce((sum, item) => sum + Number(item.product.price || 0) * item.qty, 0);
}

function addToCart(id) {
  state.cart[id] = Number(state.cart[id] || 0) + 1;
  saveCart();
  renderCart();
  vibrate('medium');
  showToast('Добавлено в корзину');
}

function changeQty(id, delta) {
  state.cart[id] = Number(state.cart[id] || 0) + delta;
  if (state.cart[id] <= 0) delete state.cart[id];
  saveCart();
  renderCart();
}

function renderCart() {
  const items = cartItems();
  const count = items.reduce((sum, item) => sum + item.qty, 0);
  el('#cart-count').textContent = count;
  el('#cart-summary').textContent = count ? `${count} шт. в корзине` : 'Пока пусто';
  el('#cart-total').textContent = money(cartTotal());
  if (tg) count ? tg.MainButton.show() : tg.MainButton.hide();
  const list = el('#cart-list');
  list.innerHTML = items.length ? items.map(({ product, qty }) => `
    <div class="cart-item">
      <div>
        <b>${product.name}</b>
        <div class="product-meta">${product.unit || ''}</div>
        <div class="price">${money(Number(product.price || 0) * qty)}</div>
      </div>
      <div class="qty">
        <button type="button" data-qty="${product.id}" data-delta="-1">−</button>
        <b>${qty}</b>
        <button type="button" data-qty="${product.id}" data-delta="1">+</button>
      </div>
    </div>
  `).join('') : '<div class="empty">Корзина пустая. Добавьте клубнику или сладкий подарок.</div>';
  list.querySelectorAll('[data-qty]').forEach((button) => {
    button.addEventListener('click', () => changeQty(button.dataset.qty, Number(button.dataset.delta)));
  });
}

function renderAll() {
  renderPoints();
  renderCategories();
  renderProducts();
  renderCart();
}

function openCart() {
  el('#cart-drawer').classList.add('open');
  el('#cart-drawer').setAttribute('aria-hidden', 'false');
}

function closeCart() {
  el('#cart-drawer').classList.remove('open');
  el('#cart-drawer').setAttribute('aria-hidden', 'true');
}

function openCheckout() {
  if (!cartItems().length) {
    showToast('Сначала добавьте товар');
    return;
  }
  closeCart();
  const dialog = el('#checkout-dialog');
  const dateInput = dialog.querySelector('input[name="date"]');
  if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  dialog.showModal();
}

function closeCheckout() {
  el('#checkout-dialog').close();
}

function openProduct(id) {
  const product = state.catalog.find((item) => item.id === id);
  if (!product) return;
  const dialog = el('#product-modal');
  dialog.innerHTML = `
    <div class="modal-card">
      <div class="drawer-head">
        <div><h2>${product.name}</h2><span>${product.categoryName || ''}</span></div>
        <button class="icon-btn" type="button" data-close-product>×</button>
      </div>
      <div class="modal-art">${product.emoji || '🍓'}</div>
      <p>${product.description || ''}</p>
      <dl>
        <dt>Цена</dt><dd>${product.priceText || money(product.price)}</dd>
        <dt>Вес / количество</dt><dd>${product.unit || 'уточняется'}</dd>
        <dt>Состав</dt><dd>${product.composition || 'уточняется'}</dd>
        <dt>Аллергены</dt><dd>${product.allergens || state.legal.allergens || 'уточняется'}</dd>
        <dt>Срок годности</dt><dd>${product.shelfLife || state.legal.shelfLife || 'уточняется'}</dd>
      </dl>
      <button class="primary full" type="button" data-add-modal="${product.id}">Добавить в заказ</button>
    </div>
  `;
  dialog.querySelector('[data-close-product]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-add-modal]').addEventListener('click', () => { addToCart(product.id); dialog.close(); });
  dialog.showModal();
}

function toggleDeliveryFields() {
  const type = new FormData(el('#order-form')).get('deliveryType');
  els('.delivery-only').forEach((node) => node.style.display = type === 'delivery' ? 'grid' : 'none');
}

async function submitOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const errorBox = el('#form-error');
  errorBox.textContent = '';
  const payload = {
    source: tg ? 'telegram-mini-app' : 'web-direct',
    initData: tg?.initData || '',
    telegramUser: tg?.initDataUnsafe?.user || null,
    pointId: state.selectedPoint,
    deliveryType: formData.get('deliveryType'),
    customer: {
      name: formData.get('name'),
      phone: formData.get('phone')
    },
    deliveryAddress: formData.get('address'),
    date: formData.get('date'),
    time: formData.get('time'),
    comment: formData.get('comment'),
    legalAccepted: Boolean(formData.get('legal')),
    promoCode: state.promoCode,
    items: cartItems().map(({ product, qty }) => ({ id: product.id, qty }))
  };

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Отправляем…';
  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error((data.errors || [data.error]).filter(Boolean).join('\n') || 'Ошибка отправки заказа');
    localStorage.setItem('db_last_order', JSON.stringify({ orderId: data.orderId, at: new Date().toISOString() }));
    state.cart = {};
    saveCart();
    renderCart();
    closeCheckout();
    showToast(`Заказ ${data.orderId} отправлен`);
    tg?.showPopup?.({ title: 'Заказ отправлен', message: `Номер заказа: ${data.orderId}. Менеджер скоро подтвердит наличие и время.`, buttons: [{ type: 'ok' }] });
  } catch (error) {
    errorBox.textContent = error.message;
    tg?.showAlert?.(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Отправить заказ';
  }
}

function bindEvents() {
  el('#cart-pill').addEventListener('click', openCart);
  els('[data-close-cart]').forEach((node) => node.addEventListener('click', closeCart));
  el('#checkout-btn').addEventListener('click', openCheckout);
  el('#close-checkout').addEventListener('click', closeCheckout);
  el('#order-form').addEventListener('submit', submitOrder);
  el('#order-form').addEventListener('change', toggleDeliveryFields);
  el('#search').addEventListener('input', (event) => { state.search = event.target.value; renderProducts(); });
  el('#apply-promo').addEventListener('click', () => {
    state.promoCode = el('#promo-code').value.trim().toUpperCase();
    saveCart();
    showToast(state.promoCode ? `Промокод ${state.promoCode} применим при оформлении` : 'Промокод очищен');
  });
  els('[data-scroll]').forEach((button) => button.addEventListener('click', () => el(`#${button.dataset.scroll}`).scrollIntoView({ behavior: 'smooth' })));
}

(async function main() {
  initTelegram();
  bindEvents();
  el('#promo-code').value = state.promoCode;
  toggleDeliveryFields();
  await loadData();
  if (!state.points.find((point) => point.id === state.selectedPoint)) state.selectedPoint = state.points[0]?.id || 'dybenko';
  renderAll();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => null);
})();
