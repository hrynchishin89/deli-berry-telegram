const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Telegram exposes one current Mini App entry and no legacy catalog buttons', () => {
  const bot = read('src/telegramBot.js');
  const config = read('src/config.js');
  const setup = read('scripts/setup-telegram.js');
  const setupBasic = read('scripts/setup-telegram-basic.js');
  const createEnv = read('scripts/create-env.js');
  const setupPage = read('webapp/setup.html');
  const managedSources = [bot, setup, setupBasic, createEnv, setupPage].join('\n');

  assert.match(config, /telegramAppUrl:\s*normalizeUrl\(process\.env\.TELEGRAM_APP_URL/);
  assert.match(setup, /TELEGRAM_APP_URL:\s*normalizeUrl\(process\.env\.TELEGRAM_APP_URL/);
  assert.match(bot, /menu_button:\s*\{\s*type:\s*'web_app',\s*text:\s*'Открыть приложение'/s);
  assert.doesNotMatch(managedSources, /Заказать 🍓|Открыть каталог 🍓/);
  assert.doesNotMatch(managedSources, /deli-berry-telegram\.onrender\.com/);
  assert.doesNotMatch(managedSources, /command:\s*'(?:order|catalog)'/);

  const welcome = bot.match(/async function sendWelcome[\s\S]*?\n}\n\nasync function isManagerChat/)?.[0] || '';
  assert.ok(welcome, 'sendWelcome function must exist');
  assert.doesNotMatch(welcome, /reply_markup|inline_keyboard|buildOpenAppMarkup/);
});
