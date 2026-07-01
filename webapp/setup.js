const el = (selector) => document.querySelector(selector);
const result = el('#result');

function currentBaseUrl() {
  return window.location.origin.replace(/\/$/, '');
}

function getPin() {
  return el('#pin').value.trim();
}

function show(message, ok = true) {
  result.textContent = message;
  result.style.borderColor = ok ? 'rgba(88, 134, 78, .25)' : 'rgba(190, 70, 70, .35)';
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

async function loadStatus() {
  const pin = getPin();
  if (!pin) return show('Введите PIN администратора.', false);
  const data = await requestJson(`/api/setup/status?pin=${encodeURIComponent(pin)}`);
  show([
    `Токен бота: ${data.botTokenConfigured ? 'есть' : 'нет'}`,
    `Кнопка Mini App: ${data.webAppConfigured ? data.webAppUrl : 'ещё не настроена'}`,
    `Группа заказов: ${data.managerChatIdConfigured ? `назначена${data.managerChatTitle ? ` (${data.managerChatTitle})` : ''}` : 'ещё не назначена'}`,
    data.botUsername ? `Бот: @${data.botUsername}` : ''
  ].filter(Boolean).join('\n'));
}

async function setupTelegram() {
  const pin = getPin();
  if (!pin) return show('Введите PIN администратора.', false);
  const webAppUrl = (el('#webapp-url').value.trim() || currentBaseUrl()).replace(/\/$/, '');
  if (!webAppUrl.startsWith('https://')) return show('Нужна публичная HTTPS-ссылка. Откройте эту страницу на хостинге, не на localhost.', false);
  el('#setup-btn').disabled = true;
  try {
    const data = await requestJson(`/api/setup/telegram?pin=${encodeURIComponent(pin)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webAppUrl })
    });
    show(`Готово! Telegram настроен на ${data.webAppUrl}. Теперь добавьте бота в группу заказов и напишите /manager.`);
  } catch (error) {
    show(error.message, false);
  } finally {
    el('#setup-btn').disabled = false;
  }
}

el('#webapp-url').value = currentBaseUrl();
el('#setup-btn').addEventListener('click', setupTelegram);
el('#status-btn').addEventListener('click', () => loadStatus().catch((error) => show(error.message, false)));
