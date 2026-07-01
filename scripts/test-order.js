require('dotenv').config();

const BASE_URL = (process.env.PUBLIC_URL || process.env.WEBAPP_URL || 'http://localhost:3000').replace(/\/$/, '');

async function main() {
  const payload = {
    source: 'test-script',
    pointId: 'dybenko',
    deliveryType: 'pickup',
    customer: { name: 'Тестовый клиент', phone: '+79990000000' },
    date: new Date().toISOString().slice(0, 10),
    time: '12:00',
    comment: 'Тестовый заказ из scripts/test-order.js',
    legalAccepted: true,
    promoCode: 'BERRY5',
    items: [
      { id: 'strawberry-white-pink-12', qty: 1 },
      { id: 'dubai-chocolate-130', qty: 1 }
    ]
  };
  const response = await fetch(`${BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
  if (!response.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
