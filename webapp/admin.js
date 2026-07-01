const statuses = {
  new: '🆕 Новый', accepted: '✅ Принят', cooking: '👩‍🍳 Готовится', ready: '🎁 Готов', delivering: '🚗 В доставке', done: '🏁 Завершён', canceled: '❌ Отменён'
};
let pin = localStorage.getItem('db_admin_pin') || '';
const el = (s) => document.querySelector(s);
const money = (value) => `${Number(value || 0).toLocaleString('ru-RU')} ₽`;

function orderHtml(order) {
  const items = (order.items || []).map((item) => `<li>${item.name} × ${item.qty} — ${money(item.subtotal)}</li>`).join('');
  const buttons = Object.keys(statuses).map((status) => `<button class="ghost" data-status="${status}" data-id="${order.id}">${statuses[status]}</button>`).join(' ');
  return `<article class="card contacts" style="margin-bottom:12px">
    <h2>${order.id} — ${statuses[order.status] || order.status}</h2>
    <p><b>${order.customer?.name || ''}</b> / ${order.customer?.phone || ''}</p>
    <p>${order.point?.name || ''} / ${order.deliveryType === 'delivery' ? 'Доставка' : 'Самовывоз'} / ${order.date || ''} ${order.time || ''}</p>
    ${order.deliveryAddress ? `<p>${order.deliveryAddress}</p>` : ''}
    <ul>${items}</ul>
    <p><b>Итого: ${money(order.total)}</b></p>
    ${order.comment ? `<p>${order.comment}</p>` : ''}
    <div class="hero-actions">${buttons}</div>
  </article>`;
}

async function loadOrders() {
  if (!pin) return;
  el('#export-link').href = `/api/admin/export.csv?pin=${encodeURIComponent(pin)}`;
  const response = await fetch(`/api/admin/orders?pin=${encodeURIComponent(pin)}`);
  const data = await response.json();
  if (!response.ok) {
    el('#orders').innerHTML = `<div class="notice">${data.error || 'Ошибка'}</div>`;
    return;
  }
  el('#orders').innerHTML = data.orders.length ? data.orders.map(orderHtml).join('') : '<div class="empty">Заказов пока нет</div>';
  document.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', async () => {
    await fetch(`/api/admin/orders/${button.dataset.id}/status?pin=${encodeURIComponent(pin)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: button.dataset.status })
    });
    await loadOrders();
  }));
}

el('#pin').value = pin;
el('#save-pin').addEventListener('click', () => { pin = el('#pin').value.trim(); localStorage.setItem('db_admin_pin', pin); loadOrders(); });
el('#reload').addEventListener('click', loadOrders);
loadOrders();
