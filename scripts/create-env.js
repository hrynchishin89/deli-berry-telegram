const fs = require('fs/promises');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');

async function ask(rl, question, fallback = '') {
  const value = await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `);
  return value.trim() || fallback;
}

async function main() {
  const rl = readline.createInterface({ input, output });
  console.log('Deli Berry — создание .env');
  console.log('Не используйте токен, который уже был отправлен в чат. Сначала перевыпустите новый в @BotFather.\n');

  const BOT_TOKEN = await ask(rl, 'Новый BOT_TOKEN из BotFather');
  const WEBAPP_URL = await ask(rl, 'HTTPS URL приложения после деплоя', 'https://deli-berry-telegram.onrender.com');
  const MANAGER_CHAT_ID = await ask(rl, 'ID группы заказов, можно пусто');
  const MANAGER_PUBLIC_URL = await ask(rl, 'Ссылка на менеджера Telegram, можно пусто');
  const ADMIN_PIN = await ask(rl, 'PIN для админки и setup.html', `berry-${Math.random().toString(36).slice(2, 8)}`);
  rl.close();

  const normalizedUrl = WEBAPP_URL.replace(/\/$/, '');
  const env = [
    'BUSINESS_NAME=Deli Berry',
    `BOT_TOKEN=${BOT_TOKEN}`,
    `WEBAPP_URL=${normalizedUrl}`,
    `PUBLIC_URL=${normalizedUrl}`,
    `MANAGER_CHAT_ID=${MANAGER_CHAT_ID}`,
    `MANAGER_PUBLIC_URL=${MANAGER_PUBLIC_URL}`,
    `ADMIN_PIN=${ADMIN_PIN}`,
    'REQUIRE_TELEGRAM_AUTH=false',
    'SETUP_TELEGRAM_ON_START=true',
    'GOOGLE_SHEETS_WEBHOOK_URL=',
    'PORT=3000',
    'NODE_ENV=production'
  ].join('\n');

  await fs.writeFile('.env', `${env}\n`, 'utf8');
  console.log('\n.env создан. Дальше: npm install → npm run preflight → npm start');
}

main().catch((error) => {
  console.error('Ошибка:', error.message);
  process.exit(1);
});
