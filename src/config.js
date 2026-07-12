require('dotenv').config();

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function asNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  return value.replace(/\/$/, '');
}

const nodeEnv = process.env.NODE_ENV || 'development';

const config = {
  businessName: process.env.BUSINESS_NAME || 'Deli Berry',
  botToken: process.env.BOT_TOKEN || '',
  webAppUrl: normalizeUrl(process.env.WEBAPP_URL || process.env.PUBLIC_URL || ''),
  publicUrl: normalizeUrl(process.env.PUBLIC_URL || process.env.WEBAPP_URL || ''),
  managerChatId: process.env.MANAGER_CHAT_ID || '',
  managerPublicUrl: process.env.MANAGER_PUBLIC_URL || '',
  adminPin: process.env.ADMIN_PIN || 'change-me',
  requireTelegramAuth: asBool(process.env.REQUIRE_TELEGRAM_AUTH, nodeEnv === 'production'),
  telegramAuthMaxAgeSeconds: asNumber(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS, 86400, { min: 300, max: 604800 }),
  orderRateLimitWindowMs: asNumber(process.env.ORDER_RATE_LIMIT_WINDOW_MS, 60000, { min: 10000, max: 3600000 }),
  orderRateLimitMax: asNumber(process.env.ORDER_RATE_LIMIT_MAX, 8, { min: 1, max: 100 }),
  profileRateLimitMax: asNumber(process.env.PROFILE_RATE_LIMIT_MAX, 60, { min: 5, max: 500 }),
  googleSheetsWebhookUrl: process.env.GOOGLE_SHEETS_WEBHOOK_URL || '',
  setupTelegramOnStart: asBool(process.env.SETUP_TELEGRAM_ON_START, true),
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: asBool(process.env.DATABASE_SSL, nodeEnv === 'production'),
  bonusEnabled: asBool(process.env.BONUS_ENABLED, true),
  bonusEarnPercent: asNumber(process.env.BONUS_EARN_PERCENT, 5, { min: 0, max: 100 }),
  bonusMaxRedeemPercent: asNumber(process.env.BONUS_MAX_REDEEM_PERCENT, 30, { min: 0, max: 100 }),
  bonusRublesPerPoint: asNumber(process.env.BONUS_RUBLES_PER_POINT, 1, { min: 0.01, max: 100 }),
  port: Number(process.env.PORT || 3000),
  nodeEnv
};

module.exports = config;
