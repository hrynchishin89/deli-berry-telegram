require('dotenv').config();

function hasRealValue(value) {
  return Boolean(value) && !/PASTE|CHANGE|ВСТАВ|ЗАМЕНИ/i.test(String(value));
}

function isHttps(value) {
  return /^https:\/\//i.test(String(value || ''));
}

function line(name, ok, text) {
  console.log(`${ok ? '✅' : '⚠️'} ${name}: ${text}`);
}

function main() {
  const env = process.env;
  const webUrl = env.WEBAPP_URL || env.PUBLIC_URL || '';
  const checks = [
    ['BOT_TOKEN', hasRealValue(env.BOT_TOKEN), hasRealValue(env.BOT_TOKEN) ? 'заполнен' : 'не заполнен'],
    ['WEBAPP_URL', isHttps(webUrl), isHttps(webUrl) ? webUrl.replace(/^https:\/\//, 'https://') : 'нужна публичная HTTPS-ссылка после деплоя'],
    ['MANAGER_CHAT_ID', hasRealValue(env.MANAGER_CHAT_ID), hasRealValue(env.MANAGER_CHAT_ID) ? 'заполнен' : 'пока пусто — заказы сохранятся, но не уйдут в группу'],
    ['ADMIN_PIN', hasRealValue(env.ADMIN_PIN), hasRealValue(env.ADMIN_PIN) ? 'заполнен' : 'поменяйте PIN'],
    ['REQUIRE_TELEGRAM_AUTH', ['true', 'false'].includes(String(env.REQUIRE_TELEGRAM_AUTH || '').toLowerCase()), `сейчас: ${env.REQUIRE_TELEGRAM_AUTH || '(пусто)'}`]
  ];
  console.log('Проверка настроек Deli Berry:\n');
  checks.forEach(([name, ok, text]) => line(name, ok, text));
  console.log('\nДля первого теста достаточно: BOT_TOKEN + ADMIN_PIN.');
  console.log('Для полноценного запуска нужно ещё: WEBAPP_URL + MANAGER_CHAT_ID.');
}

main();
