// Deli Berry Google Sheets webhook
// 1. Создайте Google Таблицу.
// 2. Расширения → Apps Script.
// 3. Вставьте этот код.
// 4. Deploy → New deployment → Web app.
// 5. Execute as: Me. Who has access: Anyone with the link.
// 6. Скопируйте URL в GOOGLE_SHEETS_WEBHOOK_URL.

function doPost(e) {
  const sheet = getOrCreateSheet_('Orders');
  const order = JSON.parse(e.postData.contents || '{}');
  ensureHeader_(sheet);
  sheet.appendRow([
    order.id || '',
    order.createdAt || new Date().toISOString(),
    order.status || '',
    order.point && order.point.name || order.pointId || '',
    order.deliveryType || '',
    order.customer && order.customer.name || '',
    order.customer && order.customer.phone || '',
    order.deliveryAddress || '',
    order.date || '',
    order.time || '',
    order.totalBeforeDiscount || 0,
    order.discount || 0,
    order.total || 0,
    order.promoCode || '',
    (order.items || []).map(function(item){ return item.name + ' x ' + item.qty; }).join(' | '),
    order.comment || '',
    order.telegramUser && order.telegramUser.username || ''
  ]);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(['ID', 'Создан', 'Статус', 'Точка', 'Способ', 'Имя', 'Телефон', 'Адрес', 'Дата', 'Время', 'До скидки', 'Скидка', 'Итого', 'Промокод', 'Товары', 'Комментарий', 'Telegram']);
}
