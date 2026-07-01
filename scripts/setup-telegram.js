require('dotenv').config();

function maskToken(token) {
  if (!token) return '(пусто)';
  const value = String(token);
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function getEnv() {
  return {
    BOT_TOKEN: process.env.BOT_TOKEN,
    WEBAPP_URL: normalizeUrl(process.env.WEBAPP_URL || process.env.PUBLIC_URL || '')
  };
}

async function callTelegram(method, body) {
  const { BOT_TOKEN } = getEnv();
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN пустой. Вставьте токен в .env или переменные хостинга.');
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(`${method}: ${data.description || 'Telegram API error'}`);
  return data.result;
}

async function setupTelegram() {
  const { BOT_TOKEN, WEBAPP_URL } = getEnv();
  console.log(`Проверяю бота. Токен: ${maskToken(BOT_TOKEN)}`);

  const me = await callTelegram('getMe');
  console.log(`Бот найден: @${me.username}`);

  await callTelegram('deleteWebhook', { drop_pending_updates: false });

  await callTelegram('setMyName', { name: 'Deli Berry' });
  await callTelegram('setMyShortDescription', {
    short_description: 'Клубника в шоколаде, сладкие подарки и десерты на заказ.'
  });
  await callTelegram('setMyDescription', {
    description: 'Откройте каталог Deli Berry, выберите точку, соберите корзину и отправьте заказ менеджеру. Наличие, цена и время приготовления подтверждаются менеджером.'
  });
  await callTelegram('setMyCommands', {
    commands: [
      { command: 'start', description: 'Запустить меню' },
      { command: 'order', description: 'Открыть каталог и заказ' },
      { command: 'catalog', description: 'Каталог Deli Berry' },
      { command: 'status', description: 'Проверить статус заказа' },
      { command: 'help', description: 'Помощь' },
      { command: 'myid', description: 'Узнать свой chat_id' },
      { command: 'groupid', description: 'Узнать ID группы' },
      { command: 'manager', description: 'Назначить группу заказов' }
    ]
  });

  if (WEBAPP_URL && WEBAPP_URL.startsWith('https://')) {
    await callTelegram('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'Заказать 🍓',
        web_app: { url: WEBAPP_URL }
      }
    });
    console.log('Кнопка меню “Заказать 🍓” настроена.');
    console.log(`Mini App URL: ${WEBAPP_URL}`);
  } else {
    console.log('WEBAPP_URL пока не задан или не HTTPS — кнопку Mini App пропустил.');
    console.log('После деплоя вставьте WEBAPP_URL и запустите npm run telegram:setup ещё раз.');
  }

  console.log('Готово: имя, описание и команды Telegram настроены.');
  console.log(`Прямая ссылка на бота: https://t.me/${me.username}`);
}

if (require.main === module) {
  setupTelegram().catch((error) => {
    console.error('Ошибка настройки Telegram:', error.message);
    process.exit(1);
  });
}

module.exports = { setupTelegram };
