const crypto = require('crypto');

function dataCheckString(params) {
  return Array.from(params.entries())
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  if (!initData || !botToken) return { ok: false, reason: 'missing-data-or-token' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return { ok: false, reason: 'missing-or-invalid-hash' };

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString(params)).digest('hex');

  let signatureValid = false;
  try {
    signatureValid = crypto.timingSafeEqual(Buffer.from(calculated, 'hex'), Buffer.from(hash, 'hex'));
  } catch (_error) {
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, reason: 'signature-mismatch' };

  const authDate = Number(params.get('auth_date') || 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'missing-auth-date' };
  const now = Math.floor(Date.now() / 1000);
  const age = now - authDate;
  if (age < -60) return { ok: false, reason: 'auth-date-in-future' };
  if (maxAgeSeconds && age > maxAgeSeconds) return { ok: false, reason: 'auth-data-expired', age };

  return {
    ok: true,
    authDate,
    age,
    user: parseTelegramUserFromInitData(initData),
    queryId: params.get('query_id') || ''
  };
}

function validateTelegramInitData(initData, botToken, maxAgeSeconds = 86400) {
  return verifyTelegramInitData(initData, botToken, maxAgeSeconds).ok;
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
  verifyTelegramInitData,
  validateTelegramInitData,
  parseTelegramUserFromInitData
};
