<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Deli Berry — V5 commercial dessert app</title>
  <meta name="theme-color" content="#120706">
  <meta name="description" content="Deli Berry: клубника в шоколаде, подарки, напитки и десерты в Telegram Mini App.">
  <link rel="icon" href="/assets/brand/mascot-square.jpg" type="image/jpeg">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="/styles.css?v=5.2.0-photo-polish">
  <script src="https://telegram.org/js/telegram-web-app.js?62"></script>
</head>
<body>
  <div class="bg-scene" aria-hidden="true">
    <span class="orb orb-a"></span>
    <span class="orb orb-b"></span>
    <span class="orb orb-c"></span>
    <span class="float-emoji fe-1">🍓</span>
    <span class="float-emoji fe-2">🍫</span>
    <span class="float-emoji fe-3">🎁</span>
  </div>

  <div class="app-frame">
    <header class="app-header">
      <button class="brand-lockup" data-nav="home" type="button" aria-label="Главная">
        <img src="/assets/brand/mascot-square.jpg" alt="Deli Berry" class="brand-icon">
        <span><b>Deli Berry</b><small>dessert boutique</small></span>
      </button>
      <button class="cart-chip" data-nav="cart" type="button" aria-label="Корзина">
        <span>🛒</span><b id="mini-cart-count">0</b>
      </button>
    </header>

    <main id="app" class="app-view" tabindex="-1"></main>

    <div id="floating-cart" class="floating-cart" hidden>
      <button data-nav="cart" type="button">
        <span id="floating-cart-label">0 товаров</span>
        <b id="floating-cart-total">0 ₽</b>
      </button>
    </div>

    <nav class="bottom-nav" aria-label="Основная навигация">
      <button data-nav="home" class="active" type="button"><span>⌂</span><b>Главная</b></button>
      <button data-nav="catalog" type="button"><span>🍓</span><b>Каталог</b></button>
      <button data-nav="drinks" type="button"><span>🥤</span><b>Напитки</b></button>
      <button data-nav="cart" type="button"><span>🛒</span><b>Корзина</b></button>
    </nav>
  </div>

  <div id="product-modal" class="modal" aria-hidden="true"></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
  <script src="/app.js?v=5.2.0-photo-polish"></script>
</body>
</html>
