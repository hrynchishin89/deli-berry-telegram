require('dotenv').config();

function asBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function normalizeUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  return value.replace(/\/$/, '');
}

const config = {
  businessName: process.env.BUSINESS_NAME || 'Deli Berry',
  botToken: process.env.BOT_TOKEN || '',
  webAppUrl: normalizeUrl(process.env.WEBAPP_URL || process.env.PUBLIC_URL || ''),
  publicUrl: normalizeUrl(process.env.PUBLIC_URL || process.env.WEBAPP_URL || ''),
  managerChatId: process.env.MANAGER_CHAT_ID || '',
  managerPublicUrl: process.env.MANAGER_PUBLIC_URL || '',
  adminPin: process.env.ADMIN_PIN || 'change-me',
  requireTelegramAuth: asBool(process.env.REQUIRE_TELEGRAM_AUTH, false),
  googleSheetsWebhookUrl: process.env.GOOGLE_SHEETS_WEBHOOK_URL || '',
  setupTelegramOnStart: asBool(process.env.SETUP_TELEGRAM_ON_START, true),
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development'
};

module.exports = config;
