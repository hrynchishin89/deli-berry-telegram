const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, '../src/catalogV5.js');
const api = fs.existsSync(target) ? require(target) : {};
const token = 'test-only-token';

function signed(user = { id: 12345, first_name: 'Тест', username: 'example' }, age = 0) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000) - age), query_id: 'test-query', user: JSON.stringify(user) });
  const text = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', key).update(text).digest('hex'));
  return params.toString();
}
function payload() {
  return { version: 'v5-2026-09-28', requestId: 'request-test-12345', initData: signed(), point: 'zelenopark', date: '2030-10-05', time: '15:00', comment: 'К дате', items: [{ variantId: 'SET-12-A06', quantity: 2, design: 'A06', berry: 'blueberry', inscription: 'Маме', price: 1 }] };
}
function setup({ delivery = true, ready = true } = {}) {
  assert.equal(typeof api.createCatalogV5Service, 'function', 'v5 submission service must exist');
  const orders = new Map(), managerMessages = [], customerMessages = [];
  const state = { delivery };
  const store = {
    getOrder: async id => structuredClone(orders.get(id) || null),
    createOrderWithCustomer: async order => { assert.equal(orders.has(order.id), false, 'duplicate order'); orders.set(order.id, structuredClone(order)); return { order }; },
    updateOrder: async (id, patch) => { const next = { ...orders.get(id), ...patch }; orders.set(id, next); return structuredClone(next); }
  };
  const dependencies = { store, config: { botToken: token, telegramAuthMaxAgeSeconds: 3600, requireTelegramAuth: false }, ready: async () => ready,
    notifyManagers: async order => { if (!state.delivery) return { ok: false }; managerMessages.push(order); return { ok: true, messageId: 700 }; },
    notifyCustomer: async (order, text) => { customerMessages.push({ order, text }); return { ok: true }; }
  };
  const service = api.createCatalogV5Service(dependencies);
  return { service, dependencies, orders, managerMessages, customerMessages, state };
}

test('signed v5 request recomputes 4080 and persists the current order format', async () => {
  const s = setup(), input = payload();
  input.telegramUser = { id: 99999 }; input.total = 1;
  const result = await s.service.submit(input);
  assert.equal(result.status, 201); assert.equal(result.body.delivered, true); assert.equal(result.body.total, 4080);
  const order = s.orders.get(result.body.orderId);
  assert.equal(order.telegramUser.id, 12345); assert.equal(order.total, 4080); assert.equal(order.point.name, 'Зеленопарк');
  assert.equal(order.items[0].unitPrice, 2040); assert.equal(order.items[0].qty, 2);
  assert.match(order.items[0].name, /Маме/); assert.match(order.items[0].name, /A06/);
  assert.equal(order.catalogVersion, 'v5-2026-09-28'); assert.equal(order.status, 'new');
  assert.equal(s.managerMessages.length, 1); assert.match(s.customerMessages[0].text, /передана менеджеру/);
});

test('missing, forged, expired and absent user identity cannot create orders even with legacy auth disabled', async () => {
  const s = setup();
  for (const initData of ['', signed() + 'bad', signed(undefined, 7200), signed({ first_name: 'No ID' })]) {
    const result = await s.service.submit({ ...payload(), initData });
    assert.equal(result.status, 401);
  }
  assert.equal(s.orders.size, 0); assert.equal(s.managerMessages.length, 0);
});

test('invalid products and stale catalog are rejected before persistence', async () => {
  const s = setup();
  const bad = payload(); bad.items[0].variantId = 'SET-40-FRESH';
  assert.equal((await s.service.submit(bad)).status, 400);
  assert.equal((await s.service.submit({ ...payload(), version: 'old' })).status, 400);
  assert.equal(s.orders.size, 0);
});

test('concurrent repeats and service restart reuse one delivered order', async () => {
  const s = setup(), input = payload();
  const results = await Promise.all([s.service.submit(input), s.service.submit(input), s.service.submit(input)]);
  assert.equal(new Set(results.map(r => r.body.orderId)).size, 1); assert.ok(results.every(r => r.body.delivered));
  assert.equal(s.orders.size, 1); assert.equal(s.managerMessages.length, 1); assert.equal(s.customerMessages.length, 1);
  const restarted = api.createCatalogV5Service(s.dependencies);
  assert.equal((await restarted.submit(input)).body.orderId, results[0].body.orderId);
  assert.equal(s.managerMessages.length, 1);
  const changed = payload(); changed.items[0].quantity = 3;
  assert.equal((await s.service.submit(changed)).status, 409);
  assert.equal(s.orders.size, 1);
});

test('partial manager delivery resumes after saved chunks and puts controls on the final message', async () => {
  const messages = require('../src/catalogV5Messages');
  assert.equal(typeof messages.deliverCatalogV5, 'function', 'resumable delivery must exist');
  let saved = { id: 'DB5-PARTIAL', catalogRequestText: '🍓'.repeat(4000), status: 'new', total: 1190, point: { name: 'Discovery' }, telegramUser: { id: 12345 } };
  const outgoing = []; let fail = true;
  const options = { store: { updateOrder: async (_id, patch) => { saved = { ...saved, ...patch }; } },
    send: async (text, controls) => { if (fail && outgoing.length === 1) throw new Error('offline'); outgoing.push({ text, controls }); return { message_id: outgoing.length }; }
  };
  await assert.rejects(() => messages.deliverCatalogV5(saved, options), /offline/);
  assert.equal(saved.catalogManagerMessages.length, 1);
  fail = false;
  const result = await messages.deliverCatalogV5(saved, options);
  assert.equal(result.messageId, outgoing.length);
  assert.equal(outgoing.length, messages.catalogV5Messages(saved).length);
  assert.ok(outgoing.slice(0, -1).every(m => !m.controls)); assert.equal(outgoing.at(-1).controls, true);
});

test('manager failure is not acknowledged; retry reuses stored request and then confirms delivery', async () => {
  const s = setup({ delivery: false }), input = payload();
  const failed = await s.service.submit(input);
  assert.equal(failed.status, 503); assert.equal(failed.body.delivered, false); assert.equal(s.customerMessages.length, 0);
  assert.equal(s.orders.size, 1);
  s.state.delivery = true;
  const retry = await s.service.submit(input);
  assert.equal(retry.body.delivered, true); assert.equal(retry.body.orderId, failed.body.orderId);
  assert.equal(s.orders.size, 1); assert.equal(s.managerMessages.length, 1);
});

test('unconfigured manager destination fails before storing or acknowledging', async () => {
  const s = setup({ ready: false });
  const result = await s.service.submit(payload());
  assert.equal(result.status, 503); assert.equal(s.orders.size, 0); assert.equal(s.customerMessages.length, 0);
});

test('stalled optional customer notification cannot delay receipts or later requests', async () => {
  const s = setup();
  const service = api.createCatalogV5Service({ ...s.dependencies, notifyCustomer: () => new Promise(() => {}) });
  const input = payload();
  const first = service.submit(input);
  const second = service.submit({ ...payload(), requestId: 'second-request-12345' });
  const repeated = service.submit(input);
  let timer;
  try {
    const results = await Promise.race([Promise.all([first, second, repeated]), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Optional notification blocked catalog')), 100); })]);
    assert.ok(results.every(r => r.body.delivered)); assert.equal(s.managerMessages.length, 2);
    assert.equal(results[0].body.orderId, results[2].body.orderId);
  } finally { clearTimeout(timer); }
});

test('Telegram API deadline remains active through reading the response body', async t => {
  const config = require('../src/config');
  const originalToken = config.botToken, originalFetch = global.fetch;
  config.botToken = token;
  t.after(() => { config.botToken = originalToken; global.fetch = originalFetch; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, entered;
  const reading = new Promise(resolve => { entered = resolve; });
  global.fetch = async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: () => new Promise((_resolve, reject) => { entered(); signal?.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true }); }) };
  };
  const { callApi } = require('../src/telegramBot');
  const response = callApi('sendMessage', { chat_id: 12345, text: 'test' });
  response.catch(() => {});
  await reading;
  t.mock.timers.tick(15001);
  assert.equal(signal?.aborted, true, 'Telegram send must abort after its deadline');
  await assert.rejects(response, /aborted/);
});

test('long order text is split without losing characters; final manager message holds status controls', () => {
  const file = path.join(__dirname, '../src/catalogV5Messages.js');
  const messages = fs.existsSync(file) ? require(file) : {};
  assert.equal(typeof messages.catalogV5Messages, 'function', 'message builder must exist');
  const content = '🍓<Маме>\n'.repeat(1200);
  const order = { id: 'DB5-ABC', catalogRequestText: content, status: 'new', total: 4080, point: { name: 'Discovery' }, date: '2030-10-05', time: '15:00', telegramUser: { id: 12345 } };
  const chunks = messages.catalogV5Messages(order);
  assert.ok(chunks.length > 2); assert.ok(chunks.every(m => m.length <= 3900));
  assert.equal(chunks.slice(0, -1).map(m => m.slice(m.indexOf('\n') + 1)).join(''), content);
  assert.match(chunks.at(-1), /DB5-ABC/); assert.match(chunks.at(-1), /\/reply DB5-ABC/);
});
