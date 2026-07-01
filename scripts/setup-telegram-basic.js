require('dotenv').config();

function mask(value) {
  if (!value) return '(empty)';
  const str = String(value);
  if (str.length <= 12) return '***';
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}

function getEnv() {
  return {
    BOT_TOKEN: process.env.BOT_TOKEN,
    BUSINESS_NAME: process.env.BUSINESS_NAME || 'Deli Berry'
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
  if (!data.ok) throw new Error(`${method}: ${data.description || 'Telegram API error'}`);
  return data.result;
}

async function setupBasicTelegram() {
  const env = getEnv();
  console.log(`Проверяю токен Telegram: ${mask(env.BOT_TOKEN)}`);
  const me = await callTelegram('getMe');
  console.log(`Бот найден: @${me.username}`);

  await callTelegram('setMyName', { name: env.BUSINESS_NAME });
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

  console.log('Готово: имя, описание и команды Telegram настроены.');
  console.log('Кнопка Mini App появится после WEBAPP_URL: npm run telegram:setup');
}

if (require.main === module) {
  setupBasicTelegram().catch((error) => {
    console.error('Ошибка настройки Telegram:', error.message);
    process.exit(1);
  });
}

module.exports = { setupBasicTelegram };
