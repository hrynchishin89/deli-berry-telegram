let pin = localStorage.getItem('deliBerryAdminPin') || '';
let catalog = [];
let categories = [];
let points = [];
let selected = null;
let currentFilter = 'all';
let photoFile = null;

const $ = (id) => document.getElementById(id);
const form = $('productForm');

$('pinInput').value = pin;
$('loginBtn').addEventListener('click', () => {
  pin = $('pinInput').value.trim();
  localStorage.setItem('deliBerryAdminPin', pin);
  loadCatalog();
});
$('reloadBtn').addEventListener('click', () => loadCatalog());
$('searchInput').addEventListener('input', renderList);
$('newBtn').addEventListener('click', newProduct);
$('photoInput').addEventListener('change', (event) => {
  photoFile = event.target.files?.[0] || null;
  if (photoFile) previewLocalPhoto(photoFile);
});
$('hideBtn').addEventListener('click', hideSelected);

document.querySelectorAll('.chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderList();
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveProduct();
});

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-pin': pin,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

async function loadCatalog() {
  try {
    if (!pin) return alert('Введите ADMIN_PIN');
    const data = await api('/api/admin/catalog');
    catalog = data.catalog || [];
    categories = data.categories || [];
    points = data.points || [];
    $('syncBadge').textContent = data.cms?.githubSyncConfigured ? 'GitHub Sync включён' : 'Только локально';
    $('login').classList.add('hidden');
    $('workspace').classList.remove('hidden');
    fillCategories();
    renderList();
  } catch (error) {
    alert(error.message);
  }
}

function fillCategories() {
  const select = $('categorySelect');
  select.innerHTML = categories.map((c) => `<option value="${escapeHtml(c.id || c.key || '')}">${escapeHtml(c.name || c.title || c.id || c.key || '')}</option>`).join('');
}

function productVisible(p) {
  const text = $('searchInput').value.trim().toLowerCase();
  const hay = `${p.name || ''} ${p.categoryName || ''} ${p.priceText || ''}`.toLowerCase();
  if (text && !hay.includes(text)) return false;
  if (currentFilter === 'no-photo') return !p.image;
  if (currentFilter === 'hit') return !!p.isHit;
  if (currentFilter === 'drinks') return ['drinks', 'fresh'].includes(p.category);
  if (currentFilter === 'hidden') return !Array.isArray(p.points) || p.points.length === 0;
  return true;
}

function renderList() {
  const list = $('productList');
  const items = catalog.filter(productVisible);
  list.innerHTML = items.map((p) => `
    <div class="product-row ${selected?.id === p.id ? 'active' : ''}" onclick="selectProduct('${escapeAttr(p.id)}')">
      <div class="thumb">${p.image ? `<img src="${escapeAttr(p.image)}" />` : (p.emoji || '🍓')}</div>
      <div>
        <div class="product-name">${escapeHtml(p.name || 'Без названия')}</div>
        <div class="product-meta">${escapeHtml(p.priceText || `${p.price || 0} ₽`)} · ${escapeHtml(p.categoryName || p.category || '')}</div>
      </div>
    </div>
  `).join('') || '<p class="hint">Ничего не найдено</p>';
}

window.selectProduct = function(id) {
  selected = catalog.find((p) => p.id === id) || null;
  photoFile = null;
  $('photoInput').value = '';
  renderEditor();
  renderList();
};

function newProduct() {
  selected = {
    id: '', name: 'Новый товар', category: categories[0]?.id || 'strawberry', categoryName: categories[0]?.name || 'Клубника и наборы',
    description: '', composition: '', allergens: '', shelfLife: 'уточняется', unit: '', price: 0, priceText: '0 ₽',
    points: ['dybenko', 'rzhavki'], image: '', emoji: '🍓', badge: 'Новинка', isHit: false, needsConfirmation: true, source: 'admin'
  };
  photoFile = null;
  $('photoInput').value = '';
  renderEditor();
}

function renderEditor() {
  $('emptyEditor').classList.add('hidden');
  form.classList.remove('hidden');
  $('editorTitle').textContent = selected?.name || 'Новый товар';
  for (const field of ['id','name','price','priceText','unit','category','categoryName','description','composition','allergens','shelfLife','badge','emoji']) {
    const input = form.elements[field];
    if (input) input.value = selected?.[field] ?? '';
  }
  form.elements.isHit.checked = !!selected?.isHit;
  form.elements.needsConfirmation.checked = selected?.needsConfirmation !== false;
  document.querySelectorAll('.pointCheck').forEach((box) => {
    box.checked = Array.isArray(selected?.points) && selected.points.includes(box.value);
  });
  renderImagePreview(selected?.image);
}

function renderImagePreview(src) {
  $('imagePreview').innerHTML = src ? `<img src="${escapeAttr(src)}" />` : (selected?.emoji || '🍓');
}

function previewLocalPhoto(file) {
  const reader = new FileReader();
  reader.onload = () => { $('imagePreview').innerHTML = `<img src="${reader.result}" />`; };
  reader.readAsDataURL(file);
}

function collectProduct() {
  const product = { ...(selected || {}) };
  for (const field of ['name','priceText','unit','category','categoryName','description','composition','allergens','shelfLife','badge','emoji']) {
    product[field] = form.elements[field].value;
  }
  product.price = Number(form.elements.price.value || 0);
  product.isHit = form.elements.isHit.checked;
  product.needsConfirmation = form.elements.needsConfirmation.checked;
  product.points = Array.from(document.querySelectorAll('.pointCheck')).filter((box) => box.checked).map((box) => box.value);
  if (!product.priceText && product.price) product.priceText = `${product.price.toLocaleString('ru-RU')} ₽`;
  return product;
}

async function saveProduct() {
  try {
    const product = collectProduct();
    let saved;
    if (!selected.id) {
      saved = await api('/api/admin/catalog/products', { method: 'POST', body: JSON.stringify({ product }) });
      selected = saved.product;
      catalog.unshift(selected);
    } else {
      saved = await api(`/api/admin/catalog/products/${encodeURIComponent(selected.id)}`, { method: 'PUT', body: JSON.stringify({ product }) });
      selected = saved.product;
      const index = catalog.findIndex((p) => p.id === selected.id);
      if (index >= 0) catalog[index] = selected;
    }

    if (photoFile) {
      const dataUrl = await fileToDataUrl(photoFile);
      const photoSaved = await api(`/api/admin/catalog/products/${encodeURIComponent(selected.id)}/photo`, {
        method: 'POST',
        body: JSON.stringify({ filename: photoFile.name, dataUrl })
      });
      selected = photoSaved.product;
      const index = catalog.findIndex((p) => p.id === selected.id);
      if (index >= 0) catalog[index] = selected;
      photoFile = null;
      $('photoInput').value = '';
    }

    renderEditor();
    renderList();
    showResult('Сохранено. Если включён GitHub Sync, Render сам перезапустится и изменения останутся навсегда.');
  } catch (error) {
    showResult(`Ошибка: ${error.message}`, true);
  }
}

async function hideSelected() {
  if (!selected?.id) return;
  if (!confirm('Скрыть товар из каталога? Его можно будет вернуть, поставив точки доступности.')) return;
  try {
    const data = await api(`/api/admin/catalog/products/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
    selected = data.product;
    const index = catalog.findIndex((p) => p.id === selected.id);
    if (index >= 0) catalog[index] = selected;
    renderEditor();
    renderList();
    showResult('Товар скрыт.');
  } catch (error) {
    showResult(`Ошибка: ${error.message}`, true);
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showResult(message, isError = false) {
  const box = $('resultBox');
  box.classList.remove('hidden');
  box.style.color = isError ? '#ffd2d2' : '#d9ffd9';
  box.textContent = message;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[ch]));
}
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, '&#039;'); }

if (pin) loadCatalog();
