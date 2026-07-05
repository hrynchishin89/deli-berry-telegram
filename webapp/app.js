const tg = window.Telegram?.WebApp;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const money = (n) => `${Number(n || 0).toLocaleString('ru-RU')} ₽`;
const today = () => new Date().toISOString().slice(0, 10);

const state = {
  page: localStorage.getItem('db_page') || 'home',
  catalog: [],
  categories: [],
  points: [],
  legal: {},
  selectedPoint: localStorage.getItem('db_selected_point') || 'dybenko',
  category: localStorage.getItem('db_category') || 'hits',
  search: '',
  cart: JSON.parse(localStorage.getItem('db_cart') || '{}'),
  promoCode: localStorage.getItem('db_promo') || '',
  deliveryType: localStorage.getItem('db_delivery_type') || 'pickup',
  busy: false,
  lastOrder: null
};

function initTelegram(){
  try{
    if(!tg) return;
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#120706');
    tg.setBackgroundColor?.('#120706');
    tg.BackButton?.onClick?.(() => {
      if(state.page === 'home') return tg.close?.();
      navigate('home');
    });
  }catch(_e){}
}
function haptic(type='light'){
  try{ tg?.HapticFeedback?.impactOccurred?.(type); }catch(_e){}
}
function toast(msg){
  const box = $('#toast');
  if(!box) return;
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(()=>box.classList.remove('show'),2300);
}
function save(){
  localStorage.setItem('db_cart', JSON.stringify(state.cart));
  localStorage.setItem('db_selected_point', state.selectedPoint || '');
  localStorage.setItem('db_category', state.category || 'hits');
  localStorage.setItem('db_promo', state.promoCode || '');
  localStorage.setItem('db_delivery_type', state.deliveryType || 'pickup');
  localStorage.setItem('db_page', state.page || 'home');
}
function navigate(page, opts={}){
  state.page = page;
  if(opts.category) state.category = opts.category;
  save();
  render();
  window.scrollTo({top:0, behavior: opts.instant ? 'auto':'smooth'});
  try{
    if(tg?.BackButton){ page === 'home' ? tg.BackButton.hide() : tg.BackButton.show(); }
  }catch(_e){}
}
async function loadData(){
  const fallback = {catalog:[], categories:[], points:[], legal:{}};
  try{
    const res = await fetch('/api/catalog', {cache:'no-store'});
    if(!res.ok) throw new Error('catalog api');
    const data = await res.json();
    state.catalog = data.catalog || [];
    state.categories = normalizeCategories(data.categories || []);
    state.points = data.points || [];
    state.legal = data.legal || {};
  }catch(e){
    console.error(e);
    state.catalog = fallback.catalog;
    state.categories = normalizeCategories(fallback.categories);
    state.points = fallback.points;
    state.legal = fallback.legal;
    toast('Каталог не загрузился. Обновите страницу.');
  }
  if(!state.points.find(p=>p.id===state.selectedPoint)) state.selectedPoint = state.points[0]?.id || 'dybenko';
}
function normalizeCategories(cats){
  const base = [{id:'all', name:'Все', emoji:'✨'}];
  const source = cats.length ? cats : [
    {id:'hits',name:'Хиты',emoji:'🔥'}, {id:'strawberry',name:'Клубника',emoji:'🍓'}, {id:'gifts',name:'Подарки',emoji:'🎁'}, {id:'drinks',name:'Напитки',emoji:'🥤'}
  ];
  const seen = new Set();
  return [...base, ...source].filter(c => c?.id && !seen.has(c.id) && seen.add(c.id));
}
function currentPoint(){ return state.points.find(p=>p.id===state.selectedPoint) || state.points[0] || {}; }
function productAvailable(product){
  if(!Array.isArray(product.points) || !product.points.length) return true;
  return product.points.includes(state.selectedPoint);
}
function productText(product){ return [product.name, product.description, product.categoryName, product.unit, product.priceText].join(' ').toLowerCase(); }
function products({category=state.category, limit=0, hits=false, drinks=false}={}){
  const q = state.search.trim().toLowerCase();
  let arr = state.catalog.filter(productAvailable);
  if(drinks) arr = arr.filter(p => p.category === 'drinks' || p.category === 'fresh' || String(p.categoryName||'').toLowerCase().includes('напит'));
  else if(hits) arr = arr.filter(p => p.isHit);
  else if(category && category !== 'all') arr = arr.filter(p => category === 'hits' ? p.isHit : p.category === category);
  if(q) arr = arr.filter(p => productText(p).includes(q));
  if(limit) arr = arr.slice(0, limit);
  return arr;
}
function cartItems(){
  return Object.entries(state.cart).map(([id, qty]) => ({product: state.catalog.find(p=>p.id===id), qty:Number(qty)})).filter(x=>x.product && x.qty>0);
}
function cartCount(){ return cartItems().reduce((s,x)=>s+x.qty,0); }
function cartTotal(){ return cartItems().reduce((s,x)=>s + Number(x.product.price||0)*x.qty,0); }
function addToCart(id){
  const p = state.catalog.find(x=>x.id===id);
  if(!p) return;
  state.cart[id] = Number(state.cart[id]||0)+1;
  save();
  haptic('medium');
  animateCart();
  toast(`${p.name} добавлен`);
  updateChrome();
}
function changeQty(id, delta){
  state.cart[id] = Number(state.cart[id]||0)+delta;
  if(state.cart[id] <= 0) delete state.cart[id];
  save();
  render();
}
function clearCart(){ state.cart = {}; save(); render(); }
function updateChrome(){
  const count = cartCount();
  $('#mini-cart-count').textContent = count;
  const mini = $('#floating-cart');
  if(count && !['cart','checkout','success'].includes(state.page)){
    mini.hidden = false;
    $('#floating-cart-label').textContent = `${count} ${plural(count,'товар','товара','товаров')}`;
    $('#floating-cart-total').textContent = money(cartTotal());
  } else mini.hidden = true;
  $$('.bottom-nav button').forEach(b=>b.classList.toggle('active', b.dataset.nav === state.page || (state.page==='checkout' && b.dataset.nav==='cart')));
}
function animateCart(){
  const chip = $('.cart-chip');
  chip?.classList.remove('pop');
  void chip?.offsetWidth;
  chip?.classList.add('pop');
}
function plural(n,a,b,c){ const m=n%10, mm=n%100; return mm>=11&&mm<=14?c:m===1?a:m>=2&&m<=4?b:c; }
function categoryName(cat){ return state.categories.find(c=>c.id===cat)?.name || 'Каталог'; }
function productArt(product, cls='product-art'){
  const image = String(product.image || '').trim();
  const emoji = product.emoji || (product.category==='drinks'?'🥤':product.category==='dubai'?'✨':product.category==='sweets'?'🍫':'🍓');
  return `<div class="${cls}">
    ${product.badge ? `<span class="badge">${escapeHtml(product.badge)}</span>`:''}
    ${image ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(product.name)}" loading="lazy" onerror="this.remove();this.parentElement.insertAdjacentHTML('beforeend','<span class=&quot;emoji&quot;>${emoji}</span>')">` : `<span class="emoji">${emoji}</span><img class="fallback-logo" src="/assets/brand/mascot-square.jpg" alt="">`}
  </div>`;
}
function productCard(p, i=0){
  return `<article class="product-card reveal" style="animation-delay:${Math.min(i*22,240)}ms" data-product="${escapeAttr(p.id)}">
    ${productArt(p)}
    <div class="product-body">
      <div class="product-title">${escapeHtml(p.name)}</div>
      <div class="product-meta">${escapeHtml(p.unit || p.categoryName || '')}</div>
      <div class="product-meta">${escapeHtml(short(p.description || '', 92))}</div>
      <div class="product-bottom">
        <div class="price">${escapeHtml(p.priceText || money(p.price))}</div>
        <div class="mini-actions">
          <button class="round-btn info-btn" data-info="${escapeAttr(p.id)}" type="button" aria-label="Подробнее">i</button>
          <button class="round-btn" data-add="${escapeAttr(p.id)}" type="button" aria-label="Добавить">+</button>
        </div>
      </div>
    </div>
  </article>`;
}
function render(){
  const app = $('#app');
  const map = {home: renderHome, catalog: renderCatalog, drinks: renderDrinks, cart: renderCart, checkout: renderCheckout, success: renderSuccess};
  app.innerHTML = (map[state.page] || renderHome)();
  bindPage();
  updateChrome();
}
function renderHome(){
  const hit = products({hits:true, limit:6});
  const drink = products({drinks:true, limit:3});
  return `<section class="page home-page">
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">premium dessert app</span>
        <h1>Соберите сладкий подарок за 30 секунд</h1>
        <p>Клубника в шоколаде, подарочные боксы, дубайский шоколад, десерты и авторские напитки. Выберите точку — менеджер подтвердит наличие и время.</p>
        <div class="hero-actions">
          <button class="primary" data-nav="catalog" type="button">🍓 Открыть каталог</button>
          <button class="secondary" data-nav="drinks" type="button">🥤 Напитки</button>
        </div>
      </div>
      <div class="hero-art"><div class="hero-card-3d"><img src="/assets/brand/logo-main.jpg" alt="Deli Berry"><div class="hero-badge">gift<br>ready</div></div></div>
    </section>
    <div class="notice">⚠️ Цены и наличие из публичного меню Яндекс/Yango Deli. Перед оплатой менеджер подтверждает заказ.</div>
    ${renderPoints()}
    <section class="section">
      <div class="quick-grid">
        <button class="quick-card" data-nav="catalog" data-set-category="hits"><b>Хиты</b><span>лучшие позиции</span><i>🔥</i></button>
        <button class="quick-card" data-nav="catalog" data-set-category="strawberry"><b>Клубника</b><span>наборы и боксы</span><i>🍓</i></button>
        <button class="quick-card" data-nav="catalog" data-set-category="gifts"><b>Подарки</b><span>для свиданий и праздников</span><i>🎁</i></button>
        <button class="quick-card" data-nav="drinks"><b>Напитки</b><span>мохито, смузи, фреш</span><i>🥤</i></button>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Популярное</h2><span>${hit.length} позиций</span></div>
      <div class="product-grid">${hit.map(productCard).join('') || empty('Выберите другую точку — для неё пока нет хитов.')}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Напитки к подарку</h2><span>${drink.length} позиций</span></div>
      <div class="product-grid">${drink.map(productCard).join('') || empty('Напитки для этой точки пока не найдены.')}</div>
    </section>
  </section>`;
}
function renderPoints(){
  return `<section class="section"><div class="section-head"><h2>Точка</h2><span>выберите, откуда заказ</span></div><div class="point-grid">${state.points.map(p=>`<button class="point-card ${p.id===state.selectedPoint?'active':''}" data-point="${escapeAttr(p.id)}" type="button"><b>${escapeHtml(p.name)}</b><p>${escapeHtml(p.address)}</p><p>График: ${escapeHtml(p.schedule||'уточняется')}</p></button>`).join('')}</div></section>`;
}
function renderCatalog(){
  const arr = products();
  return `<section class="page catalog-page">
    <div class="section-head"><h2>${escapeHtml(categoryName(state.category))}</h2><span>${arr.length} позиций</span></div>
    ${renderPoints()}
    ${renderToolbar()}
    <div class="product-grid">${arr.map(productCard).join('') || empty('Ничего не найдено. Попробуйте другую категорию или точку.')}</div>
  </section>`;
}
function renderDrinks(){
  const arr = products({drinks:true});
  return `<section class="page drinks-page">
    <section class="hero" style="min-height:280px">
      <div class="hero-copy"><span class="eyebrow">drinks bar</span><h1>Напитки к десертам</h1><p>Мохито, лимонады, смузи, фреши и холодные напитки из публичного меню Яндекс.</p><div class="hero-actions"><button class="primary" data-nav="catalog" type="button">🍓 К десертам</button></div></div>
      <div class="hero-art"><div class="hero-badge">cold<br>fresh</div><span style="font-size:110px">🥤</span></div>
    </section>
    ${renderPoints()}
    ${renderToolbar(false)}
    <div class="product-grid">${arr.map(productCard).join('') || empty('Напитки для выбранной точки пока не найдены.')}</div>
  </section>`;
}
function renderToolbar(showCategories=true){
  return `<section class="section"><div class="toolbar"><input class="search" value="${escapeAttr(state.search)}" data-search placeholder="Поиск: клубника, мохито, дубайский шоколад…"><button class="ghost dark" data-clear-search type="button">Очистить</button></div>${showCategories?`<div class="category-strip">${state.categories.map(c=>`<button class="chip ${c.id===state.category?'active':''}" data-category="${escapeAttr(c.id)}" type="button">${c.emoji||''} ${escapeHtml(c.name)}</button>`).join('')}</div>`:''}</section>`;
}
function renderCart(){
  const items = cartItems();
  return `<section class="page cart-page"><div class="section-head"><h2>Корзина</h2><span>${cartCount()} ${plural(cartCount(),'товар','товара','товаров')}</span></div>
    <div class="cart-list">${items.map(({product,qty})=>`<div class="cart-item"><div><b>${escapeHtml(product.name)}</b><div class="product-meta">${escapeHtml(product.unit || product.categoryName || '')}</div><div class="price">${money(Number(product.price||0)*qty)}</div></div><div class="qty"><button data-qty="${escapeAttr(product.id)}" data-delta="-1" type="button">−</button><b>${qty}</b><button data-qty="${escapeAttr(product.id)}" data-delta="1" type="button">+</button></div></div>`).join('') || empty('Корзина пустая. Добавьте клубнику, подарок или напиток.')}</div>
    <div class="total-card"><div class="total-row"><span>Итого ориентировочно</span><b>${money(cartTotal())}</b></div><button class="primary full" ${items.length?'data-nav="checkout"':'disabled'} type="button">Оформить заказ</button>${items.length?'<button class="ghost dark full" data-clear-cart type="button" style="margin-top:10px">Очистить корзину</button>':''}</div>
  </section>`;
}
function renderCheckout(){
  if(!cartCount()) return renderCart();
  const point = currentPoint();
  return `<section class="page checkout-page"><div class="section-head"><h2>Оформление</h2><span>${money(cartTotal())}</span></div>
    <form class="form-card" id="order-form">
      <div class="switch-row"><label><input type="radio" name="deliveryType" value="pickup" ${state.deliveryType==='pickup'?'checked':''}> Самовывоз</label><label><input type="radio" name="deliveryType" value="delivery" ${state.deliveryType==='delivery'?'checked':''}> Доставка</label></div>
      <div class="field"><span>Точка</span><select name="pointId">${state.points.map(p=>`<option value="${escapeAttr(p.id)}" ${p.id===state.selectedPoint?'selected':''}>${escapeHtml(p.name)} — ${escapeHtml(p.shortAddress || p.address)}</option>`).join('')}</select></div>
      <div class="two"><label class="field"><span>Имя</span><input name="name" autocomplete="name" required placeholder="Ваше имя"></label><label class="field"><span>Телефон</span><input name="phone" inputmode="tel" autocomplete="tel" required placeholder="+7…"></label></div>
      <div class="field delivery-address" ${state.deliveryType==='delivery'?'':'style="display:none"'}><span>Адрес доставки</span><input name="address" placeholder="Улица, дом, подъезд, квартира"></div>
      <div class="two"><label class="field"><span>Дата</span><input name="date" type="date" value="${today()}" required></label><label class="field"><span>Время</span><input name="time" type="time" required></label></div>
      <label class="field"><span>Комментарий</span><textarea name="comment" rows="3" placeholder="Надпись, пожелания, аллергии, детали подарка"></textarea></label>
      <label class="field"><span>Промокод</span><input name="promoCode" value="${escapeAttr(state.promoCode)}" placeholder="BERRY5"></label>
      <label class="checkbox"><input name="legal" type="checkbox" required><span>Согласен/согласна на обработку персональных данных. Понимаю, что наличие, цену и время подтверждает менеджер.</span></label>
      <div class="notice">${escapeHtml(state.legal.orderConfirmation || 'Менеджер подтвердит наличие и время приготовления.')}</div>
      <div class="error" id="form-error"></div>
      <button class="primary full" type="submit">Отправить заказ</button>
      <button class="ghost dark full" data-nav="cart" type="button">Назад в корзину</button>
    </form>
  </section>`;
}
function renderSuccess(){
  const orderId = state.lastOrder?.orderId || JSON.parse(localStorage.getItem('db_last_order') || '{}')?.orderId || '';
  return `<section class="page success-page"><div class="success-card"><div style="font-size:56px">🍓</div><h1>Заказ отправлен</h1><p>Номер: <b>${escapeHtml(orderId || 'создан')}</b></p><p>Менеджер подтвердит наличие, время и оплату.</p><button class="primary" data-nav="home" type="button">На главную</button></div></section>`;
}
function empty(text){ return `<div class="empty">${escapeHtml(text)}</div>`; }
function openProduct(id){
  const p = state.catalog.find(x=>x.id===id); if(!p) return;
  const modal = $('#product-modal');
  modal.innerHTML = `<div class="modal-panel"><div class="modal-head"><div><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(p.categoryName || '')}</p></div><button class="icon-btn" data-close-modal type="button">×</button></div><div class="modal-body">${productArt(p,'modal-art')}<p>${escapeHtml(p.description || '')}</p><div class="specs"><div class="spec"><b>Цена</b><span>${escapeHtml(p.priceText || money(p.price))}</span></div><div class="spec"><b>Вес / объём</b><span>${escapeHtml(p.unit || 'уточняется')}</span></div><div class="spec"><b>Состав</b><span>${escapeHtml(p.composition || 'уточняется')}</span></div><div class="spec"><b>Аллергены</b><span>${escapeHtml(p.allergens || state.legal.allergens || 'уточняется')}</span></div><div class="spec"><b>Срок годности</b><span>${escapeHtml(p.shelfLife || state.legal.shelfLife || 'уточняется')}</span></div></div><button class="primary full" data-add="${escapeAttr(p.id)}" data-close-after-add type="button">Добавить в заказ</button></div></div>`;
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); document.body.classList.add('no-scroll'); haptic();
}
function closeProduct(){ const modal=$('#product-modal'); modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); modal.innerHTML=''; document.body.classList.remove('no-scroll'); }
function bindPage(){
  $$('[data-search]').forEach(input=>{ input.addEventListener('input', e=>{state.search=e.target.value; render();}); setTimeout(()=>{ try{ const v=input.value; input.focus({preventScroll:true}); input.value=''; input.value=v; }catch(_e){} },0); });
}
async function submitOrder(form){
  if(state.busy) return; state.busy = true;
  const fd = new FormData(form);
  state.selectedPoint = String(fd.get('pointId') || state.selectedPoint);
  state.deliveryType = String(fd.get('deliveryType') || 'pickup');
  state.promoCode = String(fd.get('promoCode') || '').trim().toUpperCase();
  save();
  const payload = {
    source: tg ? 'telegram-mini-app' : 'web-direct', initData: tg?.initData || '', telegramUser: tg?.initDataUnsafe?.user || null,
    pointId: state.selectedPoint, deliveryType: state.deliveryType,
    customer: {name: fd.get('name'), phone: fd.get('phone')}, deliveryAddress: fd.get('address'), date: fd.get('date'), time: fd.get('time'), comment: fd.get('comment'), legalAccepted: Boolean(fd.get('legal')), promoCode: state.promoCode,
    items: cartItems().map(({product,qty})=>({id: product.id, qty}))
  };
  const btn = form.querySelector('[type="submit"]'); const error = $('#form-error');
  btn.disabled = true; btn.textContent = 'Отправляем…'; error.textContent = '';
  try{
    const res = await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error((data.errors || [data.error]).filter(Boolean).join('\n') || 'Ошибка отправки заказа');
    state.lastOrder = {orderId:data.orderId, total:data.total, at:new Date().toISOString()};
    localStorage.setItem('db_last_order', JSON.stringify(state.lastOrder));
    state.cart = {}; save(); haptic('heavy'); navigate('success');
  }catch(e){ error.textContent = e.message; toast(e.message); try{tg?.showAlert?.(e.message)}catch(_e){} }
  finally{ state.busy=false; btn.disabled=false; btn.textContent='Отправить заказ'; }
}
document.addEventListener('click', (e)=>{
  const nav = e.target.closest('[data-nav]'); if(nav){ e.preventDefault(); const cat=nav.dataset.setCategory; if(cat) state.category=cat; navigate(nav.dataset.nav); return; }
  const point = e.target.closest('[data-point]'); if(point){ state.selectedPoint=point.dataset.point; save(); haptic(); render(); return; }
  const cat = e.target.closest('[data-category]'); if(cat){ state.category=cat.dataset.category; save(); haptic(); render(); return; }
  const add = e.target.closest('[data-add]'); if(add){ addToCart(add.dataset.add); if(add.hasAttribute('data-close-after-add')) closeProduct(); return; }
  const info = e.target.closest('[data-info], [data-product]'); if(info && !e.target.closest('[data-add]') && !e.target.closest('[data-info]')){ openProduct(info.dataset.product); return; }
  const infoBtn = e.target.closest('[data-info]'); if(infoBtn){ openProduct(infoBtn.dataset.info); return; }
  const qty = e.target.closest('[data-qty]'); if(qty){ changeQty(qty.dataset.qty, Number(qty.dataset.delta)); return; }
  if(e.target.closest('[data-close-modal]') || e.target.id === 'product-modal'){ closeProduct(); return; }
  if(e.target.closest('[data-clear-search]')){ state.search=''; render(); return; }
  if(e.target.closest('[data-clear-cart]')){ clearCart(); toast('Корзина очищена'); return; }
});
document.addEventListener('change', (e)=>{
  if(e.target.name === 'deliveryType'){ state.deliveryType = e.target.value; save(); render(); }
  if(e.target.name === 'pointId'){ state.selectedPoint = e.target.value; save(); }
});
document.addEventListener('submit', (e)=>{ if(e.target.id === 'order-form'){ e.preventDefault(); submitOrder(e.target); } });
function escapeHtml(s){ return String(s ?? '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch])); }
function escapeAttr(s){ return escapeHtml(s).replace(/'/g,'&#39;'); }
function short(s,n){ s=String(s||''); return s.length>n?s.slice(0,n-1)+'…':s; }
(async function main(){
  initTelegram();
  $('#app').innerHTML = '<div class="loading"><div><div class="pulse"></div><p>Загружаем сладкую витрину…</p></div></div>';
  await loadData();
  if(!state.catalog.length){ state.catalog = [{id:'demo-1',name:'Клубника в шоколаде',category:'strawberry',categoryName:'Клубника',price:2599,priceText:'2 599 ₽',emoji:'🍓',isHit:true,points:[state.selectedPoint]}]; }
  if(!state.categories.length) state.categories = normalizeCategories([]);
  if(!['home','catalog','drinks','cart','checkout','success'].includes(state.page)) state.page='home';
  render();
})();
