const crypto = require('crypto');

function validateTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(calculated, 'hex'), Buffer.from(hash, 'hex'));
  } catch (_error) {
    return false;
  }
}

function parseTelegramUserFromInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const rawUser = params.get('user');
  if (!rawUser) return null;
  try {
    return JSON.parse(rawUser);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  validateTelegramInitData,
  parseTelegramUserFromInitData
};
