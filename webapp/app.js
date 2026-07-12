// Deli Berry Production 1.0 — product object stage + cutout-first rendering
const tg = window.Telegram?.WebApp;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const money = (n) => `${Number(n || 0).toLocaleString('ru-RU')} ₽`;
const today = () => new Date().toISOString().slice(0, 10);

const state = {
  page: 'home',
  catalog: [],
  categories: [],
  points: [],
  legal: {},
  bonusRules: {enabled:true, earnPercent:5, maxRedeemPercent:30, rublesPerPoint:1},
  profile: null,
  profileLoading: false,
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
    tg.setHeaderColor?.('#E8DED2');
    tg.setBackgroundColor?.('#E8DED2');
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
  // page intentionally opens from home on each new Mini App launch
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
    state.bonusRules = {...state.bonusRules, ...(data.bonusRules || {})};
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
async function loadProfile({silent=true}={}){
  if(state.profileLoading) return state.profile;
  state.profileLoading = true;
  try{
    const res = await fetch('/api/me', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({initData:tg?.initData || '', telegramUser:tg?.initDataUnsafe?.user || null})
    });
    const data = await res.json().catch(()=>({}));
    if(res.ok && data.profile){
      state.profile = data.profile;
      state.bonusRules = {...state.bonusRules, ...(data.bonusRules || {})};
    }else if(!silent && data.error){ toast(data.error); }
  }catch(e){ if(!silent) toast('Профиль временно недоступен'); }
  finally{ state.profileLoading=false; updateChrome(); }
  return state.profile;
}
function bonusBalance(){ return Number(state.profile?.customer?.bonusBalance || 0); }
function maxBonusRedeem(){
  if(!state.bonusRules?.enabled) return 0;
  return Math.max(0, Math.min(bonusBalance(), Math.floor(cartTotal() * Number(state.bonusRules.maxRedeemPercent || 0) / 100)));
}
function bonusEarnEstimate(bonusUse=0){
  const cash = Math.max(0, cartTotal() - Math.max(0, Number(bonusUse || 0)));
  return Math.max(0, Math.round(cash * Number(state.bonusRules.earnPercent || 0) / 100));
}

function normalizeCategories(cats){
  const base = [{id:'all', name:'Все', emoji:'✨'}];
  const source = cats.length ? cats : [
    {id:'hits',name:'Хиты',emoji:'🔥'}, {id:'strawberry',name:'Клубника',emoji:'🍓'}, {id:'gifts',name:'Подарки',emoji:'🎁'}, {id:'drinks',name:'Напитки',emoji:'🥤'}, {id:'coffee',name:'Кофе',emoji:'☕'}
  ];
  const seen = new Set();
  return [...base, ...source].filter(c => c?.id && !seen.has(c.id) && seen.add(c.id));
}
function currentPoint(){ return state.points.find(p=>p.id===state.selectedPoint) || state.points[0] || {}; }
function productAvailable(product){
  if(!Array.isArray(product.points)) return true;
  if(!product.points.length) return false;
  return product.points.includes(state.selectedPoint);
}

function productVariants(product){
  return Array.isArray(product?.variants) ? product.variants.filter(v => v && v.id) : [];
}
function hasVariants(product){ return productVariants(product).length > 0; }
function defaultVariant(product){ return productVariants(product)[0] || null; }
function variantById(product, variantId){
  const list = productVariants(product);
  return list.find(v => String(v.id) === String(variantId || '')) || defaultVariant(product);
}
function variantLabel(variant){ return variant?.label || variant?.unit || ''; }
function productOptions(product){
  return Array.isArray(product?.options)
    ? product.options.filter(group => group && group.id && Array.isArray(group.values) && group.values.length)
    : [];
}
function hasOptions(product){ return productOptions(product).length > 0; }
function normalizeOptionSelections(product, input={}){
  const out = {};
  const source = input && typeof input === 'object' ? input : {};
  for(const group of productOptions(product)){
    const selectedId = String(source[group.id] || '');
    const match = group.values.find(value => String(value?.id || '') === selectedId);
    if(match) out[group.id] = String(match.id);
  }
  return out;
}
function optionSignature(product, selections={}){
  const normalized = normalizeOptionSelections(product, selections);
  return productOptions(product)
    .map(group => normalized[group.id] ? `${group.id}=${normalized[group.id]}` : '')
    .filter(Boolean)
    .join('&');
}
function optionLabels(product, selections={}){
  const normalized = normalizeOptionSelections(product, selections);
  return productOptions(product).map(group => {
    const value = group.values.find(item => String(item.id) === String(normalized[group.id] || ''));
    return value ? String(value.label || value.name || value.id) : '';
  }).filter(Boolean);
}
function missingRequiredOptions(product, selections={}){
  const normalized = normalizeOptionSelections(product, selections);
  return productOptions(product).filter(group => group.required !== false && !normalized[group.id]);
}
function cartKey(productId, variantId='', optionSelections={}){
  const product = state.catalog.find(item => item.id === productId);
  const signature = product ? optionSignature(product, optionSelections) : '';
  return [String(productId || ''), String(variantId || ''), signature ? `opt:${encodeURIComponent(signature)}` : '']
    .filter((value, index) => index === 0 || value)
    .join('::');
}
function parseCartKey(key){
  const parts = String(key || '').split('::');
  const productId = parts.shift() || '';
  let variantId = '';
  let signature = '';
  for(const part of parts){
    if(part.startsWith('opt:')) signature = decodeURIComponent(part.slice(4));
    else if(!variantId) variantId = part;
  }
  const options = {};
  for(const pair of signature.split('&')){
    if(!pair) continue;
    const [groupId, valueId] = pair.split('=');
    if(groupId && valueId) options[groupId] = valueId;
  }
  return { productId, variantId, options };
}
function displayPrice(product){
  const vars = productVariants(product);
  if(vars.length){
    const min = Math.min(...vars.map(v => Number(v.price || 0)).filter(n => Number.isFinite(n)));
    return `от ${money(min || product.price || 0)}`;
  }
  return product.priceText || money(product.price);
}
function displayUnit(product){
  const vars = productVariants(product);
  if(vars.length) return vars.map(v => variantLabel(v)).filter(Boolean).join(' / ');
  return product.unit || '';
}
function itemTitle(product, variant=null, selections={}){
  const details = [variantLabel(variant), ...optionLabels(product, selections)].filter(Boolean);
  return details.length ? `${product.name} · ${details.join(' · ')}` : product.name;
}
function itemUnitPrice(product, variant=null){ return Number((variant ? variant.price : product.price) || 0); }
function itemPriceText(product, variant=null){ return variant?.priceText || product.priceText || money(itemUnitPrice(product, variant)); }

function productText(product){ return [product.name, product.description, product.categoryName, product.unit, product.priceText, ...productVariants(product).flatMap(v=>[v.label,v.unit,v.priceText]), ...productOptions(product).flatMap(group=>[group.label,...group.values.flatMap(v=>[v.label,v.name])])].join(' ').toLowerCase(); }
function products({category=state.category, limit=0, hits=false, drinks=false}={}){
  const q = state.search.trim().toLowerCase();
  let arr = state.catalog.filter(productAvailable);
  if(drinks) arr = arr.filter(p => ['drinks','fresh','coffee','smoothies','milkshakes'].includes(p.category) || String(p.categoryName||'').toLowerCase().includes('напит') || String(p.categoryName||'').toLowerCase().includes('кофе'));
  else if(hits) arr = arr.filter(p => p.isHit);
  else if(category && category !== 'all') arr = arr.filter(p => category === 'hits' ? p.isHit : p.category === category);
  if(q) arr = arr.filter(p => productText(p).includes(q));
  if(limit) arr = arr.slice(0, limit);
  return arr;
}
function cartItems(){
  return Object.entries(state.cart).map(([key, qty]) => {
    const parsed = parseCartKey(key);
    const product = state.catalog.find(p => p.id === parsed.productId);
    if(!product) return null;
    const variant = parsed.variantId ? variantById(product, parsed.variantId) : null;
    const options = normalizeOptionSelections(product, parsed.options || {});
    return {key, product, variant, options, qty:Number(qty)};
  }).filter(x => x && x.product && x.qty > 0);
}
function cartCount(){ return cartItems().reduce((s,x)=>s+x.qty,0); }
function cartTotal(){ return cartItems().reduce((s,x)=>s + itemUnitPrice(x.product, x.variant)*x.qty,0); }
function addToCart(id, sourceEl=null, variantId='', optionPayload=''){
  const p = state.catalog.find(x=>x.id===id);
  if(!p) return;
  const variant = variantId ? variantById(p, variantId) : defaultVariant(p);
  let rawOptions = {};
  try{ rawOptions = typeof optionPayload === 'string' && optionPayload ? JSON.parse(optionPayload) : (optionPayload || {}); }catch(_e){ rawOptions = {}; }
  const options = normalizeOptionSelections(p, rawOptions);
  const missing = missingRequiredOptions(p, options);
  if(missing.length){ toast(`Выберите: ${missing.map(group=>group.label || group.id).join(', ')}`); openProduct(p.id); return; }
  const key = cartKey(p.id, variant?.id || '', options);
  const price = itemUnitPrice(p, variant);
  const title = itemTitle(p, variant, options);
  track('add_to_cart', {id: p.id, variantId: variant?.id || '', options, name: title, price});
  state.cart[key] = Number(state.cart[key]||0)+1;
  save();
  haptic('medium');
  animateCart(sourceEl, p);
  toast(`${title} добавлен`);
  trackEvent('add_to_cart', {id:p.id, variantId: variant?.id || '', options, name:title, price, page:state.page});
  updateChrome();
}
function changeQty(key, delta){
  state.cart[key] = Number(state.cart[key]||0)+delta;
  if(state.cart[key] <= 0) delete state.cart[key];
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
  const profileChip = $('#profile-chip');
  if(profileChip){
    const customer = state.profile?.customer;
    profileChip.hidden = !customer;
    if(customer){
      const id = profileChip.querySelector('[data-profile-id]');
      const bonus = profileChip.querySelector('[data-profile-bonus]');
      if(id) id.textContent = customer.publicId || 'Профиль';
      if(bonus) bonus.textContent = `${Number(customer.bonusBalance || 0).toLocaleString('ru-RU')} 🍓`;
    }
  }
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
  const categoryScore = {strawberry:0, gifts:1, dubai:2, sweets:3, desserts:4, coffee:5, milkshakes:6, smoothies:7, fresh:8, drinks:9, summer:10, addons:11};
  const badgeScore = p.isHit ? -10 : 0;
  return badgeScore + (categoryScore[p.category] ?? 10);
}
function sortForBoutique(arr){
  return [...arr].sort((a,b)=> productRank(a)-productRank(b) || Number(a.price||0)-Number(b.price||0));
}
function categoryEmoji(category){
  return ({strawberry:'🍓', gifts:'🎁', dubai:'✨', drinks:'🥤', fresh:'🍊', smoothies:'🥤', milkshakes:'🥛', sweets:'🍫', desserts:'🍰', summer:'☀️', coffee:'☕', addons:'➕'})[category] || '🍓';
}
function artTone(product){
  const category = product.category || 'default';
  const name = String(product.name || '').toLowerCase();
  if(['drinks','fresh','coffee','smoothies','milkshakes'].includes(category)) return 'drink';
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
  return `<section class="trust-strip reveal"><div><b>30 сек</b><span>быстрый заказ</span></div><div><b>2 точки</b><span>Дыбенко и Зеленопарк</span></div><div><b>QR</b><span>оплата после подтверждения</span></div><div><b>Фото</b><span>подарок к нужному времени</span></div></section>`;
}

function renderExperienceStrip(){
  return `<section class="experience-strip reveal"><div><i>01</i><b>Выберите подарок</b><span>клубника, боксы, шоколад</span></div><div><i>02</i><b>Добавьте напиток</b><span>мохито, смузи, фреш</span></div><div><i>03</i><b>Менеджер подтвердит</b><span>время, наличие и оплату</span></div></section>`;
}

function renderTrustStrip(){
  return `<section class="trust-strip reveal">
    <div class="trust-item"><b>30 сек</b><span>быстрый сбор заказа</span></div>
    <div class="trust-item"><b>2 точки</b><span>Дыбенко и Зеленопарк</span></div>
    <div class="trust-item"><b>QR / ссылка</b><span>оплата после подтверждения</span></div>
    <div class="trust-item"><b>Подарок</b><span>готовим к событию и времени</span></div>
  </section>`;
}

function modelKind(product){
  const category = String(product.category || '').toLowerCase();
  const name = String(product.name || '').toLowerCase();
  if(['drinks','fresh','coffee','smoothies','milkshakes'].includes(category) || name.includes('кофе') || name.includes('американо') || name.includes('капуч') || name.includes('латте') || name.includes('раф') || name.includes('мохито') || name.includes('смузи') || name.includes('лимонад')) return 'cup';
  if(category === 'gifts' || name.includes('подар') || name.includes('бокс') || name.includes('набор')) return 'box';
  if(category === 'dubai' || name.includes('дубай') || name.includes('шоколад')) return 'bar';
  return 'berry';
}
function productArt(product, cls='product-art'){
  const cutout = String(product.cutout || '').trim();
  const image = String(product.image || '').trim();
  const stageImage = String(product.stageImage || '').trim();
  // Production: use cutout first; stage images remain the final visual fallback.
  const asset = cutout || image || stageImage;
  const mode = cutout ? 'cutout' : image ? 'photo' : stageImage ? 'stage' : 'emoji';
  const emoji = product.emoji || categoryEmoji(product.category);
  const tone = artTone(product);
  const kind = modelKind(product);
  const badge = product.badge ? `<span class="badge motion-badge">${escapeHtml(product.badge)}</span>` : '';
  const visual = asset
    ? `<img class="model-image mode-${mode}-image" src="${escapeAttr(asset)}" alt="${escapeAttr(product.name)}" loading="lazy" onerror="this.outerHTML='<span class=&quot;emoji model-emoji&quot;>${emoji}</span>'">`
    : `<span class="emoji model-emoji">${emoji}</span>`;
  return `<div class="${cls} art-${escapeAttr(tone)} product-art-3d product-mode-${mode}">
    ${badge}
    <div class="model-stage model-${escapeAttr(kind)}" data-rotatable data-model-id="${escapeAttr(product.id || '')}" aria-label="product stage preview">
      <span class="model-glow"></span>
      <span class="model-ring ring-a"></span>
      <span class="model-ring ring-b"></span>
      <span class="model-orbit orbit-a"></span>
      <span class="model-orbit orbit-b"></span>
      <span class="model-spark spark-a">✦</span>
      <span class="model-spark spark-b">✧</span>
      <span class="model-spark spark-c">✦</span>
      <div class="model-turntable">
        ${visual}
        <span class="model-highlight"></span>
      </div>
      <span class="model-shadow"></span>
      <span class="model-floor"></span>
    </div>
  </div>`;
}
function productCard(p, i=0){
  const variants = productVariants(p);
  const hasVar = variants.length > 0;
  const hasChoice = hasVar || hasOptions(p);
  return `<article class="product-card reveal card-tilt tone-${escapeAttr(artTone(p))} ${hasChoice ? 'has-variants' : ''}" style="animation-delay:${Math.min(i*32,280)}ms" data-product="${escapeAttr(p.id)}">
    ${productArt(p)}
    <div class="product-body">
      <div class="product-kicker">${escapeHtml(p.categoryName || categoryName(p.category))}</div>
      <div class="product-title">${escapeHtml(p.name)}</div>
      <div class="product-meta">${escapeHtml(displayUnit(p))}</div>
      <div class="product-description">${escapeHtml(short(p.description || '', 102))}</div>
      ${hasVar ? `<div class="variant-preview">${variants.map(v=>`<span>${escapeHtml(variantLabel(v))}</span>`).join('')}</div>` : ''}
      <div class="product-bottom">
        <div class="price">${escapeHtml(displayPrice(p))}</div>
        <div class="mini-actions">
          <button class="round-btn info-btn" data-info="${escapeAttr(p.id)}" type="button" aria-label="Подробнее">i</button>
          ${hasChoice ? `<button class="round-btn add-btn" data-info="${escapeAttr(p.id)}" type="button" aria-label="Выбрать параметры">+</button>` : `<button class="round-btn add-btn" data-add="${escapeAttr(p.id)}" type="button" aria-label="Добавить">+</button>`}
        </div>
      </div>
    </div>
  </article>`;
}
function render(){
  const app = $('#app');
  const map = {home: renderHome, catalog: renderCatalog, drinks: renderDrinks, cart: renderCart, checkout: renderCheckout, profile: renderProfile, success: renderSuccess};
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
        <div class="release-chip">✨ Подарок к нужному времени · менеджер подтвердит заказ</div>
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
    ${renderPoints()}
    <section class="section">
      <div class="quick-grid">
        <button class="quick-card" data-nav="catalog" data-set-category="hits"><b>Хиты</b><span>лучшие позиции</span><i>🔥</i></button>
        <button class="quick-card" data-nav="catalog" data-set-category="strawberry"><b>Клубника</b><span>наборы и боксы</span><i>🍓</i></button>
        <button class="quick-card" data-nav="catalog" data-set-category="gifts"><b>Подарки</b><span>для свиданий и праздников</span><i>🎁</i></button>
        <button class="quick-card" data-nav="drinks"><b>Напитки</b><span>мохито, смузи, фреш</span><i>🥤</i></button>
        <button class="quick-card" data-nav="catalog" data-set-category="coffee"><b>Кофе</b><span>только Зеленопарк</span><i>☕</i></button>
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
  return `<div class="order-summary"><div class="summary-title"><b>Ваш заказ</b><span>${money(cartTotal())}</span></div>${items.map(({product,variant,options,qty})=>`<div class="summary-line"><span>${escapeHtml(itemTitle(product, variant, options))} × ${qty}</span><b>${money(itemUnitPrice(product, variant)*qty)}</b></div>`).join('')}</div>`;
}
function renderCartUpsell(){
  const idsInCart = new Set(cartItems().map(x=>x.product.id));
  const drinkInCart = cartItems().some(x => ['drinks','fresh','coffee','smoothies','milkshakes'].includes(x.product.category));
  const candidates = sortForBoutique(products({drinks:true})).filter(p=>!idsInCart.has(p.id)).slice(0,3);
  if(!candidates.length || drinkInCart) return '';
  return `<section class="section upsell-section"><div class="section-head"><h2>Добавьте напиток</h2><span>допродажа к подарку</span></div><div class="product-grid compact-grid upsell-grid">${candidates.map(productCard).join('')}</div></section>`;
}

function renderCart(){
  const items = cartItems();
  return `<section class="page cart-page"><div class="section-head"><h2>Корзина</h2><span>${cartCount()} ${plural(cartCount(),'товар','товара','товаров')}</span></div>
    <div class="cart-list">${items.map(({key,product,variant,options,qty})=>`<div class="cart-item"><div><b>${escapeHtml(itemTitle(product, variant, options))}</b><div class="product-meta">${escapeHtml(variantLabel(variant) || product.unit || product.categoryName || '')}</div><div class="price">${money(itemUnitPrice(product, variant)*qty)}</div></div><div class="qty"><button data-qty="${escapeAttr(key)}" data-delta="-1" type="button">−</button><b>${qty}</b><button data-qty="${escapeAttr(key)}" data-delta="1" type="button">+</button></div></div>`).join('') || empty('Корзина пустая. Добавьте клубнику, подарок или напиток.')}</div>
    <div class="total-card"><div class="total-row"><span>Итого ориентировочно</span><b>${money(cartTotal())}</b></div><button class="primary full" ${items.length?'data-nav="checkout"':'disabled'} type="button">Оформить заказ</button>${items.length?'<button class="ghost dark full" data-clear-cart type="button" style="margin-top:10px">Очистить корзину</button>':''}</div>
    ${items.length ? renderCartUpsell() : ''}
  </section>`;
}
function renderCheckout(){
  if(!cartCount()) return renderCart();
  const available = bonusBalance();
  const maxBonus = maxBonusRedeem();
  const expected = bonusEarnEstimate(0);
  return `<section class="page checkout-page"><div class="section-head"><h2>Оформление</h2><span>${money(cartTotal())}</span></div>
    ${renderOrderSummary()}
    <form class="form-card" id="order-form">
      <div class="switch-row"><label><input type="radio" name="deliveryType" value="pickup" ${state.deliveryType==='pickup'?'checked':''}> Самовывоз</label><label><input type="radio" name="deliveryType" value="delivery" ${state.deliveryType==='delivery'?'checked':''}> Доставка</label></div>
      <div class="field"><span>Точка</span><select name="pointId">${state.points.map(p=>`<option value="${escapeAttr(p.id)}" ${p.id===state.selectedPoint?'selected':''}>${escapeHtml(p.name)} — ${escapeHtml(p.shortAddress || p.address)}</option>`).join('')}</select></div>
      <div class="two"><label class="field"><span>Имя</span><input name="name" autocomplete="name" required placeholder="Ваше имя" value="${escapeAttr(state.profile?.customer?.firstName || '')}"></label><label class="field"><span>Телефон</span><input name="phone" inputmode="tel" autocomplete="tel" required placeholder="+7…" value="${escapeAttr(state.profile?.customer?.phone || '')}"></label></div>
      <div class="field delivery-address" ${state.deliveryType==='delivery'?'':'style="display:none"'}><span>Адрес доставки</span><input name="address" placeholder="Улица, дом, подъезд, квартира"></div>
      <div class="two"><label class="field"><span>Дата</span><input name="date" type="date" value="${today()}" required></label><label class="field"><span>Время</span><input name="time" type="time" required></label></div>
      <label class="field"><span>Комментарий</span><textarea name="comment" rows="3" placeholder="Надпись, пожелания, аллергии, детали подарка"></textarea></label>
      <label class="field"><span>Промокод</span><input name="promoCode" value="${escapeAttr(state.promoCode)}" placeholder="BERRY5"></label>
      ${state.bonusRules?.enabled ? `<section class="bonus-checkout-card">
        <div class="bonus-checkout-head"><div><b>Бонусный счёт</b><span>${state.profile?.customer?.publicId ? `ID ${escapeHtml(state.profile.customer.publicId)}` : 'Войдите через Telegram'}</span></div><strong>${available.toLocaleString('ru-RU')} 🍓</strong></div>
        <label class="field"><span>Списать бонусы — до ${maxBonus.toLocaleString('ru-RU')}</span><input name="bonusRequested" type="number" inputmode="numeric" min="0" max="${maxBonus}" step="1" value="0" ${maxBonus ? '' : 'disabled'}></label>
        <div class="bonus-preview"><span>К оплате: <b data-bonus-cash>${money(cartTotal())}</b></span><span>Начислится после завершения: <b data-bonus-earn>${expected} бонусов</b></span></div>
        <small>1 бонус = 1 ₽. Можно оплатить до ${Number(state.bonusRules.maxRedeemPercent || 30)}% стоимости товаров. Начисление ${Number(state.bonusRules.earnPercent || 5)}% после статуса «Завершён».</small>
      </section>` : ''}
      <label class="checkbox"><input name="legal" type="checkbox" required><span>Согласен/согласна на обработку персональных данных. Понимаю, что наличие, цену и время подтверждает менеджер.</span></label>
      <div class="checkout-hint">${escapeHtml(state.legal.orderConfirmation || 'Менеджер подтвердит наличие, время и способ оплаты.')}</div>
      <div class="error" id="form-error"></div>
      <button class="primary full" type="submit">Отправить заказ</button>
      <button class="ghost dark full" data-nav="cart" type="button">Назад в корзину</button>
    </form>
  </section>`;
}
function transactionLabel(type){ return ({earn:'Начисление',redeem:'Списание',refund:'Возврат',manual:'Корректировка'})[type] || type; }
function orderStatusLabel(status){ return ({new:'Новый',accepted:'Подтверждён',paid:'Оплачен',cooking:'Готовится',ready:'Готов',delivering:'В доставке',done:'Завершён',canceled:'Отменён'})[status] || status; }
function renderProfile(){
  if(state.profileLoading) return `<section class="page profile-page">${empty('Загружаем профиль…')}</section>`;
  const profile = state.profile;
  if(!profile?.customer) return `<section class="page profile-page"><div class="profile-hero"><div class="profile-avatar">🍓</div><h1>Профиль Deli Berry</h1><p>Откройте приложение из Telegram, чтобы получить личный ID и бонусный счёт.</p><button class="primary" data-reload-profile type="button">Обновить профиль</button></div></section>`;
  const c = profile.customer;
  const transactions = profile.transactions || [];
  const orders = profile.orders || [];
  return `<section class="page profile-page">
    <div class="profile-hero">
      <div class="profile-avatar">🍓</div>
      <span class="eyebrow">личный кабинет</span>
      <h1>${escapeHtml(c.firstName || 'Гость Deli Berry')}</h1>
      <div class="profile-id">${escapeHtml(c.publicId)}</div>
      <div class="bonus-balance"><b>${Number(c.bonusBalance || 0).toLocaleString('ru-RU')}</b><span>бонусов</span></div>
      <p>Начисляем ${Number(state.bonusRules.earnPercent || 5)}% после завершения заказа. 1 бонус = 1 ₽.</p>
    </div>
    <div class="profile-stats"><div><b>${Number(c.completedOrders || 0)}</b><span>заказов</span></div><div><b>${money(c.lifetimeSpend || 0)}</b><span>покупок</span></div><div><b>${Number(state.bonusRules.maxRedeemPercent || 30)}%</b><span>можно оплатить</span></div></div>
    <section class="section"><div class="section-head"><h2>Последние заказы</h2><span>${orders.length}</span></div><div class="profile-list">${orders.map(o=>`<article class="profile-order"><div><b>${escapeHtml(o.id)}</b><span>${escapeHtml(orderStatusLabel(o.status))} · ${new Date(o.createdAt).toLocaleDateString('ru-RU')}</span></div><div><strong>${money(o.total)}</strong><button class="ghost dark" data-repeat-order="${escapeAttr(o.id)}" type="button">Повторить</button></div></article>`).join('') || empty('Заказов пока нет.')}</div></section>
    <section class="section"><div class="section-head"><h2>История бонусов</h2><span>${transactions.length}</span></div><div class="profile-list">${transactions.map(t=>`<article class="bonus-transaction"><div><b>${escapeHtml(transactionLabel(t.type))}</b><span>${escapeHtml(t.note || '')}${t.orderId ? ` · ${escapeHtml(t.orderId)}` : ''}</span></div><strong class="${Number(t.amount)>=0?'plus':'minus'}">${Number(t.amount)>=0?'+':''}${Number(t.amount)}</strong></article>`).join('') || empty('История появится после первого заказа.')}</div></section>
  </section>`;
}
function renderSuccess(){
  const last = state.lastOrder || JSON.parse(localStorage.getItem('db_last_order') || '{}');
  return `<section class="page success-page"><div class="success-card"><div style="font-size:56px">🍓</div><h1>Заказ отправлен</h1><p>Номер: <b>${escapeHtml(last?.orderId || 'создан')}</b></p>${last?.customerPublicId?`<p>Ваш ID: <b>${escapeHtml(last.customerPublicId)}</b></p>`:''}${Number(last?.bonusesUsed||0)>0?`<p>Списано: <b>${Number(last.bonusesUsed)} бонусов</b> · к оплате ${money(last.cashTotal)}</p>`:''}${Number(last?.bonusesEarnedPotential||0)>0?`<p>После завершения начислится <b>${Number(last.bonusesEarnedPotential)} бонусов</b>.</p>`:''}<p>Менеджер подтвердит наличие, время и оплату.</p><div class="success-actions"><button class="primary" data-nav="profile" type="button">Профиль и бонусы</button><button class="secondary" data-nav="home" type="button">На главную</button></div></div></section>`;
}
function empty(text){ return `<div class="empty">${escapeHtml(text)}</div>`; }
function renderVariantSelector(product){
  const variants = productVariants(product);
  if(!variants.length) return '';
  const selected = defaultVariant(product);
  return `<div class="variant-box"><div class="variant-box-title">Выберите объём</div><div class="variant-options">${variants.map(v=>`<button class="variant-option ${v.id===selected?.id?'active':''}" data-variant-option="${escapeAttr(v.id)}" type="button"><b>${escapeHtml(variantLabel(v))}</b><span>${escapeHtml(v.priceText || money(v.price))}</span></button>`).join('')}</div></div>`;
}
function renderOptionSelectors(product){
  const groups = productOptions(product);
  if(!groups.length) return '';
  return groups.map(group => `<div class="choice-box" data-option-group="${escapeAttr(group.id)}" data-option-required="${group.required === false ? 'false' : 'true'}"><div class="variant-box-title">${escapeHtml(group.label || 'Выберите вариант')}</div><div class="choice-options">${group.values.map(value=>`<button class="choice-option" data-option-value="${escapeAttr(value.id)}" type="button">${escapeHtml(value.label || value.name || value.id)}</button>`).join('')}</div></div>`).join('');
}
function modalOptionSelections(panel){
  const selected = {};
  $$('.choice-box', panel).forEach(group => {
    const active = $('.choice-option.active', group);
    if(active) selected[group.dataset.optionGroup] = active.dataset.optionValue;
  });
  return selected;
}
function updateModalChoiceState(panel, product){
  const selections = modalOptionSelections(panel);
  const missing = missingRequiredOptions(product, selections);
  const addBtn = $('[data-modal-add]', panel);
  if(addBtn){
    addBtn.dataset.optionJson = JSON.stringify(selections);
    addBtn.disabled = missing.length > 0;
    addBtn.textContent = missing.length ? `Выберите: ${missing[0].label || missing[0].id}` : 'Добавить в заказ';
  }
}
function openProduct(id){
  const p = state.catalog.find(x=>x.id===id); if(!p) return;
  track('view_product', {id: p.id, name: p.name});
  const modal = $('#product-modal');
  const variant = defaultVariant(p);
  modal.innerHTML = `<div class="modal-panel" data-product-id="${escapeAttr(p.id)}"><div class="modal-head"><div><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(p.categoryName || '')}</p></div><button class="icon-btn" data-close-modal type="button">×</button></div><div class="modal-body">${productArt(p,'modal-art')}<p>${escapeHtml(p.description || '')}</p>${renderVariantSelector(p)}${renderOptionSelectors(p)}<div class="specs"><div class="spec"><b>Цена</b><span data-variant-price>${escapeHtml(itemPriceText(p, variant))}</span></div><div class="spec"><b>Вес / объём</b><span data-variant-unit>${escapeHtml(variantLabel(variant) || p.unit || 'уточняется')}</span></div><div class="spec"><b>Состав</b><span>${escapeHtml(p.composition || 'уточняется')}</span></div><div class="spec"><b>Аллергены</b><span>${escapeHtml(p.allergens || state.legal.allergens || 'уточняется')}</span></div><div class="spec"><b>Срок годности</b><span>${escapeHtml(p.shelfLife || state.legal.shelfLife || 'уточняется')}</span></div></div><button class="primary full" data-add="${escapeAttr(p.id)}" data-modal-add data-option-json="{}" ${variant ? `data-variant-id="${escapeAttr(variant.id)}"` : ''} ${missingRequiredOptions(p, {}).length ? 'disabled' : ''} data-close-after-add type="button">${missingRequiredOptions(p, {}).length ? `Выберите: ${escapeHtml(missingRequiredOptions(p, {})[0].label || missingRequiredOptions(p, {})[0].id)}` : 'Добавить в заказ'}</button></div></div>`;
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false'); document.body.classList.add('no-scroll'); trackEvent('view_product', {id:p.id, name:p.name, category:p.category}); requestAnimationFrame(()=>bindMotionModels(modal)); haptic();
}
function closeProduct(){ const modal=$('#product-modal'); modal.classList.remove('open'); modal.setAttribute('aria-hidden','true'); modal.innerHTML=''; document.body.classList.remove('no-scroll'); }
function bindPage(){
  $$('[data-search]').forEach(input=>{
    input.addEventListener('input', e=>{state.search=e.target.value; render();});
    setTimeout(()=>{ try{ const v=input.value; input.focus({preventScroll:true}); input.value=''; input.value=v; }catch(_e){} },0);
  });
  const bonusInput = document.querySelector('input[name="bonusRequested"]');
  if(bonusInput){
    const update = ()=>{
      const max = maxBonusRedeem();
      const value = Math.max(0, Math.min(max, Math.floor(Number(bonusInput.value || 0))));
      bonusInput.value = value;
      const cash = document.querySelector('[data-bonus-cash]'); if(cash) cash.textContent = money(Math.max(0, cartTotal()-value));
      const earn = document.querySelector('[data-bonus-earn]'); if(earn) earn.textContent = `${bonusEarnEstimate(value)} бонусов`;
    };
    bonusInput.addEventListener('input', update); update();
  }
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
    customer: {name: fd.get('name'), phone: fd.get('phone')}, deliveryAddress: fd.get('address'), date: fd.get('date'), time: fd.get('time'), comment: fd.get('comment'), legalAccepted: Boolean(fd.get('legal')), promoCode: state.promoCode, bonusRequested: Number(fd.get('bonusRequested') || 0),
    items: cartItems().map(({product,variant,options,qty})=>({id: product.id, qty, variantId: variant?.id || '', variantLabel: variantLabel(variant), unit: variantLabel(variant) || product.unit || '', options}))
  };
  const btn = form.querySelector('[type="submit"]'); const error = $('#form-error');
  btn.disabled = true; btn.textContent = 'Отправляем…'; error.textContent = '';
  try{
    const res = await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error((data.errors || [data.error]).filter(Boolean).join('\n') || 'Ошибка отправки заказа');
    state.lastOrder = {orderId:data.orderId, total:data.total, cashTotal:data.cashTotal, bonusesUsed:data.bonusesUsed, bonusesEarnedPotential:data.bonusesEarnedPotential, customerPublicId:data.customerPublicId, bonusBalance:data.bonusBalance, at:new Date().toISOString()};
    trackEvent('order_sent', {orderId:data.orderId, total:data.total, items:payload.items.length, pointId:payload.pointId, deliveryType:payload.deliveryType});
    localStorage.setItem('db_last_order', JSON.stringify(state.lastOrder));
    state.cart = {}; save(); haptic('heavy'); await loadProfile({silent:true}); navigate('success');
  }catch(e){ error.textContent = e.message; toast(e.message); try{tg?.showAlert?.(e.message)}catch(_e){} }
  finally{ state.busy=false; btn.disabled=false; btn.textContent='Отправить заказ'; }
}
document.addEventListener('click', async (e)=>{
  const reloadProfile = e.target.closest('[data-reload-profile]'); if(reloadProfile){ await loadProfile({silent:false}); render(); return; }
  const repeat = e.target.closest('[data-repeat-order]'); if(repeat){
    const order = state.profile?.orders?.find(o=>o.id===repeat.dataset.repeatOrder);
    if(order){
      state.cart = {};
      for(const item of order.items || []){
        const product = state.catalog.find(p=>p.id===item.id); if(!product) continue;
        const key = cartKey(product.id, item.variantId || '', item.options || item.optionSelections || {});
        state.cart[key] = Number(item.qty || 1);
      }
      save(); toast('Заказ добавлен в корзину'); navigate('cart');
    }
    return;
  }
  const nav = e.target.closest('[data-nav]'); if(nav){ e.preventDefault(); const cat=nav.dataset.setCategory; if(cat) state.category=cat; navigate(nav.dataset.nav); return; }
  const point = e.target.closest('[data-point]'); if(point){ state.selectedPoint=point.dataset.point; save(); haptic(); render(); return; }
  const cat = e.target.closest('[data-category]'); if(cat){ state.category=cat.dataset.category; save(); haptic(); render(); return; }
  const variantOpt = e.target.closest('[data-variant-option]');
  if(variantOpt){
    const panel = variantOpt.closest('.modal-panel');
    const product = state.catalog.find(p => p.id === panel?.dataset.productId);
    const variant = product ? variantById(product, variantOpt.dataset.variantOption) : null;
    if(panel && product && variant){
      $$('[data-variant-option]', panel).forEach(btn => btn.classList.toggle('active', btn === variantOpt));
      const price = $('[data-variant-price]', panel); if(price) price.textContent = itemPriceText(product, variant);
      const unit = $('[data-variant-unit]', panel); if(unit) unit.textContent = variantLabel(variant) || product.unit || 'уточняется';
      const addBtn = $('[data-modal-add]', panel); if(addBtn) addBtn.dataset.variantId = variant.id;
      haptic('light');
    }
    return;
  }
  const optionValue = e.target.closest('[data-option-value]');
  if(optionValue){
    const panel = optionValue.closest('.modal-panel');
    const group = optionValue.closest('.choice-box');
    const product = state.catalog.find(p => p.id === panel?.dataset.productId);
    if(panel && group && product){
      $$('.choice-option', group).forEach(btn => btn.classList.toggle('active', btn === optionValue));
      updateModalChoiceState(panel, product);
      haptic('light');
    }
    return;
  }
  const add = e.target.closest('[data-add]'); if(add){ addToCart(add.dataset.add, add, add.dataset.variantId || '', add.dataset.optionJson || ''); if(add.hasAttribute('data-close-after-add')) closeProduct(); return; }
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
  await loadProfile({silent:true});
  trackEvent('app_open', {source: tg ? 'telegram' : 'web', pointId: state.selectedPoint});
  if(!state.catalog.length){ state.catalog = [{id:'demo-1',name:'Клубника в шоколаде',category:'strawberry',categoryName:'Клубника',price:2599,priceText:'2 599 ₽',emoji:'🍓',isHit:true,points:[state.selectedPoint]}]; }
  if(!state.categories.length) state.categories = normalizeCategories([]);
  if(!['home','catalog','drinks','cart','checkout','profile','success'].includes(state.page)) state.page='home';
  render();
})();
