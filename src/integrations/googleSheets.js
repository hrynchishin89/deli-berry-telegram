const config = require('../config');

async function sendOrderToGoogleSheets(order) {
  if (!config.googleSheetsWebhookUrl) return { skipped: true };
  try {
    const response = await fetch(config.googleSheetsWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order)
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, body: text.slice(0, 300) };
  } catch (error) {
    console.error('Google Sheets error:', error.message);
    return { ok: false, error: error.message };
  }
}

module.exports = { sendOrderToGoogleSheets };
