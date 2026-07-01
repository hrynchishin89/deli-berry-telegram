const fs = require('fs/promises');
const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const { setupTelegram } = require('./setup-telegram');

async function ask(question, fallback = '') {
  const rl = readline.createInterface({ input, output });
  const value = await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `);
  rl.close();
  return value.trim() || fallback;
}

async function main() {
  console.log('Deli Berry Telegram Wizard');
  console.log('Токен не отправляйте никому. Он будет сохранён только в локальный .env файл.\n');
  const BOT_TOKEN = await ask('Вставьте BOT_TOKEN из @BotFather');
  const WEBAPP_URL = await ask('Вставьте HTTPS URL приложения после деплоя');
  const MANAGER_CHAT_ID = await ask('Вставьте MANAGER_CHAT_ID группы заказов или оставьте пустым');
  const MANAGER_PUBLIC_URL = await ask('Ссылка на менеджера Telegram, можно пусто');
  const ADMIN_PIN = await ask('Придумайте PIN для админки', `berry-${Math.random().toString(36).slice(2, 6)}`);

  const env = [
    `BOT_TOKEN=${BOT_TOKEN}`,
    `WEBAPP_URL=${WEBAPP_URL}`,
    `PUBLIC_URL=${WEBAPP_URL}`,
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
  console.log('\n.env создан. Запускаю автонастройку Telegram...');
  require('dotenv').config({ override: true });
  await setupTelegram();
  console.log('\nГотово. Теперь запустите: npm start');
}

main().catch((error) => {
  console.error('Ошибка wizard:', error.message);
  process.exit(1);
});
