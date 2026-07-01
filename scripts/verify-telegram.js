require('dotenv').config();

function mask(value) {
  if (!value) return '(empty)';
  const str = String(value);
  if (str.length <= 12) return '***';
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
}

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token || /PASTE|ВСТАВ/i.test(token)) {
    throw new Error('BOT_TOKEN не заполнен. Вставьте новый токен в .env или переменные хостинга.');
  }

  console.log(`Проверяю Telegram-токен: ${mask(token)}`);
  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { method: 'POST' });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || 'Telegram token check failed');
  const bot = data.result;
  console.log(`OK: бот подключается как @${bot.username}.`);
}

main().catch((error) => {
  console.error(`Ошибка: ${error.message}`);
  process.exit(1);
});
