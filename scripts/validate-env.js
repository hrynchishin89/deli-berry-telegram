require('dotenv').config();

function mask(value, left = 6, right = 4) {
  if (!value) return 'НЕ ЗАДАНО';
  const s = String(value);
  if (s.length <= left + right) return '***';
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

const checks = [
  ['BOT_TOKEN', process.env.BOT_TOKEN, 'обязательно'],
  ['WEBAPP_URL', process.env.WEBAPP_URL || process.env.PUBLIC_URL, 'обязательно после деплоя'],
  ['PUBLIC_URL', process.env.PUBLIC_URL || process.env.WEBAPP_URL, 'обязательно после деплоя'],
  ['MANAGER_CHAT_ID', process.env.MANAGER_CHAT_ID, 'нужно для уведомлений менеджерам'],
  ['ADMIN_PIN', process.env.ADMIN_PIN, 'обязательно для админки']
];

console.log('Проверка переменных Deli Berry');
for (const [name, value, note] of checks) {
  const printable = name === 'BOT_TOKEN' || name === 'ADMIN_PIN' ? mask(value) : (value || 'НЕ ЗАДАНО');
  console.log(`${value ? '✅' : '⚠️'} ${name}: ${printable} — ${note}`);
}

if (!process.env.BOT_TOKEN) process.exitCode = 1;
