// Deli Berry V5 FINAL Commercial — V3 polish + V4 Motion 3D + manager replies/payments + final release polish
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

function track(event, payload={}){
  try{
    const item = {event, payload, page: state.page, at: new Date().toISOString()};
    const list = JSON.parse(localStorage.getItem('db_analytics') || '[]');
    list.push(item);
    localStorage.setItem('db_analytics', JSON.stringify(list.slice(-250)));
  }catch(_e){}
}
const trackEvent = track;

function save(){
  localStorage.setItem('db_cart', JSON.stringify(state.cart));
  localStorage.setItem('db_selected_point', state.selectedPoint || '');
  localStorage.setItem('db_category', state.category || 'hits');
  localStorage.setItem('db_promo', state.promoCode || '');
  localStorage.setItem('db_delivery_type', state.deliveryType || 'pickup');
  localStorage.setItem('db_page', state.page || 'home');
}
function navigate(page, opts={}){
  track('navigate', {to: page, category: opts.category || ''});
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
function addToCart(id, sourceEl=null){
  const p = state.catalog.find(x=>x.id===id);
  if(!p) return;
  track('add_to_cart', {id: p.id, name: p.name, price: p.price});
  state.cart[id] = Number(state.cart[id]||0)+1;
  save();
  haptic('medium');
  animateCart(sourceEl, p);
  toast(`${p.name} добавлен`);
  trackEvent('add_to_cart', {id:p.id, name:p.name, price:p.price, page:state.page});
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
function animateCart(sourceEl=null, product=null){
  const chip = $('.cart-chip');
  chip?.classList.remove('pop');
  void chip?.offsetWidth;
  chip?.classList.add('pop');
  if(sourceEl && chip){
    const a = sourceEl.getBoundingClientRect();
    const b = chip.getBoundingClientRect();
    const fly = document.createElement('div');
    fly.className = 'cart-fly';
    fly.textContent = product?.emoji || categoryEmoji(product?.category);
    fly.style.left = `${a.left + a.width/2}px`;
    fly.style.top = `${a.top + a.height/2}px`;
    fly.style.setProperty('--tx', `${b.left + b.width/2 - (a.left+a.width/2)}px`);
    fly.style.setProperty('--ty', `${b.top + b.height/2 - (a.top+a.height/2)}px`);
    document.body.appendChild(fly);
    setTimeout(()=>fly.remove(),760);
  }
}
function plural(n,a,b,c){ const m=n%10, mm=n%100; return mm>=11&&mm<=14?c:m===1?a:m>=2&&m<=4?b:c; }

function categoryName(cat){ return state.categories.find(c=>c.id===cat)?.name || 'Каталог'; }
function productRank(p){
  const categoryScore = {strawberry:0, gifts:1, dubai:2, sweets:3, desserts:4, fresh:5, drinks:6, summer:7};
  const badgeScore = p.isHit ? -10 : 0;
  return badgeScore + (categoryScore[p.category] ?? 10);
}
function sortForBoutique(arr){
  return [...arr].sort((a,b)=> productRank(a)-productRank(b) || Number(a.price||0)-Number(b.price||0));
}
function categoryEmoji(category){
  return ({strawberry:'🍓', gifts:'🎁', dubai:'✨', drinks:'🥤', fresh:'🍊', sweets:'🍫', desserts:'🍰', summer:'☀️'})[category] || '🍓';
}
function artTone(product){
  const category = product.category || 'default';
  const name = String(product.name || '').toLowerCase();
  if(category === 'drinks' || category === 'fresh') return 'drink';
  if(category === 'dubai' || name.includes('дубай')) return 'dubai';
  if(category === 'gifts' || name.includes('подар') || name.includes('люб')) return 'gift';
  if(category === 'sweets' || category === 'desserts') return 'choco';
  return 'berry';
}
function renderHomeStats(){
  const count = state.catalog.filter(productAvailable).length;
  const drinks = products({drinks:true}).length;
  const point = currentPoint();
  return `<section class="stats-row reveal"><div><b>${count}</b><span>позиций</span></div><div><b>${drinks}</b><span>напитков</span></div><div><b>${escapeHtml(point?.name || '2 точки')}</b><span>самовывоз / доставка</span></div></section>`;
}
function renderTrustStrip(){
  return `<section class="trust-strip reveal"><div><b>30 сек</b><span>быстрый заказ</span></div><div><b>2 точки</b><span>Дыбенко и Ржавки</span></div><div><b>QR</b><span>оплата после подтверждения</span></div><div><b>Фото</b><span>подарок к нужному времени</span></div></section>`;
}

function renderExperienceStrip(){
  return `<section class="experience-strip reveal"><div><i>01</i><b>Выберите подарок</b><span>клубника, боксы, шоколад</span></div><div><i>02</i><b>Добавьте напиток</b><span>мохито, смузи, фреш</span></div><div><i>03</i><b>Менеджер подтвердит</b><span>время, наличие и оплату</span></div></section>`;
}

function renderTrustStrip(){
  return `<section class="trust-strip reveal">
    <div class="trust-item"><b>30 сек</b><span>быстрый сбор заказа</span></div>
    <div class="trust-item"><b>2 точки</b><span>Дыбенко и Ржавки</span></div>
    <div class="trust-item"><b>QR / ссылка</b><span>оплата после подтверждения</span></div>
    <div class="trust-item"><b>Подарок</b><span>готовим к событию и времени</span></div>
  </section>`;
}

function modelKind(product){
  const category = String(product.category || '').toLowerCase();
  const name = String(product.name || '').toLowerCase();
  if(category === 'drinks' || category === 'fresh' || name.includes('мохито') || name.includes('смузи') || name.includes('лимонад')) return 'cup';
  if(category === 'gifts' || name.includes('подар') || name.includes('бокс') || name.includes('набор')) return 'box';
  if(category === 'dubai' || name.includes('дубай') || name.includes('шоколад')) return 'bar';
  return 'berry';
}
function productArt(product, cls='product-art'){
  const image = String(product.image || '').trim();
  const emoji = product.emoji || categoryEmoji(product.category);
  const tone = artTone(product);
  const kind = modelKind(product);
  const badge = product.badge ? `<span class="badge motion-badge">${escapeHtml(product.badge)}</span>` : '';
  const visual = image
    ? `<img class="model-image" src="${escapeAttr(image)}" alt="${escapeAttr(product.name)}" loading="lazy" onerror="this.outerHTML='<span class=&quot;emoji model-emoji&quot;>${emoji}</span>'">`
    : `<span class="emoji model-emoji">${emoji}</span>`;
  return `<div class="${cls} art-${escapeAttr(tone)} product-art-3d">
    ${badge}
    <div class="model-stage model-${escapeAttr(kind)}" data-rotatable data-model-id="${escapeAttr(product.id || '')}" aria-label="3D preview">
      <span class="model-glow"></span>
      <span class="model-ring ring-a"></span>
      <span class="model-ring ring-b"></span>
      <span class="model-orbit orbit-a"></span>
      <span class="model-orbit orbit-b"></span>
      <span class="model-spark spark-a">✦</span>
      <span class="model-spark spark-b">✧</span>
      <span class="model-spark spark-c">✦</span>
      <div class="model-turntable">
        <span class="model-shadow"></span>
        <span class="model-side side-left"></span>
        <span class="model-side side-right"></span>
        ${visual}
        <span class="model-highlight"></span>
      </div>
      <span class="model-floor"></span>
    </div>
  </div>`;
}
function productCard(p, i=0){
  return `<article class="product-card reveal card-tilt tone-${escapeAttr(artTone(p))}" style="animation-delay:${Math.min(i*32,280)}ms" data-product="${escapeAttr(p.id)}">
    ${productArt(p)}
    <div class="product-body">
      <div class="product-kicker">${escapeHtml(p.categoryName || categoryName(p.category))}</div>
      <div class="product-title">${escapeHtml(p.name)}</div>
      <div class="product-meta">${escapeHtml(p.unit || '')}</div>
      <div class="product-description">${escapeHtml(short(p.description || '', 102))}</div>
      <div class="product-bottom">
        <div class="price">${escapeHtml(p.priceText || money(p.price))}</div>
        <div class="mini-actions">
          <button class="round-btn info-btn" data-info="${escapeAttr(p.id)}" type="button" aria-label="Подробнее">i</button>
          <button class="round-btn add-btn" data-add="${escapeAttr(p.id)}" type="button" aria-label="Добавить">+</button>
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
  const hit = sortForBoutique(products({hits:true, limit:0})).slice(0,6);
  const gifts = sortForBoutique(products({category:'gifts', limit:0})).slice(0,4);
  const drink = sortForBoutique(products({drinks:true, limit:0})).slice(0,3);
  return `<section class="page home-page">
    <section class="hero reveal">
      <div class="hero-copy">
        <span class="eyebrow">premium dessert boutique</span>
        <h1>Подарки, десерты и напитки с вау‑эффектом</h1>
        <p>Клубника в шоколаде, подарочные боксы, дубайский шоколад и авторские напитки. Соберите заказ за минуту — менеджер подтвердит наличие, время и оплату.</p>
        <div class="release-chip">✨ V5 commercial release · Telegram ready</div>
        <div class="hero-actions">
          <button class="primary magnetic" data-nav="catalog" type="button">🍓 Собрать подарок</button>
          <button class="secondary magnetic" data-nav="drinks" type="button">🥤 Выбрать напиток</button>
        </div>
      </div>
      <div class="hero-art">
        <div class="hero-card-3d card-tilt">
          <img src="/assets/brand/logo-main.jpg" alt="Deli Berry">
          <div class="hero-badge">gift<br>ready</div>
        </div>
      </div>
    </section>
    ${renderHomeStats()}
    ${renderTrustStrip()}
    ${renderExperienceStrip()}
    ${renderTrustStrip()}
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
      <div class="product-grid priority-grid">${hit.map(productCard).join('') || empty('Выберите другую точку — для неё пока нет хитов.')}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Подарки дня</h2><span>${gifts.length} позиций</span></div>
      <div class="product-grid compact-grid">${gifts.map(productCard).join('') || empty('Подарочные позиции для этой точки пока уточняются.')}</div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Напитки к десерту</h2><span>${drink.length} позиций</span></div>
      <div class="product-grid compact-grid">${drink.map(productCard).join('') || empty('Напитки для этой точки пока не найдены.')}</div>
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
      <div class="hero-copy"><span class="eyebrow">fresh drinks bar</span><h1>Напитки, которые усиливают подарок</h1><p>Мохито, лимонады, смузи и фреши — отдельный быстрый раздел для допродажи к клубнике и подарочным боксам.</p><div class="hero-actions"><button class="primary magnetic" data-nav="catalog" type="button">🍓 К десертам</button></div></div>
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
function renderOrderSummary(){
  const items = cartItems();
  if(!items.length) return '';
  return `<div class="order-summary"><div class="summary-title"><b>Ваш заказ</b><span>${money(cartTotal())}</span></div>${items.map(({product,qty})=>`<div class="summary-line"><span>${escapeHtml(product.name)} × ${qty}</span><b>${money(Number(product.price||0)*qty)}</b></div>`).join('')}</div>`;
}
function renderCartUpsell(){
  const idsInCart = new Set(cartItems().map(x=>x.product.id));
  const drinkInCart = cartItems().some(x => ['drinks','fresh'].includes(x.product.category));
  const candidates = sortForBoutique(products({drinks:true})).filter(p=>!idsInCart.has(p.id)).slice(0,3);
  if(!candidates.length || drinkInCart) return '';
  return `<section class="section upsell-section"><div class="section-head"><h2>Добавьте напиток</h2><span>допродажа к подарку</span></div><div class="product-grid compact-grid upsell-grid">${candidates.map(productCard).join('')}</div></section>`;
}

function renderCart(){
  const items = cartItems();
  return `<section class="page cart-page"><div class="section-head"><h2>Корзина</h2><span>${cartCount()} ${plural(cartCount(),'товар','товара','товаров')}</span></div>
    <div class="cart-list">${items.map(({product,qty})=>`<div class="cart-item"><div><b>${escapeHtml(product.name)}</b><div class="product-meta">${escapeHtml(product.unit || product.categoryName || '')}</div><div class="price">${money(Number(product.price||0)*qty)}</div></div><div class="qty"><button data-qty="${escapeAttr(product.id)}" data-delta="-1" type="button">−</button><b>${qty}</b><button data-qty="${escapeAttr(product.id)}" data-delta="1" type="button">+</button></div></div>`).join('') || empty('Корзина пустая. Добавьте клубнику, подарок или напиток.')}</div>
    <div class="total-card"><div class="total-row"><span>Итого ориентировочно</span><b>${money(cartTotal())}</b></div><button class="primary full" ${items.length?'data-nav="checkout"':'disabled'} type="button">Оформить заказ</button>${items.length?'<button class="ghost dark full" data-clear-cart type="button" style="margin-top:10px">Очистить корзину</button>':''}</div>
    ${items.length ? renderCartUpsell() : ''}
  </section>`;
}
function renderCheckout(){
  if(!cartCount()) return renderCart();
  const point = currentPoint();
  return `<section class="page checkout-page"><div class="section-head"><h2>Оформление</h2><span>${money(cartTotal())}</span></div>
    ${renderOrderSummary()}
    <form class="form-card" id="order-form">
      <div class="switch-row"><label><input type="radio" name="deliveryType" value="pickup" ${state.deliveryType==='pickup'?'checked':''}> Самовывоз</label><label><input type="radio" name="deliveryType" value="delivery" ${state.deliveryType==='delivery'?'checked':''}> Доставка</label></div>
      <div class="field"><span>Точка</span><select name="pointId">${state.points.map(p=>`<option value="${escapeAttr(p.id)}" ${p.id===state.selectedPoint?'selected':''}>${escapeHtml(p.name)} — ${escapeHtml(p.shortAddress || p.address)}</option>`).join('')}</select></div>
      <div class="two"><label class="field"><span>Имя</span><input name="name" autocomplete="name" required placeholder="Ваше имя"></label><label class="field"><span>Телефон</span><input name="phone" inputmode="tel" autocomplete="tel" required placeholder="+7…"></label></div>
      <div class="field delivery-address" ${state.deliveryType==='delivery'?'':'style="display:none"'}><span>Адрес доставки</span><input name="address" placeholder="Улица, дом, подъезд, квартира"></div>
      <div class="two"><label class="field"><span>Дата</span><input name="date" type="date" value="${today()}" required></label><label class="field"><span>Время</span><input name="time" type="time" required></label></div>
      <label class="field"><span>Комментарий</span><textarea name="comment" rows="3" placeholder="Надпись, пожелания, аллергии, детали подарка"></textarea></label>
      <label class="field"><span>Промокод</span><input name="promoCode" value="${escapeAttr(state.promoCode)}" placeholder="BERRY5"></label>
      <label class="checkbox"><input name="legal" type="checkbox" required><span>Согласен/согласна на обработку персональных данных. Понимаю, что наличие, цену и время подтверждает менеджер.</span></label>
      <div class="checkout-hint">${escapeHtml(state.legal.orderConfirmation || 'Менеджер подтвердит наличие, время и способ оплаты.')}</div>
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
  track('view_product', {id: p.id, name: p.name});
  const modal = $('#product-modal');
  modal.innerHTML = `<div class="modal-panel"><div class="modal-head"><div><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(p.categoryName || '')}</p></div><button class="icon-btn" data-close-modal type="button">×</button></div><div class="modal-body">${productArt(p,'modal-art')}<p>${escapeHtml(p.description || '')}</p><div class="specs"><div class="spec"><b>Цена</b><span>${escapeHtml(p.priceText || money(p.price))}</span></div><div class="spec"><b>Вес / объём</b><span>${escapeHtml(p.unit || 'уточняется')}</span></div><div class="spec"><b>Состав</b><span>${escapeHtml(p.composition || 'уточняется')}</span></div><div class="spec"><b>Аллергены</b><span>${escapeHtml(p.allergens || state.legal.allergens || 'уточняется')}</span></div><div class="spec"><b>Срок годности</b><span>${escapeHtml(p.shelfLife || state.legal.shelfLife || 'уточняется')}</span></div></div><button class="primary full" data-add="${escapeAttr(p.id)}" data-close-after-add type="button">Добавить в заказ</button></div></div>`;
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); document.body.classList.add('no-scroll'); trackEvent('view_product', {id:p.id, name:p.name, category:p.category}); requestAnimationFrame(()=>bindMotionModels(modal)); haptic();
}
function closeProduct(){ const modal=$('#product-modal'); modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); modal.innerHTML=''; document.body.classList.remove('no-scroll'); }
function bindPage(){
  $$('[data-search]').forEach(input=>{
    input.addEventListener('input', e=>{state.search=e.target.value; render();});
    setTimeout(()=>{ try{ const v=input.value; input.focus({preventScroll:true}); input.value=''; input.value=v; }catch(_e){} },0);
  });
  requestAnimationFrame(()=>{
    $$('.reveal').forEach((el, idx)=>{
      el.style.animationDelay = el.style.animationDelay || `${Math.min(idx*24, 260)}ms`;
      el.classList.add('in-view');
    });
    setupTilt();
    bindMotionModels($('#app'));
  });
}
function setupTilt(){
  if(window.matchMedia('(hover: none)').matches) return;
  $$('.card-tilt').forEach(card=>{
    if(card.dataset.tiltReady) return;
    card.dataset.tiltReady = '1';
    card.addEventListener('pointermove', (e)=>{
      const r = card.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - .5) * 8;
      const y = ((e.clientY - r.top) / r.height - .5) * -8;
      card.style.setProperty('--rx', `${y.toFixed(2)}deg`);
      card.style.setProperty('--ry', `${x.toFixed(2)}deg`);
    });
    card.addEventListener('pointerleave', ()=>{
      card.style.removeProperty('--rx');
      card.style.removeProperty('--ry');
    });
  });
}

function bindMotionModels(root=document){
  $$('.model-stage[data-rotatable]', root).forEach(stage=>{
    if(stage.dataset.motionReady) return;
    stage.dataset.motionReady = '1';
    const apply = (e)=>{
      const r = stage.getBoundingClientRect();
      const px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      const ry = (px - .5) * 34;
      const rx = (.5 - py) * 16;
      stage.style.setProperty('--user-ry', `${ry.toFixed(1)}deg`);
      stage.style.setProperty('--user-rx', `${rx.toFixed(1)}deg`);
      stage.classList.add('user-rotating');
    };
    const reset = ()=>{
      if(stage.classList.contains('dragging')) return;
      stage.classList.remove('user-rotating');
      stage.style.removeProperty('--user-ry');
      stage.style.removeProperty('--user-rx');
    };
    stage.addEventListener('pointermove', apply, {passive:true});
    stage.addEventListener('pointerdown', e=>{
      stage.classList.add('dragging','user-rotating');
      try{ stage.setPointerCapture(e.pointerId); }catch(_e){}
      apply(e);
    });
    stage.addEventListener('pointerup', e=>{
      stage.classList.remove('dragging');
      try{ stage.releasePointerCapture(e.pointerId); }catch(_e){}
      setTimeout(reset, 260);
    });
    stage.addEventListener('pointercancel', reset);
    stage.addEventListener('pointerleave', reset);
  });
}
async function submitOrder(form){
  if(state.busy) return; state.busy = true;
  track('checkout_submit', {items: cartCount(), total: cartTotal()});
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
    trackEvent('order_sent', {orderId:data.orderId, total:data.total, items:payload.items.length, pointId:payload.pointId, deliveryType:payload.deliveryType});
    localStorage.setItem('db_last_order', JSON.stringify(state.lastOrder));
    state.cart = {}; save(); haptic('heavy'); navigate('success');
  }catch(e){ error.textContent = e.message; toast(e.message); try{tg?.showAlert?.(e.message)}catch(_e){} }
  finally{ state.busy=false; btn.disabled=false; btn.textContent='Отправить заказ'; }
}
document.addEventListener('click', (e)=>{
  const nav = e.target.closest('[data-nav]'); if(nav){ e.preventDefault(); const cat=nav.dataset.setCategory; if(cat) state.category=cat; navigate(nav.dataset.nav); return; }
  const point = e.target.closest('[data-point]'); if(point){ state.selectedPoint=point.dataset.point; save(); haptic(); render(); return; }
  const cat = e.target.closest('[data-category]'); if(cat){ state.category=cat.dataset.category; save(); haptic(); render(); return; }
  const add = e.target.closest('[data-add]'); if(add){ addToCart(add.dataset.add, add); if(add.hasAttribute('data-close-after-add')) closeProduct(); return; }
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
  track('open_app');
  await loadData();
  trackEvent('app_open', {source: tg ? 'telegram' : 'web', pointId: state.selectedPoint});
  if(!state.catalog.length){ state.catalog = [{id:'demo-1',name:'Клубника в шоколаде',category:'strawberry',categoryName:'Клубника',price:2599,priceText:'2 599 ₽',emoji:'🍓',isHit:true,points:[state.selectedPoint]}]; }
  if(!state.categories.length) state.categories = normalizeCategories([]);
  if(!['home','catalog','drinks','cart','checkout','success'].includes(state.page)) state.page='home';
  render();
})();
