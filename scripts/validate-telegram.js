require('dotenv').config();

async function main() {
  const token = String(process.env.BOT_TOKEN || '').trim();
  if (!token) {
    console.error('BOT_TOKEN пустой. Вставьте токен в переменные окружения или локальный .env.');
    process.exit(1);
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { method: 'POST' });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.ok === false) {
    console.error('Telegram токен не прошёл проверку:', data.description || response.statusText);
    console.error('Получите новый токен в @BotFather командой /revoke и вставьте его заново.');
    process.exit(1);
  }

  const bot = data.result || {};
  console.log('Telegram токен рабочий.');
  console.log(`Бот: @${bot.username || 'unknown'}`);
  console.log(`Имя: ${bot.first_name || 'unknown'}`);
  console.log('Теперь можно запускать npm run telegram:setup после деплоя HTTPS-ссылки.');
}

main().catch((error) => {
  console.error('Ошибка проверки Telegram:', error.message);
  process.exit(1);
});
