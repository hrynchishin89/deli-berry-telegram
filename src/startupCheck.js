const config = require('./config');

function mask(value) {
  const text = String(value || '');
  if (!text) return 'нет';
  if (text.length < 10) return 'есть';
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function printStartupReport() {
  console.log('--- Deli Berry readiness ---');
  console.log(`BOT_TOKEN: ${mask(config.botToken)}`);
  console.log(`WEBAPP_URL: ${config.webAppUrl || 'пока не указан — можно настроить через /setup.html после деплоя'}`);
  console.log(`MANAGER_CHAT_ID: ${config.managerChatId || 'пока не указан — можно назначить командой /manager в группе'}`);
  console.log(`ADMIN_PIN: ${config.adminPin && config.adminPin !== 'change-me' ? 'задан' : 'не задан'}`);
  console.log(`DATABASE_URL: ${config.databaseUrl ? 'задана (Postgres)' : 'не задана — временный JSON-режим'}`);
  console.log(`TELEGRAM AUTH: ${config.requireTelegramAuth ? 'строгая проверка включена' : 'тестовый режим'}`);
  console.log(`BONUS: ${config.bonusEnabled ? `${config.bonusEarnPercent}% / списание до ${config.bonusMaxRedeemPercent}%` : 'выключены'}`);
  console.log('----------------------------');
}

module.exports = { printStartupReport };
