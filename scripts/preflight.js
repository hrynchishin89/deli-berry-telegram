require('dotenv').config();

const REQUIRED = ['BOT_TOKEN'];
const SHOULD_SET_AFTER_DEPLOY = ['WEBAPP_URL', 'PUBLIC_URL', 'MANAGER_CHAT_ID', 'ADMIN_PIN'];

function maskToken(token) {
  if (!token) return '(пусто)';
  const [id] = String(token).split(':');
  return `${id}:***${String(token).slice(-4)}`;
}

function checkTokenFormat(token) {
  return /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(String(token || ''));
}

async function telegram(method, body = {}) {
  const token = process.env.BOT_TOKEN;
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.description || `${method} failed`);
  }
  return json.result;
}

async function main() {
  console.log('Deli Berry — проверка запуска');
  console.log('--------------------------------');
  console.log(`BOT_TOKEN: ${maskToken(process.env.BOT_TOKEN)}`);

  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length) {
    console.log(`Не хватает: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  if (!checkTokenFormat(process.env.BOT_TOKEN)) {
    console.log('BOT_TOKEN выглядит неверно. Проверьте токен от @BotFather.');
    process.exitCode = 1;
    return;
  }

  for (const key of SHOULD_SET_AFTER_DEPLOY) {
    const value = process.env[key] || '';
    if (!value || value.includes('PASTE') || value === 'change-me' || value === 'change-this-pin') {
      console.log(`${key}: нужно заполнить после деплоя`);
    } else {
      console.log(`${key}: заполнено`);
    }
  }

  try {
    const me = await telegram('getMe');
    console.log(`Telegram проверен: @${me.username || '(без username)'}`);
  } catch (error) {
    console.log(`Telegram пока не ответил: ${error.message}`);
    console.log('Это нормально, если вы запускаете проверку без интернета. На хостинге повторите npm run preflight.');
  }

  console.log('Готово. После деплоя выполните npm run telegram:setup или просто перезапустите приложение.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
